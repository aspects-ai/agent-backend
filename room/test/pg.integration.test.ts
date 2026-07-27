import { randomUUID } from "node:crypto";

import { HashingEmbeddingProvider } from "@agentbe/index-sync";
import { PgVectorStore } from "@agentbe/vector-pg";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { buildRoomService } from "../src/index.js";

const CONNECTION =
  process.env.AGENTBE_PG_URL ?? "postgresql://postgres:test@localhost:5433/agentbe";
const pool = new Pool({ connectionString: CONNECTION });
const ROOM = "room";

afterAll(async () => {
  await pool.end();
});

describe("room over pgvector", () => {
  it("indexes and searches through a persistent pgvector store", async () => {
    const namespace = `room_${randomUUID()}`;
    // Hash embedder (256-dim, no download) → pgvector text index.
    const vectors = new PgVectorStore(pool, { dimensions: 256, namespace });
    try {
      const service = buildRoomService({ embedder: new HashingEmbeddingProvider(), vectors });
      await service.putDocuments(
        ROOM,
        {
          "vendors.md": "Acme vendor invoice payment terms net-30",
          "recipes.md": "cooking pasta with tomato and basil",
        },
        "alice",
      );
      const hits = await service.search(ROOM, "vendor invoice payment", 3, "text");
      expect(hits[0]?.path).toBe("vendors.md");
    } finally {
      const ns = namespace.replace(/[^a-zA-Z0-9_]/g, "_");
      await pool.query(`DROP TABLE IF EXISTS ${ns}_records`);
      await pool.query(`DROP TABLE IF EXISTS ${ns}_embeddings`);
    }
  });
});
