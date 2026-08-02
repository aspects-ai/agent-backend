import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll } from "vitest";

// Shared conformance suite from index-sync — proves the pg adapter matches the
// in-memory reference behavior.
import { runVectorStoreConformance } from "../../index-sync/test/support/vector-conformance.js";
import { PgVectorStore } from "../src/index.js";

const CONNECTION =
  process.env.AGENTBE_PG_URL ?? "postgresql://postgres:test@localhost:5433/agentbe";
const pool = new Pool({ connectionString: CONNECTION });

afterAll(async () => {
  await pool.end();
});

runVectorStoreConformance("pgvector", async () => {
  const namespace = `conf_${randomUUID()}`;
  const store = new PgVectorStore(pool, { dimensions: 3, namespace });
  return {
    store,
    cleanup: async () => {
      const ns = namespace.replace(/[^a-zA-Z0-9_]/g, "_");
      await pool.query(`DROP TABLE IF EXISTS ${ns}_records`);
      await pool.query(`DROP TABLE IF EXISTS ${ns}_embeddings`);
    },
  };
});
