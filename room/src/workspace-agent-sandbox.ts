import http from "node:http";
import { randomUUID } from "node:crypto";

import { RemoteFilesystemBackend } from "agent-backend";

import type { ProvisionedBackend, RoomBackend, WorkspaceProvider } from "./room-service.js";
import { K8sApi, type K8sApiOptions } from "./lib/k8s-api.js";

const DAEMON_PORT = 3001;
const TOKEN_PORT = 3002;
const WORKSPACE_ROOT = "/var/workspace";
const CLAIMS_API = "/apis/extensions.agents.x-k8s.io/v1beta1";

export interface AgentSandboxWorkspaceOptions extends K8sApiOptions {
  /** `SandboxWarmPool` to claim from. */
  warmPool?: string;
  /**
   * Return the sandbox to the pool instead of destroying it after use.
   *
   * **Off by default, deliberately.** A recycled sandbox carries the previous
   * session's filesystem *and* its still-valid token into the next session.
   * Only enable for non-sensitive workloads where the startup saving is worth
   * that. Maps to `SandboxClaim.spec.lifecycle.shutdownPolicy`.
   */
  reuseSandboxes?: boolean;
  /** How long to wait for the claim to bind. Default 120s. */
  startupTimeoutMs?: number;
  /** Identifies which room owns these claims, for orphan reclamation. */
  owner?: string;
}

interface ClaimStatus {
  status?: {
    sandbox?: { name?: string; podIPs?: string[] };
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
  };
}

/**
 * Provisions each workspace by claiming a **pre-warmed** sandbox from an
 * agent-sandbox `SandboxWarmPool`, so a session's first command doesn't wait on
 * pod scheduling and image pull (measured ~0.2s to bind an already-running pod,
 * versus a full cold start otherwise).
 *
 * The controller owns pooling and — importantly — the *atomic* allocation, so
 * two concurrent claims can never receive the same sandbox. Hand-rolling that
 * compare-and-set is exactly the kind of race that passes tests and fails in
 * production.
 *
 * **Credentials.** The claim deliberately sets no `spec.env`: doing so makes the
 * controller bypass warm-pool adoption entirely and build a fresh pod, defeating
 * the point. Instead each pooled pod mints its own token at startup and serves
 * it on {@link TOKEN_PORT}; the room fetches it once the claim binds. The token
 * is a bearer credential for one pod and identifies nothing.
 */
export class AgentSandboxWorkspaceProvider implements WorkspaceProvider {
  private readonly api: K8sApi;
  private readonly warmPool: string;
  private readonly reuse: boolean;
  private readonly startupTimeoutMs: number;
  private readonly owner?: string;

  constructor(options: AgentSandboxWorkspaceOptions = {}) {
    this.api = new K8sApi(options);
    this.warmPool = options.warmPool ?? "agentbe-pool";
    this.reuse = options.reuseSandboxes ?? false;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
    this.owner = options.owner;
  }

  private claimsPath(name = ""): string {
    return `${CLAIMS_API}/namespaces/${this.api.namespace}/sandboxclaims${name ? `/${name}` : ""}`;
  }

  async create(): Promise<ProvisionedBackend> {
    const name = `agentbe-claim-${randomUUID().slice(0, 8)}`;
    const manifest = {
      apiVersion: "extensions.agents.x-k8s.io/v1beta1",
      kind: "SandboxClaim",
      metadata: {
        name,
        labels: {
          "agentbe.room/claim": "true",
          ...(this.owner ? { "agentbe.room/owner": this.owner } : {}),
        },
      },
      spec: {
        warmPoolRef: { name: this.warmPool },
        // NO `env` here — see the class doc. Setting it silently costs warm start.
        lifecycle: { shutdownPolicy: this.reuse ? "Retain" : "Delete" },
      },
    };

    await this.api.request(this.claimsPath(), { method: "POST", body: JSON.stringify(manifest) });

    try {
      const { podIP } = await this.waitForBound(name);
      const authToken = await this.fetchToken(podIP);
      const backend = new RemoteFilesystemBackend({
        host: podIP,
        port: DAEMON_PORT,
        authToken,
        rootDir: WORKSPACE_ROOT,
        transport: "ssh-ws",
      });
      return {
        backend: backend as unknown as RoomBackend,
        dispose: async () => {
          await this.deleteClaim(name);
        },
      };
    } catch (err) {
      await this.deleteClaim(name); // never leak a claimed sandbox
      throw err;
    }
  }

  /** Delete this room's claims — startup sweep after a restart. */
  async reclaimOrphans(): Promise<number> {
    if (!this.owner) return 0;
    const selector = encodeURIComponent(`agentbe.room/owner=${this.owner}`);
    const list = await this.api.request<{ items?: Array<{ metadata?: { name?: string } }> }>(
      `${this.claimsPath()}?labelSelector=${selector}`,
    );
    const names = (list.items ?? []).map((i) => i.metadata?.name).filter(Boolean) as string[];
    for (const n of names) await this.deleteClaim(n);
    return names.length;
  }

  private async waitForBound(name: string): Promise<{ podIP: string }> {
    const deadline = Date.now() + this.startupTimeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      const claim = await this.api.request<ClaimStatus>(this.claimsPath(name));
      const podIP = claim.status?.sandbox?.podIPs?.[0];
      if (podIP) return { podIP };

      const ready = claim.status?.conditions?.find((c) => c.type === "Ready");
      last = ready?.message ?? ready?.reason ?? "pending";
      // A rejected claim never recovers — fail loudly rather than time out.
      // `EnvVarsInjectionRejected` is the one people hit first.
      if (ready?.status === "False" && ready.reason && /Rejected|Invalid/.test(ready.reason)) {
        throw new Error(`sandbox claim ${name} rejected: ${ready.reason}: ${ready.message ?? ""}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`sandbox claim ${name} did not bind within ${this.startupTimeoutMs}ms (${last})`);
  }

  /** Fetch the sandbox's self-minted daemon token. */
  private fetchToken(podIP: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: podIP, port: TOKEN_PORT, path: "/token", timeout: 10_000 },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const token = Buffer.concat(chunks).toString("utf-8").trim();
            if (res.statusCode !== 200 || !token) {
              reject(new Error(`token fetch from ${podIP}:${TOKEN_PORT} → ${res.statusCode}`));
              return;
            }
            resolve(token);
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error(`token fetch from ${podIP} timed out`)));
      req.on("error", reject);
      req.end();
    });
  }

  private async deleteClaim(name: string): Promise<void> {
    await this.api
      .request(this.claimsPath(name), {
        method: "DELETE",
        body: JSON.stringify({ gracePeriodSeconds: 0 }),
      })
      .catch(() => undefined);
  }
}
