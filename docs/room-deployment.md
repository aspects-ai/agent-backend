# Room Deployment

Operational reference for running a room in production: storage tiers,
sandbox provider choice, the full environment-variable surface, and the
constraints an operator needs to know before deploying. For the concepts
behind these knobs (seams, manifest model, isolation), see
[room-architecture.md](room-architecture.md).

The bundled executable and all deployment examples currently use
`ManifestRoomCatalog`. Deployment today is **one process per room** — room
isolation comes from process and credential separation (see
room-architecture.md's isolation model), not from multi-tenant routing inside
one process. Each room gets its own port and token set. This topology is not
imposed by `RoomService`: a database-backed `RoomCatalog` can be hosted behind
a separately designed multi-tenant routing/control plane. See
[room-catalogs.md](room-catalogs.md).

For runnable walkthroughs, see:
- [room/examples/multi-room/README.md](../room/examples/multi-room/README.md) —
  several rooms on one host, filesystem or S3 tier, Docker sandboxing.
- [room/examples/k8s/README.md](../room/examples/k8s/README.md) — rooms as
  Kubernetes Deployments with sandbox-per-session pods, both raw-pod and
  warm-pool providers.

## Storage tiers

The canonical store (blobs + manifests) has three backends behind the same
interface, chosen by which config is passed to `buildRoomService` (or set via
env in the bin):

| Tier | Backend | Use |
|---|---|---|
| In-memory | `InMemoryBlobStore`/`InMemoryRoomStore` | Tests only — nothing survives a restart. |
| Filesystem | `FsBlobStore`/`FsRoomStore` (`AGENTBE_STORE_DIR`) | Dev / single-node. Pins the room to one node's disk — not reschedulable. |
| S3 | `S3BlobStore`/`S3RoomStore` (`AGENTBE_S3_BUCKET`) | Production — durable, multi-node, the tier the locked decision (§3 of the spec) targets. |

Set `AGENTBE_S3_BUCKET` to move a deployed room onto S3; without it, the bin
falls back to the filesystem store under `AGENTBE_STORE_DIR` and prints which
tier is active at boot. `AGENTBE_S3_ENDPOINT` points at a non-AWS S3-compatible
endpoint (LocalStack, MinIO, R2). Credentials fall back to the default AWS
provider chain (instance role, IRSA, env) when access-key env vars aren't set
— normally nothing further to configure on AWS.

## Choosing a sandbox provider

`AGENTBE_SANDBOX` selects the `WorkspaceProvider`; left unset, the room
auto-detects (`AutoWorkspaceProvider`) in this order: in-cluster Kubernetes →
Docker → unsandboxed local fallback (with a loud warning). `agent-sandbox` is
never auto-selected — it requires CRDs and a warm pool to already be
installed.

| Mode | Provider | Isolation unit | When to use |
|---|---|---|---|
| `local` | `LocalWorkspaceProvider` | none (temp dir on the room's own host) | Dev only, or when the room process itself already runs in an isolated host (a VM, a locked-down container) — never for untrusted code on a shared host. |
| `docker` | `DockerWorkspaceProvider` | one container per session | Single-node production deploys with a Docker daemon reachable. |
| `k8s` | `K8sWorkspaceProvider` | one pod per session | Kubernetes, zero extra install — talks to the API server directly, no client library or CRDs needed. Cold-start only (no warm pool); auto-selected in-cluster. |
| `agent-sandbox` | `AgentSandboxWorkspaceProvider` | one pooled pod per session, claimed | Kubernetes with [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox) installed. Opt-in only — needs its CRDs and a `SandboxWarmPool` provisioned first. |

Why two Kubernetes providers rather than one: `k8s` needs nothing beyond RBAC
and is the safe zero-install default; `agent-sandbox` needs CRDs and a warm
pool but avoids per-session cold start (measured ~0.4s to first command vs.
~1.6–9s for a cold raw pod locally, and the gap widens sharply on a real
cluster under scheduling pressure). Pick `agent-sandbox` when session
first-command latency matters and you're willing to run the warm-pool
controller; pick `k8s` otherwise.

A room pod has no Docker socket, so **never rely on auto-detection alone
inside a k8s pod** — a misdetection silently falls back to `local`, meaning
every session in the room shares one filesystem (a correctness regression,
not just a missing feature). Kubernetes manifests should pin
`AGENTBE_SANDBOX=k8s` or `agent-sandbox` explicitly so a misconfiguration
fails loudly instead of degrading silently.

**Env injection and warm pools are mutually exclusive.** Setting
`SandboxClaim.spec.env` on an agent-sandbox claim makes the controller bypass
warm-pool adoption and build a fresh pod every time, defeating the point of
pooling. `AgentSandboxWorkspaceProvider` therefore sets no claim-level env;
each pooled pod mints its own per-pod auth token at startup and serves it over
a loopback-only endpoint, which the room fetches once the claim binds.

**`AGENTBE_SANDBOX_REUSE=1`** returns a sandbox to the warm pool instead of
destroying it after use. Off by default: a recycled sandbox carries the
previous session's filesystem *and* its still-valid token into the next
session. Only enable it for non-sensitive workloads.

Every provider (except `local`) supports orphan reclamation at boot: if the
room process restarts, the in-memory session registry forgets every live
session while its sandbox (container, pod, or claim) keeps running. Each
provider sweeps its own room's strays on startup, scoped by an owner label —
an unscoped sweep would delete a sibling room's live sandboxes on a shared
host or namespace.

## Environment variable reference

All variables read by `room/src/bin.ts`. Grouped by concern; defaults shown
where the bin supplies one.

### Identity

| Var | Default | Purpose |
|---|---|---|
| `AGENTBE_ROOM` | `demo` | Room name this process serves. |
| `AGENTBE_PRINCIPAL` | — | Principal to attribute commits to over stdio (single local user). |
| `AGENTBE_PRINCIPALS` | — | JSON map `{"token":"principal-id"}` for per-person bearer auth on the HTTP transport. Refuses to start if set but empty/invalid. Takes precedence over `AGENTBE_AUTH_TOKEN`. |
| `AGENTBE_AUTH_TOKEN` | — | Single shared bearer token (HTTP transport). Authenticates but does not identify — commits land as `anonymous`. |

### Transport

| Var | Default | Purpose |
|---|---|---|
| `AGENTBE_HTTP_PORT` | — | Setting this switches transport to streamable HTTP; unset serves stdio. |
| `AGENTBE_HTTP_HOST` | `127.0.0.1` | Bind address. **Must be set to `0.0.0.0` in a container**, or the published port accepts nothing. |
| `AGENTBE_SESSION_IDLE_MS` | 900000 (15 min) | Idle time before a warm session's sandbox is reaped. `0` disables reaping. |

### Storage

| Var | Default | Purpose |
|---|---|---|
| `AGENTBE_STORE_DIR` | `room/.room-data` | Filesystem store location, used when `AGENTBE_S3_BUCKET` is unset. |
| `AGENTBE_SEED_DIR` | `room/testdata` | Corpus to seed a fresh (empty) room from. |
| `AGENTBE_S3_BUCKET` | — | Setting this switches the canonical store to S3. |
| `AGENTBE_S3_PREFIX` | — | Key prefix within the bucket. |
| `AGENTBE_S3_REGION` | — | AWS region. |
| `AGENTBE_S3_ENDPOINT` | — | Custom S3-compatible endpoint (LocalStack/MinIO/R2). |
| `AGENTBE_S3_ACCESS_KEY_ID` / `AGENTBE_S3_SECRET_ACCESS_KEY` | — | Explicit credentials; omit to use the default AWS provider chain. |

### Search / embeddings

| Var | Default | Purpose |
|---|---|---|
| `AGENTBE_EMBEDDER` | `local` | Text embedder: `local` (MiniLM, offline), `openai`, `ollama`, or `hash` (dependency-free lexical fallback). |
| `AGENTBE_EMBED_MODEL` | provider default | Override the model name/id for the selected embedder. |
| `AGENTBE_IMAGE_EMBEDDER` | CLIP (local) | Set to `none` to disable image indexing entirely. |
| `AGENTBE_IMAGE_MODEL` | provider default | Override the CLIP model. |
| `AGENTBE_VECTOR` | in-memory | Set to `pg` for a persistent pgvector-backed index (see below). |
| `AGENTBE_PG_URL` | — | Postgres connection string, required when `AGENTBE_VECTOR=pg`. |

**Set `AGENTBE_VECTOR=pg` in production.** Without it the vector index is
in-memory and rebuilt by re-embedding the *entire* corpus on every boot —
acceptable for a small demo, not for a GB-scale corpus. A persistent
(pgvector) index survives restarts, so the bin skips reindex-on-boot when it
detects one.

### Sandbox

| Var | Default | Purpose |
|---|---|---|
| `AGENTBE_SANDBOX` | auto-detect | Force `local`, `docker`, `k8s`, or `agent-sandbox`. See table above. |
| `AGENTBE_DAEMON_IMAGE` | `ghcr.io/aspects-ai/agentbe-daemon:latest` | Sandbox daemon image (Docker/k8s raw-pod modes). |
| `AGENTBE_SANDBOX_NETWORK` | — | Docker network to attach sandbox containers to, for egress restriction. |
| `AGENTBE_SANDBOX_NAMESPACE` | — | Kubernetes namespace for sandbox pods/claims. |
| `AGENTBE_SANDBOX_PLATFORM` | — | `--platform` passed to `docker run` (e.g. `linux/amd64`) — needed on arm64 hosts since the published image is amd64-only. |
| `AGENTBE_WARM_POOL` | `agentbe-pool` | `SandboxWarmPool` name to claim from (`agent-sandbox` mode only). |
| `AGENTBE_SANDBOX_REUSE` | off | Set to `1` to recycle sandboxes back to the pool instead of destroying them after use. See caveat above. |

## Hard constraints

**`replicas: 1` is load-bearing.** The warm-session registry is in-process,
keyed by an id handed back to the client. A second replica would receive
requests for sessions it never opened and reject them as unknown. Do not
scale a room process horizontally without first externalizing the registry or
adding sticky routing — this is a real correctness constraint, not a
performance tuning knob.

**NetworkPolicy needs an enforcing CNI.** kind's default CNI (kindnet) does
not enforce `NetworkPolicy` at all — policies apply cleanly and silently do
nothing. Verify enforcement on any cluster before relying on it (create the
cluster with `disableDefaultCNI: true` and install Calico, or confirm your
managed cluster's CNI enforces policy). Sandbox pods need no egress at all —
the room streams checkout/commit bytes to them over the daemon connection —
so a default-deny egress policy on the sandbox label is safe to apply
outright.

**TLS terminates upstream.** The room serves plain HTTP; it does not
terminate TLS itself. Put a reverse proxy, Ingress, or load balancer in front
of it in any deployment reachable outside a trusted network.

**Prefer `AGENTBE_VECTOR=pg` in production**, per the search/embeddings table
above — the default in-memory index re-embeds the whole corpus on every
restart.

**Docker sandbox has no egress by default and needs none.** The room streams
checkout/commit bytes over the daemon connection, so a sandbox container never
talks to the store directly and carries no store credentials. `--network
none` will not work as an egress restriction — it also drops the published
port the room connects through — use a dedicated bridge network
(`AGENTBE_SANDBOX_NETWORK`) with egress rules instead.

**The published daemon image is amd64-only.** `ghcr.io/aspects-ai/agentbe-daemon:latest`
has no arm64 manifest, so it fails outright on Apple Silicon dev machines and
on arm64 nodes (e.g. Graviton) alike. Work around it with
`AGENTBE_SANDBOX_PLATFORM=linux/amd64` (emulation overhead) or build a native
arm64 image from `agentbe-daemon/docker/Dockerfile` and point
`AGENTBE_DAEMON_IMAGE` at it. A published multi-arch image removes the need
for either.
