import https from "node:https";
import { readFileSync } from "node:fs";

/** Where kubelet projects the pod's service-account credentials. */
export const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

export interface K8sApiOptions {
  /** Namespace to operate in. Defaults to the pod's own namespace. */
  namespace?: string;
  /** API server base URL. Defaults to the in-cluster endpoint. */
  apiServer?: string;
  /** Bearer token. Defaults to the projected service-account token. */
  token?: string;
  /** CA bundle path. Defaults to the projected CA. */
  caPath?: string;
}

export function readIfPresent(path: string): string | undefined {
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
 * Minimal Kubernetes API client over `node:https` — no client library, keeping
 * the room's dependency graph light (spec §4).
 *
 * The cluster CA is passed **per request**. It is not a system root, so TLS
 * otherwise fails with "unable to verify the first certificate"; and setting
 * `NODE_EXTRA_CA_CERTS` at runtime does nothing, because Node reads that only at
 * process start.
 */
export class K8sApi {
  readonly namespace: string;
  private readonly apiServer: string;
  private readonly token: string;
  private readonly ca?: string;

  constructor(options: K8sApiOptions = {}) {
    this.namespace = options.namespace ?? readIfPresent(`${SA_DIR}/namespace`) ?? "default";
    this.apiServer =
      options.apiServer ??
      (process.env.KUBERNETES_SERVICE_HOST
        ? `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT ?? "443"}`
        : "https://kubernetes.default.svc");
    const token = options.token ?? readIfPresent(`${SA_DIR}/token`);
    if (!token) {
      throw new Error(
        "K8sApi: no service-account token found. This must run inside a pod " +
          "(or be given an explicit `token` + `apiServer`).",
      );
    }
    this.token = token;
    this.ca = readIfPresent(options.caPath ?? `${SA_DIR}/ca.crt`);
  }

  request<T>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
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
}
