import type { BlobStore, ManifestEntry, RoomStore } from "@agentbe/versioned-store";

import { isImagePath } from "./embeddable.js";
import type { ImageEmbeddingProvider } from "./embedding.js";
import type { SyncDiffResult, SyncResult } from "./index-sync.js";
import type { QueryHit, RoomRecord, VectorStore } from "./vector-store.js";

/**
 * Keeps an image index in step with a versioned-store room, mirroring
 * {@link IndexSync} but for images: image files are embedded via an
 * {@link ImageEmbeddingProvider} (CLIP), and a text query is embedded into the
 * SAME space (`embedText`) to retrieve them. Uses a SEPARATE `VectorStore` from
 * the text index — the two spaces (e.g. 384-dim text vs 512-dim CLIP) are not
 * comparable. Embeddings are content-addressed by blob hash (dedup).
 */
export class ImageIndexSync {
  constructor(
    private readonly blobs: BlobStore,
    private readonly rooms: RoomStore,
    private readonly embedder: ImageEmbeddingProvider,
    private readonly vectors: VectorStore,
  ) {}

  async sync(room: string, ref: string): Promise<SyncResult> {
    const manifest = await this.rooms.getManifest(room, ref);
    const records = this.imageRecords(manifest.entries);
    await this.ensureEmbeddings(records);
    await this.vectors.clearRoom(room);
    if (records.length > 0) await this.vectors.upsertRecords(room, records);
    return { indexed: records.length };
  }

  async syncDiff(room: string, fromRef: string, toRef: string): Promise<SyncDiffResult> {
    const [from, to] = await Promise.all([
      this.rooms.getManifest(room, fromRef),
      this.rooms.getManifest(room, toRef),
    ]);
    const fromEntries = this.filterImages(from.entries);
    const toEntries = this.filterImages(to.entries);

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

  /** Text → image search: embed the query into the image space and rank. */
  async query(room: string, text: string, k = 5): Promise<QueryHit[]> {
    const [vector] = await this.embedder.embedText([text]);
    if (!vector) return [];
    return this.vectors.query(room, vector, k);
  }

  private filterImages(entries: Record<string, ManifestEntry>): Record<string, ManifestEntry> {
    const out: Record<string, ManifestEntry> = {};
    for (const [path, entry] of Object.entries(entries)) {
      if (isImagePath(path)) out[path] = entry;
    }
    return out;
  }

  private imageRecords(entries: Record<string, ManifestEntry>): RoomRecord[] {
    const records: RoomRecord[] = [];
    for (const [path, entry] of Object.entries(entries)) {
      if (isImagePath(path)) records.push({ path, hash: entry.hash });
    }
    return records;
  }

  private async ensureEmbeddings(records: RoomRecord[]): Promise<void> {
    const need: string[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.hash)) continue;
      seen.add(record.hash);
      if (!(await this.vectors.hasEmbedding(record.hash))) need.push(record.hash);
    }
    if (need.length === 0) return;

    const images = await Promise.all(need.map((hash) => this.blobs.getBlob(hash)));
    const vectors = await this.embedder.embedImages(images);
    for (let i = 0; i < need.length; i++) {
      await this.vectors.putEmbedding(need[i]!, vectors[i]!);
    }
  }
}
