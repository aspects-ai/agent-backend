#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createEmbeddingProvider,
  createImageEmbeddingProvider,
  type EmbedderKind,
} from "@agentbe/embeddings";

import { buildRoomService, seedRoomFromDir } from "./bootstrap.js";
import { serveRoomHttp } from "./mcp/http.js";
import { serveRoomStdio } from "./mcp/server.js";
import { AutoWorkspaceProvider, type WorkspaceMode } from "./workspace-auto.js";

// Serve a demo room over stdio for an MCP client (e.g. Claude Code).
// Config via env: AGENTBE_ROOM (room name), AGENTBE_STORE_DIR (persistent store,
// default room/.room-data), AGENTBE_SEED_DIR (seed corpus for a fresh store).
// All status goes to stderr — stdout is the MCP channel.
const here = path.dirname(fileURLToPath(import.meta.url));
const room = process.env.AGENTBE_ROOM ?? "demo";
const storeDir = process.env.AGENTBE_STORE_DIR ?? path.join(here, "..", ".room-data");
const seedDir = process.env.AGENTBE_SEED_DIR ?? path.join(here, "..", "testdata");

// Embedder: local semantic model by default (offline, no key); switch with
// AGENTBE_EMBEDDER=openai|ollama|hash (+ AGENTBE_EMBED_MODEL to override).
const embedderKind = (process.env.AGENTBE_EMBEDDER ?? "local") as EmbedderKind;
const embedder = createEmbeddingProvider({ kind: embedderKind, model: process.env.AGENTBE_EMBED_MODEL });
console.error(`[agentbe-room] embedder: ${embedderKind}`);

// Image embedder: local CLIP by default (offline, no key). Set
// AGENTBE_IMAGE_EMBEDDER=none to disable image indexing.
const imageEmbedder =
  process.env.AGENTBE_IMAGE_EMBEDDER === "none"
    ? undefined
    : createImageEmbeddingProvider({ model: process.env.AGENTBE_IMAGE_MODEL });
console.error(`[agentbe-room] image embedder: ${imageEmbedder ? "clip" : "none"}`);

// Vector store: in-memory (rebuilt on boot) by default; AGENTBE_VECTOR=pg uses a
// persistent pgvector index (AGENTBE_PG_URL). Separate namespaces per space.
const persistentVectors = process.env.AGENTBE_VECTOR === "pg";
let vectors;
let imageVectors;
if (persistentVectors) {
  const { Pool } = await import("pg");
  const { PgVectorStore } = await import("@agentbe/vector-pg");
  const pool = new Pool({ connectionString: process.env.AGENTBE_PG_URL });
  vectors = new PgVectorStore(pool, { dimensions: embedder.dimensions, namespace: "text" });
  if (imageEmbedder) {
    imageVectors = new PgVectorStore(pool, {
      dimensions: imageEmbedder.dimensions,
      namespace: "image",
    });
  }
}
console.error(`[agentbe-room] vector store: ${persistentVectors ? "pgvector" : "in-memory"}`);

// Sandbox: a per-session Docker container by default, falling back to an
// UNSANDBOXED temp dir (with a loud warning) when Docker isn't reachable. Force
// either with AGENTBE_SANDBOX=docker|local; AGENTBE_DAEMON_IMAGE pins the image.
const workspaces = new AutoWorkspaceProvider({
  mode: process.env.AGENTBE_SANDBOX as WorkspaceMode | undefined,
  image: process.env.AGENTBE_DAEMON_IMAGE,
  network: process.env.AGENTBE_SANDBOX_NETWORK,
  platform: process.env.AGENTBE_SANDBOX_PLATFORM,
});
// Resolve now so the mode (and any warning) is visible at boot, not at the
// first run_command minutes later.
console.error(`[agentbe-room] sandbox: ${await workspaces.preflight()}`);

