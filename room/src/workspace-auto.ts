import type { ProvisionedBackend, WorkspaceProvider } from "./room-service.js";
import { LocalWorkspaceProvider } from "./workspace-local.js";
import {
  DockerWorkspaceProvider,
  isDockerAvailable,
  type DockerWorkspaceOptions,
} from "./workspace-docker.js";
import {
  K8sWorkspaceProvider,
  isInCluster,
  type K8sWorkspaceOptions,
} from "./workspace-k8s.js";
import {
  AgentSandboxWorkspaceProvider,
  type AgentSandboxWorkspaceOptions,
} from "./workspace-agent-sandbox.js";

export type WorkspaceMode = "agent-sandbox" | "k8s" | "docker" | "local";

export interface AutoWorkspaceOptions
  extends DockerWorkspaceOptions,
    K8sWorkspaceOptions,
    AgentSandboxWorkspaceOptions {
  /** Override detection (e.g. `AGENTBE_SANDBOX=local`). Omit to auto-detect. */
  mode?: WorkspaceMode;
  /** Where the fallback warning goes. Defaults to stderr. */
  warn?: (message: string) => void;
}

const FALLBACK_WARNING =
  "[agentbe-room] WARNING: Docker is not available — falling back to LocalWorkspaceProvider. " +
  "Agent commands will run UNSANDBOXED on this host, with access to the whole filesystem and " +
  "network. This is acceptable for local development, or when the host is already isolated " +
  "(a container, k8s pod, or VM). Do NOT run untrusted agent code this way. " +
  "Install/start Docker to get a per-session sandboxed container.";

/**
 * Prefers a real sandbox and degrades loudly. Resolves to
 * {@link DockerWorkspaceProvider} when a Docker daemon is reachable, otherwise
 * falls back to {@link LocalWorkspaceProvider} with a prominent warning.
 *
 * Detection is deferred to first use so this stays constructible synchronously
 * (`buildRoomService` is sync). Call {@link preflight} at startup to resolve it
 * eagerly and surface the warning at boot rather than at first `run_command`.
 */
export class AutoWorkspaceProvider implements WorkspaceProvider {
  private resolved?: { mode: WorkspaceMode; provider: WorkspaceProvider };
  private resolving?: Promise<{ mode: WorkspaceMode; provider: WorkspaceProvider }>;

  constructor(private readonly options: AutoWorkspaceOptions = {}) {}

  /** Resolve (and cache) the provider, emitting the warning on fallback. */
  async preflight(): Promise<WorkspaceMode> {
    if (this.resolved) return this.resolved.mode;
    // Collapse concurrent first-use into one detection.
    this.resolving ??= this.resolve();
    this.resolved = await this.resolving;
    return this.resolved.mode;
  }

  private async resolve(): Promise<{ mode: WorkspaceMode; provider: WorkspaceProvider }> {
    const warn = this.options.warn ?? ((m: string) => console.error(m));
    const forced = this.options.mode;

    if (forced === "local") {
      warn(FALLBACK_WARNING);
      return { mode: "local", provider: new LocalWorkspaceProvider() };
    }
    // In a pod, prefer sandbox-per-session pods. Checked BEFORE docker: a pod
    // has no docker socket, so without this the room would silently fall back
    // to running every session in one shared filesystem.
    // Opt-in only: it needs agent-sandbox's CRDs and a warm pool installed, so
    // auto-detection must not assume them.
    if (forced === "agent-sandbox") {
      return { mode: "agent-sandbox", provider: new AgentSandboxWorkspaceProvider(this.options) };
    }
    if (forced === "k8s" || (!forced && isInCluster())) {
      return { mode: "k8s", provider: new K8sWorkspaceProvider(this.options) };
    }
    if (forced === "docker" || (await isDockerAvailable())) {
      return { mode: "docker", provider: new DockerWorkspaceProvider(this.options) };
    }
    warn(FALLBACK_WARNING);
    return { mode: "local", provider: new LocalWorkspaceProvider() };
  }

  async create(): Promise<ProvisionedBackend> {
    await this.preflight();
    return this.resolved!.provider.create();
  }

  /** Delegate to the resolved provider; local temp dirs have nothing to sweep. */
  async reclaimOrphans(): Promise<number> {
    await this.preflight();
    return (await this.resolved!.provider.reclaimOrphans?.()) ?? 0;
  }
}
