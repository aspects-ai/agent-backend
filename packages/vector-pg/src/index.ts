import type { QueryHit, RoomRecord, VectorStore } from "@agentbe/index-sync";

/** Minimal structural view of a `pg` client/pool — pass a `pg.Pool`. Keeping it
 * structural means this package needs no hard dependency on `pg`. */
export interface PgQueryable {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export interface PgVectorStoreOptions {
  /** Embedding dimension for this index — must match the embedder. Required
   * because pgvector columns are fixed-dimension (text 384 vs image 512 → use
   * separate stores/namespaces). */
  dimensions: number;
  /** Table namespace, so text and image indexes don't collide. Default "agentbe". */
  namespace?: string;
}

function toVector(v: number[]): string {
  return `[${v.join(",")}]`;
}

/**
 * A pgvector-backed {@link VectorStore}: persistent, ANN-indexed vector search.
 * Two tables per namespace — `<ns>_embeddings` (hash → vector, content-addressed
 * so identical content is embedded once) and `<ns>_records` (room, path → hash).
 * `query` cosine-ranks a room's records against the query vector. Tables +
 * the `vector` extension are created lazily on first use.
 */
export class PgVectorStore implements VectorStore {
  private readonly embTable: string;
  private readonly recTable: string;
  private ready?: Promise<void>;

  constructor(
    private readonly db: PgQueryable,
    private readonly options: PgVectorStoreOptions,
  ) {
    const ns = (options.namespace ?? "agentbe").replace(/[^a-zA-Z0-9_]/g, "_");
    this.embTable = `${ns}_embeddings`;
    this.recTable = `${ns}_records`;
  }

  private init(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.db.query("CREATE EXTENSION IF NOT EXISTS vector");
        await this.db.query(
          `CREATE TABLE IF NOT EXISTS ${this.embTable} (hash text PRIMARY KEY, embedding vector(${this.options.dimensions}))`,
        );
        await this.db.query(
          `CREATE TABLE IF NOT EXISTS ${this.recTable} (room text NOT NULL, path text NOT NULL, hash text NOT NULL, PRIMARY KEY (room, path))`,
        );
        await this.db
          .query(
            `CREATE INDEX IF NOT EXISTS ${this.embTable}_hnsw ON ${this.embTable} USING hnsw (embedding vector_cosine_ops)`,
          )
          .catch(() => {
            /* HNSW may be unavailable on older pgvector — cosine still works via scan */
          });
      })();
    }
    return this.ready;
  }

  async hasEmbedding(hash: string): Promise<boolean> {
    await this.init();
    const res = await this.db.query(`SELECT 1 FROM ${this.embTable} WHERE hash = $1`, [hash]);
    return (res.rowCount ?? 0) > 0;
  }

  async putEmbedding(hash: string, vector: number[]): Promise<void> {
    await this.init();
    await this.db.query(
      `INSERT INTO ${this.embTable} (hash, embedding) VALUES ($1, $2::vector) ON CONFLICT (hash) DO UPDATE SET embedding = EXCLUDED.embedding`,
      [hash, toVector(vector)],
    );
  }

  async upsertRecords(room: string, records: RoomRecord[]): Promise<void> {
    await this.init();
    for (const record of records) {
      await this.db.query(
        `INSERT INTO ${this.recTable} (room, path, hash) VALUES ($1, $2, $3) ON CONFLICT (room, path) DO UPDATE SET hash = EXCLUDED.hash`,
        [room, record.path, record.hash],
      );
    }
  }

  async deleteRecords(room: string, paths: string[]): Promise<void> {
    await this.init();
    if (paths.length === 0) return;
    await this.db.query(`DELETE FROM ${this.recTable} WHERE room = $1 AND path = ANY($2)`, [
      room,
      paths,
    ]);
  }

  async clearRoom(room: string): Promise<void> {
    await this.init();
    await this.db.query(`DELETE FROM ${this.recTable} WHERE room = $1`, [room]);
  }

  async query(room: string, vector: number[], k: number): Promise<QueryHit[]> {
    await this.init();
    const res = await this.db.query(
      `SELECT r.path, r.hash, 1 - (e.embedding <=> $2::vector) AS score
         FROM ${this.recTable} r
         JOIN ${this.embTable} e ON e.hash = r.hash
        WHERE r.room = $1
        ORDER BY e.embedding <=> $2::vector ASC
        LIMIT $3`,
      [room, toVector(vector), k],
    );
    return res.rows.map((row) => ({
      path: String(row.path),
      hash: String(row.hash),
      score: Number(row.score),
    }));
  }
}
