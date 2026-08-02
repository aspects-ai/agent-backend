#!/usr/bin/env bash
#
# Bring up the whole local Kubernetes environment for the document room, from an
# empty machine to two rooms serving. Idempotent — safe to re-run; steps that are
# already done are skipped, and images are always rebuilt so code changes land.
#
#   ./up.sh          # provision everything
#   ./up.sh --skip-images   # reuse the images already in the cluster
#
# Every kubectl call names the context explicitly. Never rely on the current
# context: on a dev machine it is often a production cluster.
set -euo pipefail

CLUSTER=agentbe
CTX="kind-${CLUSTER}"
NS=agentbe
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"

CALICO=https://raw.githubusercontent.com/projectcalico/calico/v3.28.2/manifests/calico.yaml
AGENT_SANDBOX=https://github.com/kubernetes-sigs/agent-sandbox/releases/download/v0.5.3/sandbox-with-extensions.yaml

SKIP_IMAGES=0
for arg in "$@"; do
  case "$arg" in
    --skip-images) SKIP_IMAGES=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log() { echo "[k8s-up] $*" >&2; }
k() { kubectl --context "$CTX" "$@"; }

# 1. Cluster. kindnet does NOT enforce NetworkPolicy, so the sandbox policies
#    would apply cleanly and do nothing — hence Calico.
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  log "cluster '$CLUSTER' exists"
else
  log "creating cluster '$CLUSTER' (no default CNI)"
  kind create cluster --name "$CLUSTER" --config=/dev/stdin <<'YAML' >&2
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  disableDefaultCNI: true
  podSubnet: "192.168.0.0/16"
YAML
fi

# 2. Calico — without an enforcing CNI the NetworkPolicy checks pass vacuously.
if k -n kube-system get daemonset calico-node >/dev/null 2>&1; then
  log "calico present"
else
  log "installing calico"
  k apply -f "$CALICO" >/dev/null
fi
k -n kube-system rollout status deploy/calico-kube-controllers --timeout=300s >&2
k wait --for=condition=Ready node --all --timeout=300s >&2

# 3. agent-sandbox — provides the warm pool the acme room claims from.
if k get crd sandboxclaims.extensions.agents.x-k8s.io >/dev/null 2>&1; then
  log "agent-sandbox present"
else
  log "installing agent-sandbox"
  k apply --server-side -f "$AGENT_SANDBOX" >/dev/null
fi
k -n agent-sandbox-system rollout status deploy/agent-sandbox-controller --timeout=300s >&2

# 4. Images. Always rebuilt unless told otherwise: this is where code changes
#    enter the cluster, and a stale image is the most confusing failure here.
#    The published daemon image is amd64-only, so build it natively instead.
if [ "$SKIP_IMAGES" = "0" ]; then
  log "building images"
  docker build -q -f "$REPO/room/Dockerfile" -t agentbe-room:dev "$REPO" >/dev/null
  docker build -q -f "$REPO/agentbe-daemon/docker/Dockerfile" \
    --build-arg AGENTBE_VERSION=local -t agentbe-daemon:arm64-dev "$REPO" >/dev/null
  log "loading images into the cluster"
  kind load docker-image agentbe-room:dev agentbe-daemon:arm64-dev --name "$CLUSTER" >&2
fi

# 5. Namespace + per-room seed corpora. Distinct content per room so a
#    cross-room leak is unmistakable rather than subtle.
k create namespace "$NS" --dry-run=client -o yaml | k apply -f - >/dev/null
for room in acme globex; do
  seed="$(mktemp -d)"
  echo "$room confidential: the $room deal memo" > "$seed/$room-secret.md"
  echo "shared-looking filename, different content for $room" > "$seed/notes.md"
  k -n "$NS" create configmap "$room-seed" --from-file="$seed" \
    --dry-run=client -o yaml | k apply -f - >/dev/null
  rm -rf "$seed"
done

# 6. Sandbox pool + policy, then the rooms.
k apply -f "$HERE/sandbox-pool.yaml" >/dev/null
k apply -f "$HERE/rooms.yaml" >/dev/null
k -n "$NS" rollout restart deploy/room-acme deploy/room-globex >/dev/null 2>&1 || true
k -n "$NS" rollout status deploy/room-acme --timeout=300s >&2
k -n "$NS" rollout status deploy/room-globex --timeout=300s >&2

log "ready. rooms:"
k -n "$NS" get deploy -o name >&2
cat >&2 <<EOF

  make k8s-test      verify isolation end to end
  make k8s-forward   supervised port-forwards (acme :18861, globex :18862)
  make k8s-down      delete the cluster
EOF
