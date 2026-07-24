#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRoomService, seedRoomFromDir } from "./bootstrap.js";
import { serveRoomStdio } from "./mcp/server.js";

// Serve a demo room over stdio for an MCP client (e.g. Claude Code).
// Config via env: AGENTBE_ROOM (room name), AGENTBE_STORE_DIR (persistent store,
// default room/.room-data), AGENTBE_SEED_DIR (seed corpus for a fresh store).
// All status goes to stderr — stdout is the MCP channel.
const here = path.dirname(fileURLToPath(import.meta.url));
const room = process.env.AGENTBE_ROOM ?? "demo";
const storeDir = process.env.AGENTBE_STORE_DIR ?? path.join(here, "..", ".room-data");
const seedDir = process.env.AGENTBE_SEED_DIR ?? path.join(here, "..", "testdata");

const service = buildRoomService({ storeDir });

const existingHead = await service.head(room);
if (existingHead) {
  // Persistent store already has this room — rebuild the (derived) index.
  await service.reindexHead(room);
  console.error(`[agentbe-room] loaded "${room}" from ${storeDir} (HEAD ${existingHead.slice(0, 12)})`);
} else {
  try {
    const n = await seedRoomFromDir(service, room, seedDir);
    console.error(`[agentbe-room] seeded new "${room}" with ${n} documents → ${storeDir}`);
  } catch (err) {
    console.error(`[agentbe-room] seed skipped: ${(err as Error).message}`);
  }
}

await serveRoomStdio(service, room);
console.error(`[agentbe-room] serving room "${room}" over stdio`);
