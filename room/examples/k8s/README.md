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
make k8s-up      # empty machine -> two rooms serving (~5 min; re-runs take ~7s)
make k8s-test    # verify isolation end to end
make k8s-forward # supervised port-forwards, acme :18861 / globex :18862
make k8s-down    # delete the cluster
```

`make k8s-up` is idempotent: it creates the cluster, installs Calico and
agent-sandbox, builds and side-loads both images, and applies the pool and rooms
— skipping whatever is already in place. Images are always rebuilt, since a stale
image is the most confusing failure here; pass `SKIP_IMAGES=1` to skip that too.

`make dev-down` tears down everything local, including the LocalStack and
pgvector containers the other examples start.

Two things it handles that are easy to get wrong by hand: kind's default CNI
(kindnet) does **not** enforce NetworkPolicy, so the cluster is created with
`disableDefaultCNI` and Calico installed — otherwise the sandbox policies apply
cleanly and do nothing. And the published daemon image is amd64-only, so the
daemon is built natively rather than pulled.

Port-forwards are supervised via mprocs rather than backgrounded because they die
whenever a room pod restarts — silently, which makes a redeploy look like a room
failure. In mprocs the process shows as stopped and `r` restarts it.

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
- **NetworkPolicy is applied and verified** (`sandbox-pool.yaml`): ingress to
  sandboxes only from room pods on 3001/3002; egress to DNS and the public
  internet with every private range denied, including `169.254.0.0/16` (cloud
  metadata). Proven from inside a live sandbox — reaching another sandbox's token
  endpoint and the kube-apiserver both **BLOCKED**.
  **This needs an enforcing CNI.** kind's default kindnet ignores NetworkPolicy
  entirely, so the cluster must be created with `disableDefaultCNI: true` and
  Calico installed, or the policy applies cleanly and does nothing.
- **Warm pool available** via agent-sandbox (`room/examples/k8s/sandbox-pool.yaml`,
  `AGENTBE_SANDBOX=agent-sandbox`). Measured `open_session` at ~0.4s against ~1.6s
  for the raw-pod provider on an already-warm local node — the gap widens sharply
  on a real cluster, where cold start includes scheduling and image pull.
  The example runs **one room on each provider** so both stay exercised:
  `acme` uses agent-sandbox, `globex` uses raw pods.
- **Pause/resume is not wired up.** Sessions hold a live ssh-ws connection that a
  pod pause would drop; `service: true` on the SandboxTemplate gives each sandbox
  a stable address, which is the prerequisite.
- **No Ingress/TLS** — `check.mjs` uses `kubectl port-forward`.
