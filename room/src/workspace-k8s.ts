import { randomUUID } from "node:crypto";

import { RemoteFilesystemBackend } from "agent-backend";

import type { ProvisionedBackend, RoomBackend, WorkspaceProvider } from "./room-service.js";
import { K8sApi, isInCluster, type K8sApiOptions } from "./lib/k8s-api.js";

export { isInCluster };

const DAEMON_PORT = 3001;
const WORKSPACE_ROOT = "/var/workspace";

export interface K8sWorkspaceOptions extends K8sApiOptions {
  /** Daemon image for sandbox pods. */
  image?: string;
  /** Resource requests/limits applied to each sandbox pod. */
  cpuLimit?: string;
  memoryLimit?: string;
  /** How long to wait for the pod to become Ready. Default 120s. */
  startupTimeoutMs?: number;
  /** Labels stamped on every sandbox pod (for reaping orphans). */
  labels?: Record<string, string>;
  /**
   * Identifies which room owns these sandbox pods. Required for
   * {@link K8sWorkspaceProvider.reclaimOrphans} to be safe — rooms commonly
   * share a namespace, and an unscoped sweep would delete another room's live
   * sandboxes.
   */
  owner?: string;
}

/**
 * Provisions each workspace as its **own Kubernetes pod** running
 * `agentbe-daemon`, reached over {@link RemoteFilesystemBackend} at the pod IP.
 *
 * This is the k8s equivalent of `DockerWorkspaceProvider` and preserves the same
 * guarantee: one sandbox per session, so concurrent sessions cannot see each
 * other's filesystem. Running the room's own `LocalWorkspaceProvider` inside a
 * shared room pod would NOT — every session would share one filesystem.
 *
 * Talks to the API server over plain `fetch` with the pod's service-account
 * token, so it needs no Kubernetes client library (keeping §4's dependency-light
 * rule intact). Requires RBAC allowing create/get/delete on pods.
 */
export class K8sWorkspaceProvider implements WorkspaceProvider {
  private readonly api: K8sApi;
  private readonly image: string;
  private readonly cpuLimit: string;
  private readonly memoryLimit: string;
  private readonly startupTimeoutMs: number;
  private readonly labels: Record<string, string>;
  private readonly owner?: string;

  constructor(options: K8sWorkspaceOptions = {}) {
    this.api = new K8sApi(options);
    this.image = options.image ?? "agentbe-daemon:latest";
    this.cpuLimit = options.cpuLimit ?? "1";
    this.memoryLimit = options.memoryLimit ?? "1Gi";
    this.startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
    this.owner = options.owner;
    this.labels = {
      "agentbe.room/sandbox": "true",
      ...(this.owner ? { "agentbe.room/owner": this.owner } : {}),
      ...options.labels,
    };
  }

  async create(): Promise<ProvisionedBackend> {
    const name = `agentbe-sandbox-${randomUUID().slice(0, 8)}`;
    // Unique per pod — a leaked token grants nothing once the pod is gone.
    const authToken = randomUUID();

    const manifest = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name, labels: this.labels },
      spec: {
        // Agent code is untrusted: never mount a service-account token into it.
        automountServiceAccountToken: false,
        restartPolicy: "Never",
        containers: [
          {
            name: "daemon",
            image: this.image,
            imagePullPolicy: "IfNotPresent",
            ports: [{ containerPort: DAEMON_PORT }],
            env: [
              { name: "AUTH_TOKEN", value: authToken },
              { name: "WORKSPACE_ROOT", value: WORKSPACE_ROOT },
            ],
            resources: {
              limits: { cpu: this.cpuLimit, memory: this.memoryLimit },
              requests: { cpu: "100m", memory: "128Mi" },
            },
            // Without this, the pod's Ready condition means only "container
            // started" — the room would connect before the daemon is listening
            // and fail. Gating Ready on /health makes waitForReady meaningful.
            readinessProbe: {
              httpGet: { path: "/health", port: DAEMON_PORT },
              initialDelaySeconds: 1,
              periodSeconds: 1,
              failureThreshold: 60,
            },
          },
        ],
      },
    };

    await this.api.request(`/api/v1/namespaces/${this.api.namespace}/pods`, {
      method: "POST",
      body: JSON.stringify(manifest),
    });

    try {
      const podIP = await this.waitForReady(name);
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
          await this.deletePod(name);
        },
      };
    } catch (err) {
      await this.deletePod(name); // never leak a pod on a failed startup
      throw err;
    }
  }

  /**
   * Delete this room's sandbox pods — startup sweep after a restart. The
   * session registry is in-memory, so without this a restart strands every
   * running sandbox pod with no owner to ever delete it.
   */
  async reclaimOrphans(): Promise<number> {
    if (!this.owner) return 0; // unscoped sweep would hit other rooms
    const selector = encodeURIComponent(`agentbe.room/owner=${this.owner}`);
    const list = await this.api.request<{ items?: Array<{ metadata?: { name?: string } }> }>(
      `/api/v1/namespaces/${this.api.namespace}/pods?labelSelector=${selector}`,
    );
    const names = (list.items ?? []).map((i) => i.metadata?.name).filter(Boolean) as string[];
    for (const name of names) await this.deletePod(name);
    return names.length;
  }

  /** Poll until the pod reports Ready, then return its IP. */
  private async waitForReady(name: string): Promise<string> {
    const deadline = Date.now() + this.startupTimeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      const pod = await this.api.request<{
        status?: {
          podIP?: string;
          phase?: string;
          conditions?: Array<{ type: string; status: string }>;
          containerStatuses?: Array<{ state?: Record<string, { reason?: string }> }>;
        };
      }>(`/api/v1/namespaces/${this.api.namespace}/pods/${name}`);

      const ready = pod.status?.conditions?.some(
        (c) => c.type === "Ready" && c.status === "True",
      );
      if (ready && pod.status?.podIP) return pod.status.podIP;

      // Surface the real reason rather than timing out silently on, say,
      // ImagePullBackOff or an arch mismatch.
      const waiting = pod.status?.containerStatuses?.[0]?.state?.waiting?.reason;
      last = waiting ?? pod.status?.phase ?? "unknown";
      if (waiting && /ImagePullBackOff|ErrImagePull|CrashLoopBackOff/.test(waiting)) {
        throw new Error(`sandbox pod ${name} cannot start: ${waiting} (image ${this.image})`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `sandbox pod ${name} not Ready within ${this.startupTimeoutMs}ms (last state: ${last})`,
    );
  }

  private async deletePod(name: string): Promise<void> {
    await this.api.request(`/api/v1/namespaces/${this.api.namespace}/pods/${name}`, {
      method: "DELETE",
      // Don't block the caller on graceful shutdown; the sandbox is disposable.
      body: JSON.stringify({ gracePeriodSeconds: 0 }),
    }).catch(() => undefined);
  }
}
