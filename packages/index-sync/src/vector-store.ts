/** A room's path → content-hash record. */
export interface RoomRecord {
  path: string;
  hash: string;
}

/** A ranked search result. */
export interface QueryHit {
  path: string;
  hash: string;
  score: number;
}

/**
 * Storage for embeddings and per-room path records. Embeddings are keyed by
 * content hash (so identical content is embedded once and reused across paths
 * and rooms); records map a room's paths to those hashes. Bring your own vector
 * DB by implementing this; {@link InMemoryVectorStore} is the reference.
 */
export interface VectorStore {
  hasEmbedding(hash: string): Promise<boolean>;
  putEmbedding(hash: string, vector: number[]): Promise<void>;
  upsertRecords(room: string, records: RoomRecord[]): Promise<void>;
  deleteRecords(room: string, paths: string[]): Promise<void>;
  clearRoom(room: string): Promise<void>;
  /** Top-k records in a room by cosine similarity to `vector`. */
  query(room: string, vector: number[], k: number): Promise<QueryHit[]>;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** In-memory reference VectorStore (tests / local dev). */
export class InMemoryVectorStore implements VectorStore {
  private readonly embeddings = new Map<string, number[]>();
  /** room -> (path -> hash) */
  private readonly rooms = new Map<string, Map<string, string>>();

  async hasEmbedding(hash: string): Promise<boolean> {
    return this.embeddings.has(hash);
  }

  async putEmbedding(hash: string, vector: number[]): Promise<void> {
    this.embeddings.set(hash, vector);
  }

  async upsertRecords(room: string, records: RoomRecord[]): Promise<void> {
    let map = this.rooms.get(room);
    if (!map) {
      map = new Map();
      this.rooms.set(room, map);
    }
    for (const record of records) map.set(record.path, record.hash);
  }

  async deleteRecords(room: string, paths: string[]): Promise<void> {
    const map = this.rooms.get(room);
    if (!map) return;
    for (const path of paths) map.delete(path);
  }

  async clearRoom(room: string): Promise<void> {
    this.rooms.delete(room);
  }

  async query(room: string, vector: number[], k: number): Promise<QueryHit[]> {
    const map = this.rooms.get(room);
    if (!map) return [];
    const hits: QueryHit[] = [];
    for (const [path, hash] of map) {
      const embedding = this.embeddings.get(hash);
      if (!embedding) continue;
      hits.push({ path, hash, score: cosine(vector, embedding) });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}
