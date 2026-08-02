import {
  ImageIndexSync,
  IndexSync,
  InMemoryVectorStore,
  type EmbeddingProvider,
  type ImageEmbeddingProvider,
  type QueryHit,
  type VectorStore,
} from "@agentbe/index-sync";
import type { PdfExtractionProvider } from "@agentbe/ingestion";
import {
  DefaultVersionedStore,
  hashManifest,
  type BlobStore,
  type ManifestEntry,
  type RoomStore,
  type WorkingTree,
} from "@agentbe/versioned-store";

import type {
  DocumentPage,
  ListDocumentsOptions,
  MaterializeOptions,
  RoomCatalog,
  SearchModality,
} from "./room-catalog.js";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1_000;
const MAX_COMMIT_ATTEMPTS = 8;

export interface ManifestRoomCatalogDeps {
  blobs: BlobStore;
  rooms: RoomStore;
  embedder: EmbeddingProvider;
  vectors: VectorStore;
  pdfExtractor?: PdfExtractionProvider;
  imageEmbedder?: ImageEmbeddingProvider;
  imageVectors?: VectorStore;
}

/**
 * The original manifest-backed room implemented as one {@link RoomCatalog}
 * adapter. It remains the zero-database, writable-workspace default, while the
 * service itself no longer requires complete manifest snapshots.
 */
export class ManifestRoomCatalog implements RoomCatalog {
  private readonly store: DefaultVersionedStore;
  private readonly index: IndexSync;
  private readonly imageIndex?: ImageIndexSync;

  constructor(private readonly deps: ManifestRoomCatalogDeps) {
    this.store = new DefaultVersionedStore(deps.blobs, deps.rooms);
    this.index = new IndexSync(deps.blobs, deps.rooms, deps.embedder, deps.vectors);
    if (deps.imageEmbedder) {
      this.imageIndex = new ImageIndexSync(
        deps.blobs,
        deps.rooms,
        deps.imageEmbedder,
        deps.imageVectors ?? new InMemoryVectorStore(),
      );
    }
  }

  revision(room: string): Promise<string | null> {
    return this.deps.rooms.head(room);
  }

  async putDocuments(
    room: string,
    files: Record<string, string | Uint8Array>,
    author: string,
  ): Promise<string> {
    const prepared = await this.preprocess(files);
    const changed: Record<string, ManifestEntry> = {};
    for (const [path, content] of Object.entries(prepared)) {
      const bytes =
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : new Uint8Array(content);
      const hash = await this.deps.blobs.putBlob(bytes);
      changed[path] = { hash, size: bytes.byteLength, mode: 0o644 };
    }

    // Directly patch manifest metadata. The previous implementation checked out
    // and re-hashed every blob merely to add one document, making ingestion
    // proportional to total corpus bytes rather than to changed bytes.
    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
      const parent = await this.deps.rooms.head(room);
      const current = parent ? (await this.deps.rooms.getManifest(room, parent)).entries : {};
      const entries = { ...current, ...changed };
      const ref = hashManifest(room, parent, author, entries);
      await this.deps.rooms.putManifest({ room, ref, parent, createdBy: author, entries });
      if ((await this.deps.rooms.casHead(room, parent, ref)) === "ok") {
        await this.reindexChange(room, parent, ref);
        return ref;
      }
    }
    throw new Error("commit failed: conflict");
  }

  async search(
    room: string,
    query: string,
    k = 5,
    modality: SearchModality = "all",
  ): Promise<QueryHit[]> {
    const hits: QueryHit[] = [];
    if (modality !== "image") hits.push(...(await this.index.query(room, query, k)));
    if (modality !== "text" && this.imageIndex) {
      hits.push(...(await this.imageIndex.query(room, query, k)));
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  async listDocuments(
    room: string,
    options: ListDocumentsOptions = {},
  ): Promise<DocumentPage> {
    const head = await this.deps.rooms.head(room);
    if (!head) return { paths: [] };
    const manifest = await this.deps.rooms.getManifest(room, head);
    const paths = Object.keys(manifest.entries).sort();
    const requested = options.limit ?? DEFAULT_PAGE_SIZE;
    const limit = Math.max(1, Math.min(requested, MAX_PAGE_SIZE));
    const start = options.cursor ? paths.findIndex((path) => path > options.cursor!) : 0;
    if (start < 0) return { paths: [] };
    const page = paths.slice(start, start + limit);
    const nextCursor = start + page.length < paths.length ? page.at(-1) : undefined;
    return { paths: page, ...(nextCursor ? { nextCursor } : {}) };
  }

  async readDocument(room: string, path: string): Promise<string> {
    const head = await this.deps.rooms.head(room);
    if (!head) throw new Error(`document not found: ${path}`);
    const manifest = await this.deps.rooms.getManifest(room, head);
    const entry = manifest.entries[path];
    if (!entry) throw new Error(`document not found: ${path}`);
    return new TextDecoder().decode(await this.deps.blobs.getBlob(entry.hash));
  }

  async materialize(
    room: string,
    revision: string,
    tree: WorkingTree,
    options?: MaterializeOptions,
  ): Promise<void> {
    await this.store.checkout(room, revision, tree, options);
  }

  async commitWorkspace(
    room: string,
    base: string | null,
    tree: WorkingTree,
    author: string,
  ): Promise<string> {
    const result = await this.store.commit(room, base, tree, author);
    if (result.status !== "committed") throw new Error(`commit failed: ${result.status}`);
    await this.reindexChange(room, base, result.ref);
    return result.ref;
  }

  async reindex(room: string): Promise<void> {
    const head = await this.deps.rooms.head(room);
    if (!head) return;
    await this.index.sync(room, head);
    if (this.imageIndex) await this.imageIndex.sync(room, head);
  }

  private async preprocess(
    files: Record<string, string | Uint8Array>,
  ): Promise<Record<string, string | Uint8Array>> {
    const prepared = { ...files };
    if (!this.deps.pdfExtractor) return prepared;
    for (const [path, content] of Object.entries(files)) {
      if (!path.toLowerCase().endsWith(".pdf")) continue;
      // Some extraction implementations transfer/detach their input buffer.
      // Give them an isolated copy so the canonical bytes in `prepared` remain
      // valid for the subsequent blob write.
      const bytes =
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : new Uint8Array(content);
      try {
        const text = await this.deps.pdfExtractor.extractText(bytes);
        if (text.trim().length > 0) prepared[`${path}.txt`] = text;
      } catch {
        // No text layer or extraction error: retain the raw PDF as an opaque blob.
      }
    }
    return prepared;
  }

  private async reindexChange(room: string, from: string | null, to: string): Promise<void> {
    if (from) await this.index.syncDiff(room, from, to);
    else await this.index.sync(room, to);
    if (this.imageIndex) {
      if (from) await this.imageIndex.syncDiff(room, from, to);
      else await this.imageIndex.sync(room, to);
    }
  }
}
