import https from "node:https";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { RemoteFilesystemBackend } from "agent-backend";

import type { ProvisionedBackend, RoomBackend, WorkspaceProvider } from "./room-service.js";

/** Where kubelet projects the pod's service-account credentials. */
const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const DAEMON_PORT = 3001;
const WORKSPACE_ROOT = "/var/workspace";

export interface K8sWorkspaceOptions {
  /** Daemon image for sandbox pods. */
  image?: string;
  /** Namespace to create pods in. Defaults to the room pod's own namespace. */
  namespace?: string;
  /** API server base URL. Defaults to the in-cluster endpoint. */
  apiServer?: string;
  /** Bearer token. Defaults to the projected service-account token. */
  token?: string;
  /** CA bundle path for the API server. Defaults to the projected CA. */
  caPath?: string;
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

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return undefined;
  }
}

/** True when running inside a pod with a projected service account. */
export function isInCluster(): boolean {
  return readIfPresent(`${SA_DIR}/token`) !== undefined;
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
  private readonly image: string;
  private readonly namespace: string;
  private readonly apiServer: string;
  private readonly token: string;
  private readonly cpuLimit: string;
  private readonly memoryLimit: string;
  private readonly startupTimeoutMs: number;
  private readonly labels: Record<string, string>;
  private readonly owner?: string;

  constructor(options: K8sWorkspaceOptions = {}) {
    this.image = options.image ?? "agentbe-daemon:latest";
    this.namespace =
      options.namespace ?? readIfPresent(`${SA_DIR}/namespace`) ?? "default";
    this.apiServer =
      options.apiServer ??
      (process.env.KUBERNETES_SERVICE_HOST
        ? `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT ?? "443"}`
        : "https://kubernetes.default.svc");
    const token = options.token ?? readIfPresent(`${SA_DIR}/token`);
    if (!token) {
      throw new Error(
        "K8sWorkspaceProvider: no service-account token found. This provider must run " +
          "inside a pod (or be given an explicit `token` + `apiServer`).",
      );
    }
    this.token = token;
    this.cpuLimit = options.cpuLimit ?? "1";
    this.memoryLimit = options.memoryLimit ?? "1Gi";
    this.startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
    this.owner = options.owner;
    this.labels = {
      "agentbe.room/sandbox": "true",
      ...(this.owner ? { "agentbe.room/owner": this.owner } : {}),
      ...options.labels,
    };

    // The cluster CA is not a system root, so TLS to the API server fails
    // without it ("unable to verify the first certificate"). It is passed
    // per-request below rather than via NODE_EXTRA_CA_CERTS, which Node only
    // reads at process start — setting that at runtime silently does nothing.
    this.ca = readIfPresent(options.caPath ?? `${SA_DIR}/ca.crt`);
  }

  private readonly ca?: string;

  private api<T>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
    const url = new URL(path, this.apiServer);
    const method = init.method ?? "GET";
    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method,
          ca: this.ca,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            ...(init.body ? { "Content-Length": Buffer.byteLength(init.body) } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8");
            const status = res.statusCode ?? 0;
            if (status >= 400) {
              reject(new Error(`k8s ${method} ${url.pathname} → ${status}: ${text}`));
              return;
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch {
              reject(new Error(`k8s ${method} ${url.pathname}: unparseable response: ${text}`));
            }
          });
        },
      );
      req.on("error", reject);
      if (init.body) req.write(init.body);
      req.end();
    });
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

    await this.api(`/api/v1/namespaces/${this.namespace}/pods`, {
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
    const list = await this.api<{ items?: Array<{ metadata?: { name?: string } }> }>(
      `/api/v1/namespaces/${this.namespace}/pods?labelSelector=${selector}`,
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
      const pod = await this.api<{
        status?: {
          podIP?: string;
          phase?: string;
          conditions?: Array<{ type: string; status: string }>;
          containerStatuses?: Array<{ state?: Record<string, { reason?: string }> }>;
        };
      }>(`/api/v1/namespaces/${this.namespace}/pods/${name}`);

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
    await this.api(`/api/v1/namespaces/${this.namespace}/pods/${name}`, {
      method: "DELETE",
      // Don't block the caller on graceful shutdown; the sandbox is disposable.
      body: JSON.stringify({ gracePeriodSeconds: 0 }),
    }).catch(() => undefined);
  }
}
