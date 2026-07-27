import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  FsBlobStore,
  FsRoomStore,
  InMemoryBlobStore,
  InMemoryRoomStore,
} from "@agentbe/versioned-store";
import {
  HashingEmbeddingProvider,
  InMemoryVectorStore,
  type EmbeddingProvider,
  type ImageEmbeddingProvider,
  type VectorStore,
} from "@agentbe/index-sync";
import { UnpdfExtractionProvider, type PdfExtractionProvider } from "@agentbe/ingestion";

import { RoomService } from "./room-service.js";
import { LocalWorkspaceProvider } from "./workspace-local.js";

export interface BuildRoomServiceOptions {
  /** Persist blobs + manifests under this directory (filesystem store). Omit
   * for an ephemeral in-memory store (tests). The index is derived and always
   * in-memory — rebuild it on startup via `reindexHead`. */
  storeDir?: string;
  /** Embedding model. Defaults to the dependency-free lexical hashing embedder
   * (fast, no download) — pass a real one (e.g. from `@agentbe/embeddings`) for
   * semantic search. */
  embedder?: EmbeddingProvider;
  /** PDF text extraction. Defaults to text-layer extraction (unpdf). */
  pdfExtractor?: PdfExtractionProvider;
  /** Image embedder (CLIP) for text→image search. Omit to skip image indexing. */
  imageEmbedder?: ImageEmbeddingProvider;
  /** Vector store for the text index. Defaults to in-memory (rebuilt on boot).
   * Pass a persistent one (e.g. `@agentbe/vector-pg`) for scale. */
  vectors?: VectorStore;
  /** Vector store for the image index. Defaults to a fresh in-memory one. */
  imageVectors?: VectorStore;
}

/**
 * Build a self-contained `RoomService` for local dev / demos: a dependency-free
 * lexical embedder, an in-memory (derived) index, and a temp-dir sandbox
 * provider. With `storeDir` the canonical store persists to disk; without, it's
 * ephemeral in-memory. For a real deployment, construct `new RoomService({...})`
 * with S3 + a real vector DB directly.
 */
export function buildRoomService(options: BuildRoomServiceOptions = {}): RoomService {
  return new RoomService({
    blobs: options.storeDir ? new FsBlobStore(options.storeDir) : new InMemoryBlobStore(),
    rooms: options.storeDir ? new FsRoomStore(options.storeDir) : new InMemoryRoomStore(),
    embedder: options.embedder ?? new HashingEmbeddingProvider(),
    vectors: options.vectors ?? new InMemoryVectorStore(),
    imageVectors: options.imageVectors,
    workspaces: new LocalWorkspaceProvider(),
    pdfExtractor: options.pdfExtractor ?? new UnpdfExtractionProvider(),
    imageEmbedder: options.imageEmbedder,
  });
}

function collectFiles(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full, base));
    else out.push(full);
  }
  return out;
}

/** Ingest every file under `dir` into `room` (paths relative to `dir`). Files
 * are read as UTF-8 text — suitable for a text/markdown/CSV seed corpus. Returns
 * the number of documents seeded. */
export async function seedRoomFromDir(
  service: RoomService,
  room: string,
  dir: string,
): Promise<number> {
  const files: Record<string, string> = {};
  for (const full of collectFiles(dir, dir)) {
    const rel = path.relative(dir, full).split(path.sep).join("/");
    files[rel] = readFileSync(full, "utf-8");
  }
  const count = Object.keys(files).length;
  if (count > 0) await service.putDocuments(room, files, "seed");
  return count;
}