// Canonical store: S3 when AGENTBE_S3_BUCKET is set (durable, multi-node — the
// production tier), otherwise the filesystem store under AGENTBE_STORE_DIR,
// which pins the room to this node's disk. AGENTBE_S3_ENDPOINT points at
// LocalStack/MinIO/R2; credentials fall back to the default AWS provider chain
// (instance role, IRSA, env) when not given explicitly.
let blobs;
let rooms;
if (process.env.AGENTBE_S3_BUCKET) {
  const { createS3Stores } = await import("./stores-s3.js");
  const accessKeyId = process.env.AGENTBE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AGENTBE_S3_SECRET_ACCESS_KEY;
  ({ blobs, rooms } = await createS3Stores({
    bucket: process.env.AGENTBE_S3_BUCKET,
    prefix: process.env.AGENTBE_S3_PREFIX,
    region: process.env.AGENTBE_S3_REGION,
    endpoint: process.env.AGENTBE_S3_ENDPOINT,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  }));
  const where = `s3://${process.env.AGENTBE_S3_BUCKET}/${process.env.AGENTBE_S3_PREFIX ?? ""}`;
  console.error(`[agentbe-room] store: ${where}${process.env.AGENTBE_S3_ENDPOINT ? " (custom endpoint)" : ""}`);
} else {
  console.error(`[agentbe-room] store: fs ${storeDir} (single-node; set AGENTBE_S3_BUCKET for S3)`);
}

const service = buildRoomService({
  storeDir,
  blobs,
  rooms,
  embedder,
  imageEmbedder,
  vectors,
  imageVectors,
  workspaces,
});

const existingHead = await service.head(room);
if (existingHead) {
  // In-memory index must be rebuilt from the persistent store on boot; a
  // persistent (pgvector) index survives, so skip the re-embed.
  if (!persistentVectors) await service.reindexHead(room);
  console.error(
    `[agentbe-room] loaded "${room}" (HEAD ${existingHead.slice(0, 12)}; ${persistentVectors ? "persistent index" : "index rebuilt"})`,
  );
} else {
  try {
    const n = await seedRoomFromDir(service, room, seedDir);
    console.error(`[agentbe-room] seeded new "${room}" with ${n} documents → ${storeDir}`);
  } catch (err) {
    console.error(`[agentbe-room] seed skipped: ${(err as Error).message}`);
  }
}

// Warm sandboxes are released after this long with no activity (0 disables).
// Matters most over HTTP, where a client can vanish without close_session.
const sessionIdleMs = process.env.AGENTBE_SESSION_IDLE_MS
  ? Number(process.env.AGENTBE_SESSION_IDLE_MS)
  : undefined;

// Identity. AGENTBE_PRINCIPALS is a JSON map of bearer token -> principal id
// (e.g. {"tok_abc":"ada@example.com"}), giving per-person attribution and
// per-person revocation. AGENTBE_AUTH_TOKEN is the older single shared secret:
// it authenticates but identifies nobody, so commits land as "anonymous".
let principals: Record<string, string> | undefined;
if (process.env.AGENTBE_PRINCIPALS) {
  try {
    principals = JSON.parse(process.env.AGENTBE_PRINCIPALS) as Record<string, string>;
  } catch (err) {
    console.error(`[agentbe-room] AGENTBE_PRINCIPALS is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!principals || Object.keys(principals).length === 0) {
    console.error("[agentbe-room] AGENTBE_PRINCIPALS is empty — refusing to start with no valid credentials");
    process.exit(1);
  }
}

// Transport: HTTP if AGENTBE_HTTP_PORT is set (hosted / shared), else stdio.
const httpPort = process.env.AGENTBE_HTTP_PORT ? Number(process.env.AGENTBE_HTTP_PORT) : undefined;
if (httpPort !== undefined) {
  // Defaults to loopback. A container must set AGENTBE_HTTP_HOST=0.0.0.0 or the
  // published port accepts nothing from outside.
  const host = process.env.AGENTBE_HTTP_HOST ?? "127.0.0.1";
  const handle = await serveRoomHttp(service, room, {
    port: httpPort,
    host,
    authToken: process.env.AGENTBE_AUTH_TOKEN,
    principals,
    sessionIdleMs,
  });
  const auth = principals
    ? `${Object.keys(principals).length} principal token(s)`
    : process.env.AGENTBE_AUTH_TOKEN
      ? "shared token (commits attributed to 'anonymous')"
      : "OPEN — no authentication";
  console.error(
    `[agentbe-room] serving room "${room}" over HTTP ${host}:${handle.port}/mcp (auth: ${auth})`,
  );
} else {
  // stdio is a single local user; name them for the commit log.
  const principal = process.env.AGENTBE_PRINCIPAL;
  await serveRoomStdio(service, room, { sessionIdleMs, principal });
  console.error(`[agentbe-room] serving room "${room}" over stdio`);
}
