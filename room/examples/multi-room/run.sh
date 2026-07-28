#!/usr/bin/env bash
#
# Boot several independent rooms the way a production deploy would: ONE PROCESS
# PER ROOM, each with its own store, port, and principal tokens.
#
# This is the "multi-tenant" shape for this product — but the tenant is the
# *room*, not the organization (see specs/agent-document-room.md §7). A room may
# legitimately span orgs (two parties in a deal), so isolation comes from
# separate rooms + separate credentials, not from an org partition in a schema.
#
# Usage:
#   ./run.sh            # boot acme (:8861) and globex (:8862), wait
#   ./run.sh --reset    # wipe both stores first
#
# All status goes to stderr. Ctrl-C (or SIGTERM) tears both rooms down.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOM_PKG="$(cd "$HERE/../.." && pwd)"
DATA="$HERE/.data"

# room-name:port:token=principal[,token=principal...]
ROOMS=(
  "acme:8861:tok-acme-ada=ada@acme.com,tok-acme-grace=grace@acme.com"
  "globex:8862:tok-globex-bob=bob@globex.com"
)

RESET=0
USE_S3=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    # Run the rooms on the S3 tier (the production store) instead of local
    # disk, against LocalStack. Each room gets its own key prefix.
    --s3) USE_S3=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

S3_ENDPOINT="${AGENTBE_S3_ENDPOINT:-http://localhost:4566}"
S3_BUCKET="${AGENTBE_S3_BUCKET:-agentbe-multi-room}"

log() { echo "[multi-room] $*" >&2; }

[ "$RESET" = "1" ] && { log "resetting stores"; rm -rf "$DATA"; }

# --s3: run the rooms on the S3 tier against LocalStack. Each room writes under
# its own key prefix; in production a bucket per org additionally buys IAM-level
# isolation, per-org lifecycle rules, and per-org data residency.
S3_RUN_PREFIX=""
if [ "$USE_S3" = "1" ]; then
  # Reuse whatever is already serving the endpoint, whatever it's called — this
  # repo commonly has an "agentbe-localstack" container up already, and binding
  # a second one to :4566 just fails.
  if ! curl -sf "$S3_ENDPOINT/_localstack/health" >/dev/null 2>&1; then
    if docker ps -a --format '{{.Names}}' | grep -q '^agentbe-localstack$'; then
      log "starting existing agentbe-localstack container"
      docker start agentbe-localstack >/dev/null
    else
      log "creating agentbe-localstack container (s3 on :4566)"
      docker run -d --name agentbe-localstack -p 4566:4566 -e SERVICES=s3 \
        localstack/localstack:3 >/dev/null
    fi
    log "waiting for localstack..."
    for _ in $(seq 1 60); do
      curl -sf "$S3_ENDPOINT/_localstack/health" >/dev/null 2>&1 && break
      sleep 1
    done
  else
    log "reusing the localstack already serving $S3_ENDPOINT"
  fi

  # Create the bucket with a plain PUT — no awslocal, so this doesn't depend on
  # the container's name or tooling. Idempotent.
  curl -sf -X PUT "$S3_ENDPOINT/$S3_BUCKET" >/dev/null 2>&1 || true

  # --reset on S3 uses a fresh key prefix rather than deleting objects: it needs
  # no S3 tooling and cannot touch data outside this run.
  [ "$RESET" = "1" ] && S3_RUN_PREFIX="run-$(date +%s)/"
  log "store: s3://$S3_BUCKET/${S3_RUN_PREFIX} (endpoint $S3_ENDPOINT)"
fi

# The published daemon image is amd64-only; emulate on Apple Silicon.
if [ -z "${AGENTBE_SANDBOX_PLATFORM:-}" ]; then
  case "$(uname -m)" in
    arm64|aarch64) export AGENTBE_SANDBOX_PLATFORM=linux/amd64 ;;
  esac
fi

if [ ! -f "$ROOM_PKG/dist/bin.js" ]; then
  log "building @agentbe/room"
  pnpm --filter @agentbe/room build >&2
fi

# Turn "tok=principal,tok=principal" into the JSON map the bin expects.
to_json() {
  python3 -c "
import sys
pairs = [p.split('=', 1) for p in sys.argv[1].split(',')]
import json; print(json.dumps({k: v for k, v in pairs}))
" "$1"
}

pids=()
cleanup() {
  log "shutting down"
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  # Give them a moment to exit, then insist — a surviving room keeps its port
  # bound and the next run fails to bind.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    local_alive=0
    for pid in "${pids[@]:-}"; do kill -0 "$pid" 2>/dev/null && local_alive=1; done
    [ "$local_alive" = "0" ] && break
    sleep 0.3
  done
  for pid in "${pids[@]:-}"; do kill -9 "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for spec in "${ROOMS[@]}"; do
  IFS=: read -r name port creds <<< "$spec"
  seed="$DATA/$name/seed"
  mkdir -p "$seed"
  # Distinct content per room, so a cross-room leak is unmistakable.
  echo "$name confidential: the $name deal memo" > "$seed/$name-secret.md"
  echo "shared-looking filename, different content for $name" > "$seed/notes.md"

  # S3 tier when --s3, else the single-node filesystem store.
  if [ "$USE_S3" = "1" ]; then
    s3_env=(
      "AGENTBE_S3_BUCKET=$S3_BUCKET"
      "AGENTBE_S3_PREFIX=${S3_RUN_PREFIX}$name/"
      "AGENTBE_S3_REGION=us-east-1"
      "AGENTBE_S3_ENDPOINT=$S3_ENDPOINT"
      "AGENTBE_S3_ACCESS_KEY_ID=test"
      "AGENTBE_S3_SECRET_ACCESS_KEY=test"
    )
  else
    s3_env=()
  fi

  env "${s3_env[@]}" \
  AGENTBE_ROOM="$name" \
  AGENTBE_STORE_DIR="$DATA/$name/store" \
  AGENTBE_SEED_DIR="$seed" \
  AGENTBE_EMBEDDER=hash \
  AGENTBE_IMAGE_EMBEDDER=none \
  AGENTBE_HTTP_PORT="$port" \
  AGENTBE_HTTP_HOST=127.0.0.1 \
  AGENTBE_PRINCIPALS="$(to_json "$creds")" \
  node "$ROOM_PKG/dist/bin.js" > >(sed "s/^/[$name] /" >&2) 2>&1 &
  # Process substitution (not a pipeline) so $! is node's pid, not sed's —
  # otherwise cleanup kills the log filter and leaves the room running.
  pids+=($!)
  log "started room \"$name\" on :$port"
done

wait
