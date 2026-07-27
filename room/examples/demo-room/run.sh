#!/usr/bin/env bash
#
# Launch a demo agent document room over MCP, seeded with the shared example
# dataset (room/testdata) and backed by the REAL embedders — MiniLM for text and
# CLIP for images (Transformers.js, offline, no API key). This is the single way
# to spin up a room to play with; the automated test suite uses a faster hashing
# embedder, so this is where you exercise the real semantic path by hand.
#
# Zero infrastructure by default: the search index lives in memory and is rebuilt
# on boot from the persistent on-disk store. Add --pg to back it with a persistent
# pgvector index instead (starts a Docker container).
#
# Usage:
#   ./run.sh              # stdio, in-memory index (no Docker) — the default
#   ./run.sh --http       # serve over HTTP on :8848 (or --http=PORT)
#   ./run.sh --pg         # persistent pgvector index (starts a Docker container)
#   ./run.sh --reset      # wipe this room's data, then re-seed from the dataset
#
# Flags combine, e.g. `./run.sh --pg --reset`. All status goes to stderr so
# stdout stays a clean MCP channel; the first launch downloads the models (a few
# seconds to a minute), cached afterwards.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOM_PKG="$(cd "$HERE/../.." && pwd)"

STORE_DIR="$HERE/.data"
# One shared corpus for the whole app — the same testdata the room test suite and
# the bin's default seed use (text + images + a PDF).
CORPUS_DIR="$ROOM_PKG/testdata"
ROOM_NAME="${AGENTBE_ROOM:-demo}"
CONTAINER="agentbe-pgvector"
PG_URL="${AGENTBE_PG_URL:-postgresql://postgres:test@localhost:5433/agentbe}"

USE_PG=0
RESET=0
HTTP_PORT=""
for arg in "$@"; do
  case "$arg" in
    --pg) USE_PG=1 ;;
    --reset) RESET=1 ;;
    --http) HTTP_PORT=8848 ;;
    --http=*) HTTP_PORT="${arg#--http=}" ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log() { echo "[demo-room] $*" >&2; }

# With --pg: ensure the pgvector container is up (create on first run, else start).
if [ "$USE_PG" = "1" ]; then
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
      log "starting existing $CONTAINER container"
      docker start "$CONTAINER" >/dev/null
    else
      log "creating $CONTAINER container (pgvector/pgvector:pg16 on :5433)"
      docker run -d --name "$CONTAINER" -p 5433:5432 \
        -e POSTGRES_PASSWORD=test -e POSTGRES_DB=agentbe \
        pgvector/pgvector:pg16 >/dev/null
    fi
  fi
  log "waiting for postgres..."
  for _ in $(seq 1 30); do
    if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

# --reset: clear the persisted store (and, with --pg, the pgvector index) so the
# next boot re-seeds from the dataset cleanly.
if [ "$RESET" = "1" ]; then
  log "resetting store dir$([ "$USE_PG" = "1" ] && echo " + pgvector index")"
  rm -rf "$STORE_DIR"
  if [ "$USE_PG" = "1" ]; then
    for ns in text image; do
      docker exec "$CONTAINER" psql -U postgres -d agentbe -q \
        -c "DROP TABLE IF EXISTS ${ns}_records; DROP TABLE IF EXISTS ${ns}_embeddings;" \
        >/dev/null 2>&1 || true
    done
  fi
fi

# Build if the bin is missing (dist is gitignored).
if [ ! -f "$ROOM_PKG/dist/bin.js" ]; then
  log "building @agentbe/room"
  pnpm --filter @agentbe/room build >&2
fi

# Launch: real embedders + the shared dataset; index in-memory unless --pg.
export AGENTBE_ROOM="$ROOM_NAME"
export AGENTBE_STORE_DIR="$STORE_DIR"
export AGENTBE_SEED_DIR="$CORPUS_DIR"
export AGENTBE_EMBEDDER=local          # real MiniLM semantic text embeddings
export AGENTBE_IMAGE_EMBEDDER=clip     # real CLIP embeddings → text→image search
if [ "$USE_PG" = "1" ]; then
  export AGENTBE_VECTOR=pg             # persistent pgvector index (text + image)
  export AGENTBE_PG_URL="$PG_URL"
fi
log "index: $([ "$USE_PG" = "1" ] && echo "pgvector (persistent)" || echo "in-memory")"
if [ -n "$HTTP_PORT" ]; then
  export AGENTBE_HTTP_PORT="$HTTP_PORT"
  log "serving room \"$ROOM_NAME\" over HTTP on :$HTTP_PORT/mcp"
else
  log "serving room \"$ROOM_NAME\" over stdio"
fi

exec node "$ROOM_PKG/dist/bin.js"
