import type { BlobStore, ManifestEntry, RoomStore } from "@agentbe/versioned-store";

import { isEmbeddablePath } from "./embeddable.js";
import type { EmbeddingProvider } from "./embedding.js";
import type { QueryHit, RoomRecord, VectorStore } from "./vector-store.js";

export interface IndexSyncOptions {
  /** Override which paths are embedded. Defaults to text-like extensions. */
  isEmbeddable?: (path: string) => boolean;
}

export interface SyncResult {
  indexed: number;
}

export interface SyncDiffResult {
  added: number;
  changed: number;
  deleted: number;
}

/**
 * Keeps a {@link VectorStore} in step with a versioned-store room. Embeddings
 * are content-addressed by blob hash, so unchanged blobs are never re-embedded —
 * whether across paths, across rooms, or across repeated syncs.
 */
export class IndexSync {
  private readonly isEmbeddable: (path: string) => boolean;

  constructor(
    private readonly blobs: BlobStore,
    private readonly rooms: RoomStore,
    private readonly embedder: EmbeddingProvider,
    private readonly vectors: VectorStore,
    options: IndexSyncOptions = {},
  ) {
    this.isEmbeddable = options.isEmbeddable ?? isEmbeddablePath;
  }

  /** Full (re)index of a room at `ref`. Replaces the room's records. */
  async sync(room: string, ref: string): Promise<SyncResult> {
    const manifest = await this.rooms.getManifest(room, ref);
    const records = this.embeddableRecords(manifest.entries);
    await this.ensureEmbeddings(records);
    await this.vectors.clearRoom(room);
    if (records.length > 0) await this.vectors.upsertRecords(room, records);
    return { indexed: records.length };
  }

  /** Incremental sync from `fromRef` to `toRef`, touching only what changed. */
  async syncDiff(room: string, fromRef: string, toRef: string): Promise<SyncDiffResult> {
    const [from, to] = await Promise.all([
      this.rooms.getManifest(room, fromRef),
      this.rooms.getManifest(room, toRef),
    ]);
    const fromEntries = this.filterEmbeddable(from.entries);
    const toEntries = this.filterEmbeddable(to.entries);

    const upserts: RoomRecord[] = [];
    let added = 0;
    let changed = 0;
    for (const [path, entry] of Object.entries(toEntries)) {
      const prev = fromEntries[path];
      if (!prev) {
        upserts.push({ path, hash: entry.hash });
        added++;
      } else if (prev.hash !== entry.hash) {
        upserts.push({ path, hash: entry.hash });
        changed++;
      }
    }

    const deletedPaths: string[] = [];
    for (const path of Object.keys(fromEntries)) {
      if (!(path in toEntries)) deletedPaths.push(path);
    }

    await this.ensureEmbeddings(upserts);
    if (upserts.length > 0) await this.vectors.upsertRecords(room, upserts);
    if (deletedPaths.length > 0) await this.vectors.deleteRecords(room, deletedPaths);

    return { added, changed, deleted: deletedPaths.length };
  }

  /** Semantic query, room-scoped. Returns paths/hashes to feed into checkout. */
  async query(room: string, text: string, k = 5): Promise<QueryHit[]> {
    const [vector] = await this.embedder.embed([text]);
    if (!vector) return [];
    return this.vectors.query(room, vector, k);
  }

  private filterEmbeddable(
    entries: Record<string, ManifestEntry>,
  ): Record<string, ManifestEntry> {
    const out: Record<string, ManifestEntry> = {};
    for (const [path, entry] of Object.entries(entries)) {
      if (this.isEmbeddable(path)) out[path] = entry;
    }
    return out;
  }

  private embeddableRecords(entries: Record<string, ManifestEntry>): RoomRecord[] {
    const records: RoomRecord[] = [];
    for (const [path, entry] of Object.entries(entries)) {
      if (this.isEmbeddable(path)) records.push({ path, hash: entry.hash });
    }
    return records;
  }

  /** Embed any content hashes not already in the vector store (dedup). */
  private async ensureEmbeddings(records: RoomRecord[]): Promise<void> {
    const need: string[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.hash)) continue;
      seen.add(record.hash);
      if (!(await this.vectors.hasEmbedding(record.hash))) need.push(record.hash);
    }
    if (need.length === 0) return;

    const texts = await Promise.all(
      need.map(async (hash) => new TextDecoder().decode(await this.blobs.getBlob(hash))),
    );
    const vectors = await this.embedder.embed(texts);
    for (let i = 0; i < need.length; i++) {
      await this.vectors.putEmbedding(need[i]!, vectors[i]!);
    }
  }
}
