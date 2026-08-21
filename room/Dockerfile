# @agentbe/room — the document-room MCP server.
#
# Build from the REPO ROOT (the build needs the whole pnpm workspace):
#   docker build -f room/Dockerfile -t agentbe-room:dev .
#
# Runtime config is all environment (see room/src/bin.ts):
#   AGENTBE_ROOM, AGENTBE_HTTP_PORT, AGENTBE_HTTP_HOST (0.0.0.0 in a container!),
#   AGENTBE_PRINCIPALS, AGENTBE_S3_*, AGENTBE_VECTOR, AGENTBE_SANDBOX.
FROM node:26-slim AS builder

# Pin pnpm: the repo has no packageManager field, and corepack would otherwise
# pull whatever is latest (pnpm 11 needs Node 22+ and drifts from local builds).
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /app

# Workspace manifests first, so dependency install caches independently of source.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/agent-backend/typescript/package.json packages/agent-backend/typescript/
COPY packages/versioned-store/package.json packages/versioned-store/
COPY packages/index-sync/package.json packages/index-sync/
COPY packages/embeddings/package.json packages/embeddings/
COPY packages/ingestion/package.json packages/ingestion/
COPY packages/vector-pg/package.json packages/vector-pg/
COPY room/package.json room/

# --ignore-scripts: no package here needs postinstall, and it keeps the build
# hermetic. --filter to skip the examples workspaces entirely.
RUN pnpm install --frozen-lockfile --ignore-scripts \
      --filter "@agentbe/room..." --filter "agent-backend..."

COPY packages/ packages/
COPY room/ room/
RUN pnpm --filter "@agentbe/room..." build

FROM node:26-slim AS runtime

# The Docker sandbox provider shells out to `docker`, which does not exist in a
# pod — see AGENTBE_SANDBOX below.
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/room ./room

# Bind all interfaces: the default is loopback, which a Service cannot reach.
ENV AGENTBE_HTTP_HOST=0.0.0.0
ENV AGENTBE_HTTP_PORT=8080
EXPOSE 8080

# Run unprivileged. `node` (uid 1000) ships in the base image.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
ENV AGENTBE_STORE_DIR=/data

CMD ["node", "room/dist/bin.js"]
