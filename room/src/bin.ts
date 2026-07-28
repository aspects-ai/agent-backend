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

const service = buildRoomService({ storeDir, embedder, imageEmbedder, vectors, imageVectors });

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

// Transport: HTTP if AGENTBE_HTTP_PORT is set (hosted / shared), else stdio.
const httpPort = process.env.AGENTBE_HTTP_PORT ? Number(process.env.AGENTBE_HTTP_PORT) : undefined;
if (httpPort !== undefined) {
  const handle = await serveRoomHttp(service, room, {
    port: httpPort,
    authToken: process.env.AGENTBE_AUTH_TOKEN,
    sessionIdleMs,
  });
  const auth = process.env.AGENTBE_AUTH_TOKEN ? "bearer-token required" : "open";
  console.error(`[agentbe-room] serving room "${room}" over HTTP :${handle.port}/mcp (${auth})`);
} else {
  await serveRoomStdio(service, room, { sessionIdleMs });
  console.error(`[agentbe-room] serving room "${room}" over stdio`);
}
