# Kubernetes deploy — rooms as Deployments, sandboxes as pods

Runs the multi-room deploy on Kubernetes with **sandbox-per-session pods**, so
the cross-session isolation guarantee survives the move off Docker.

## Why this exists

Deploying rooms on k8s without a k8s sandbox provider would be a **regression**.
A room pod has no Docker socket (and k8s runtimes are containerd anyway), so
`AutoWorkspaceProvider` would fall back to `LocalWorkspaceProvider` — every
session in that room sharing one filesystem. `K8sWorkspaceProvider` restores
one-sandbox-per-session by creating a pod per session, exactly as the Docker
provider creates a container per session.

## Safety: always name the context

Every command below passes `--context` explicitly. Do not rely on the current
context — `kubectl config get-contexts` on a dev machine is often pointed at a
production cluster.

## Run it

```bash
kind create cluster --name agentbe

# Build both images and load them into the cluster (no registry needed).
docker build -f room/Dockerfile -t agentbe-room:dev .
docker build -f agentbe-daemon/docker/Dockerfile --build-arg AGENTBE_VERSION=local \
  -t agentbe-daemon:arm64-dev .
kind load docker-image agentbe-room:dev agentbe-daemon:arm64-dev --name agentbe

# Seed corpora (one per room), then the rooms themselves.
kubectl --context kind-agentbe create ns agentbe
kubectl --context kind-agentbe -n agentbe create configmap acme-seed --from-file=<dir>
kubectl --context kind-agentbe -n agentbe create configmap globex-seed --from-file=<dir>
kubectl --context kind-agentbe apply -f room/examples/k8s/rooms.yaml

node room/examples/k8s/check.mjs
```

**On the image tag:** the published `ghcr.io/aspects-ai/agentbe-daemon:latest` is
**amd64-only**, and a kind node on Apple Silicon is arm64 — pods would fail to
start. Building the daemon locally sidesteps that. A multi-arch published image
is the real fix.

## What `check.mjs` proves

- Both room Services are reachable, and a room's token is rejected by the other.
- No content crosses between rooms.
- **Each warm session gets its own sandbox pod** (two sessions → two pods).
- **Concurrent sessions are isolated**: session 1 cannot read session 2's file,
  and they report different hostnames.
- Commit-back works from inside a sandbox pod.
- **Closing a session deletes its pod** (2 → 0), so sandboxes don't leak.

## Connect a client (Claude Code) to the rooms

Port-forward each room, then register it as an MCP server with its bearer token.
The forwards die when a room pod restarts, so re-run them after a redeploy.

```bash
kubectl --context kind-agentbe -n agentbe port-forward svc/room-acme   18861:8080 &
kubectl --context kind-agentbe -n agentbe port-forward svc/room-globex 18862:8080 &

claude mcp add --transport http room-acme   http://localhost:18861/mcp \
  --header "Authorization: Bearer tok-acme-ada"
claude mcp add --transport http room-globex http://localhost:18862/mcp \
  --header "Authorization: Bearer tok-globex-bob"

claude mcp list          # both should report Connected
```

**Restart Claude Code after adding** — MCP servers are loaded at session start, so
the tools won't appear in an already-running session. Remove with
`claude mcp remove room-acme room-globex`.

Worth trying: ask both rooms the same question. Neither can see the other's
documents, and `room-globex`'s token is genuinely rejected by `room-acme` — the
isolation is enforced, not cosmetic.

## How the sandbox provider works

`K8sWorkspaceProvider` talks to the API server over `node:https` with the pod's
projected service-account token — **no Kubernetes client library**, keeping the
dependency-light rule in §4 intact. Notes on two things that are easy to get
wrong:

- **The CA must be passed per-request.** The cluster CA isn't a system root, so
  TLS fails with *"unable to verify the first certificate"*. Setting
  `NODE_EXTRA_CA_CERTS` at runtime does **nothing** — Node reads it only at
  process start — so the CA is read from the projected volume and handed to
  `https.request` directly.
- **Sandbox pods carry a `/health` readinessProbe.** Without one, a pod's Ready
  condition means only "container started", and the room connects before the
  daemon is listening (`ECONNREFUSED`). Gating Ready on `/health` makes the
  provider's wait meaningful.

## RBAC

The room's ServiceAccount gets `create`, `get`, `list`, `delete` on pods — no
watch, no exec, no secrets. Sandbox pods set `automountServiceAccountToken: false`,
so untrusted agent code never receives a token it could use against the API server.

`list` exists solely for the **startup orphan sweep**. The session registry is
in-memory, so a room restart forgets every live session while its sandbox pod
keeps running, with no owner left to delete it. On boot the room deletes pods
carrying its own `agentbe.room/owner` label — scoped, because rooms share a
namespace and an unscoped sweep would destroy a sibling room's live sandboxes.

That's a deliberate widening: `list` lets the room enumerate pods in its
namespace. The alternative was leaking a pod per restart, indefinitely.

## Not production-ready yet

- **Storage is `emptyDir`** — a room's documents die with its pod. Set
  `AGENTBE_S3_BUCKET` (see the multi-room README) for durable, reschedulable
  rooms. This example uses `emptyDir` only to stay self-contained.
- **No NetworkPolicy.** Sandbox pods can currently reach the cluster network,
  including the API server and the other rooms. A default-deny egress policy for
  `agentbe.room/sandbox=true` pods is the obvious next hardening step — the
  sandbox needs no egress at all, since the room streams checkout/commit bytes
  to it.
- **No warm pool.** Every session pays full pod startup. `kubernetes-sigs/agent-sandbox`
  (spec §5.6) offers warm pools, pause/resume, and reaping if that cost matters.
- **No Ingress/TLS** — `check.mjs` uses `kubectl port-forward`.
