/**
 * @agentbe/index-sync
 *
 * Keeps a semantic/lexical index in step with a versioned-store room. Embeddings
 * are content-addressed by blob hash (unchanged blobs are never re-embedded);
 * the index is derived and rebuildable. Bring your own embedding model and
 * vector store. Runs outside the sandbox — it's a service, not a shell tool.
 */

export { IndexSync } from "./index-sync.js";
export type { IndexSyncOptions, SyncResult, SyncDiffResult } from "./index-sync.js";
export { ImageIndexSync } from "./image-index-sync.js";
export { HashingEmbeddingProvider } from "./embedding.js";
export type { EmbeddingProvider, ImageEmbeddingProvider } from "./embedding.js";
export { InMemoryVectorStore } from "./vector-store.js";
export type { VectorStore, RoomRecord, QueryHit } from "./vector-store.js";
export { isEmbeddablePath, isImagePath } from "./embeddable.js";
