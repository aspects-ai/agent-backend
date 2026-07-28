import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { RemoteFilesystemBackend } from "agent-backend";

import type { ProvisionedBackend, RoomBackend, WorkspaceProvider } from "./room-service.js";

const run = promisify(execFile);

/** Published daemon image. Overridable for a pinned tag or a custom build. */
export const DEFAULT_DAEMON_IMAGE = "ghcr.io/aspects-ai/agentbe-daemon:latest";

/** Fixed by the daemon's Docker packaging (see agentbe-daemon/docker). */
const DAEMON_PORT = 3001;
const WORKSPACE_ROOT = "/var/workspace";

/** Label stamped on every container so orphans are findable/cleanable. */
const LABEL = "agentbe.room.sandbox";

export interface DockerWorkspaceOptions {
  image?: string;
  /** `--memory`. Default "1g". */
  memory?: string;
  /** `--cpus`. Default "1". */
  cpus?: string;
  /** `--pids-limit`, cheap fork-bomb protection. Default 512. */
  pidsLimit?: number;
  /**
   * Docker network for the sandbox. The sandbox needs **no** outbound access:
   * the room streams checkout/commit bytes to it over the daemon connection, so
   * it never talks to the store and holds no credentials. Attach an
   * egress-restricted network here to enforce that.
   *
   * Note `--network none` will NOT work — it also drops the published port the
   * room connects through. Use a dedicated bridge network with egress rules.
   */
  network?: string;
  /** How long to wait for `/health` before giving up. Default 60s. */
  startupTimeoutMs?: number;
  /**
   * `--platform`, e.g. `"linux/amd64"`. The published image is currently
   * **amd64-only**, so Apple Silicon / arm64 hosts must either set this (running
   * under emulation — correct but slow) or point {@link image} at a locally
   * built arm64 image from `agentbe-daemon/docker/Dockerfile`.
   */
  platform?: string;
}

async function docker(args: string[]): Promise<string> {
  const { stdout } = await run("docker", args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

/** True if a Docker daemon is reachable. `docker info` fails fast if not. */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Provisions each workspace as its **own** `agentbe-daemon` container, reached
 * over {@link RemoteFilesystemBackend}. This is the real isolation boundary:
 * one container per session, not one shared daemon with per-request scope paths
 * (scoping only sets a working directory — it does not contain `exec`).
 *
 * Hardened by default: per-container auth token, resource caps, and no store
 * credentials inside the sandbox.
 */
export class DockerWorkspaceProvider implements WorkspaceProvider {
  private readonly image: string;
  private readonly memory: string;
  private readonly cpus: string;
  private readonly pidsLimit: number;
  private readonly network?: string;
  private readonly startupTimeoutMs: number;
  private readonly platform?: string;

  constructor(options: DockerWorkspaceOptions = {}) {
    this.image = options.image ?? DEFAULT_DAEMON_IMAGE;
    this.memory = options.memory ?? "1g";
    this.cpus = options.cpus ?? "1";
    this.pidsLimit = options.pidsLimit ?? 512;
    this.network = options.network;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 60_000;
    this.platform = options.platform;
  }

  async create(): Promise<ProvisionedBackend> {
    // Unique per container — a leaked token grants nothing once it's gone.
    const authToken = randomUUID();

    const args = [
      "run",
      "-d",
      "--rm",
      "--label",
      LABEL,
      // Bind to loopback and let Docker choose the host port (no racy scan).
      "-p",
      `127.0.0.1::${DAEMON_PORT}`,
      "-e",
      `AUTH_TOKEN=${authToken}`,
      "-e",
      `WORKSPACE_ROOT=${WORKSPACE_ROOT}`,
      "--memory",
      this.memory,
      "--cpus",
      this.cpus,
      "--pids-limit",
      String(this.pidsLimit),
    ];
    if (this.network) args.push("--network", this.network);
    if (this.platform) args.push("--platform", this.platform);
    args.push(this.image);

    let containerId: string;
    try {
      containerId = await docker(args);
    } catch (err) {
      const message = (err as Error).message;
      // The published image is amd64-only; on arm64 this is the failure people
      // hit first, and Docker's raw message doesn't suggest the fix.
      const hint = /no matching manifest|platform/i.test(message)
        ? `\n\nHint: image "${this.image}" has no manifest for this architecture. ` +
          `Set platform: "linux/amd64" (AGENTBE_SANDBOX_PLATFORM) to run it under emulation, ` +
          `or build a native image from agentbe-daemon/docker/Dockerfile and pass it as \`image\`.`
        : "";
      throw new Error(`failed to start sandbox container: ${message}${hint}`);
    }

    try {
      const port = await this.hostPort(containerId);
      await this.waitForHealth(port, containerId);
      const backend = new RemoteFilesystemBackend({
        host: "127.0.0.1",
        port,
        authToken,
        rootDir: WORKSPACE_ROOT,
        transport: "ssh-ws",
      });
      return {
        backend: backend as unknown as RoomBackend,
        dispose: async () => {
          await removeContainer(containerId);
        },
      };
    } catch (err) {
      // Never leak a container when startup fails partway.
      await removeContainer(containerId);
      throw err;
    }
  }

  /** Resolve the ephemeral host port Docker bound to the daemon's port. */
  private async hostPort(containerId: string): Promise<number> {
    const mapping = await docker(["port", containerId, `${DAEMON_PORT}/tcp`]);
    // e.g. "127.0.0.1:49154" (possibly several lines for multiple bindings).
    const port = Number(mapping.split("\n")[0]?.trim().split(":").pop());
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`could not resolve host port for container ${containerId}: "${mapping}"`);
    }
    return port;
  }

  /**
   * Poll the daemon's unauthenticated `/health` until it answers. On timeout,
   * surface the container logs — a silent "sandbox won't start" is miserable to
   * debug otherwise.
   */
  private async waitForHealth(port: number, containerId: string): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;
    let lastError = "";
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (res.ok) return;
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        lastError = (err as Error).message;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const logs = await docker(["logs", "--tail", "40", containerId]).catch(() => "(no logs)");
    throw new Error(
      `agentbe-daemon container ${containerId.slice(0, 12)} did not become healthy within ` +
        `${this.startupTimeoutMs}ms (last error: ${lastError})\n--- container logs ---\n${logs}`,
    );
  }
}

async function removeContainer(containerId: string): Promise<void> {
  // Best-effort: with `--rm` the container may already be gone.
  await docker(["rm", "-f", containerId]).catch(() => undefined);
}
