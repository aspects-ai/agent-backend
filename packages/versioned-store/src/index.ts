/**
 * @agentbe/versioned-store
 *
 * Content-addressed, S3-backed versioned document store. A room is a sequence
 * of immutable manifests advanced by compare-and-swap on HEAD. Sandboxes work
 * against ephemeral checkouts and promote state via commit-back (per-file LWW
 * on conflict, for now).
 */

export type {
  BlobHash,
  Ref,
  RoomId,
  ManifestEntry,
  MediaMetadata,
  Manifest,
  CommitResult,
} from "./types.js";
export type { WorkingTree } from "./working-tree.js";

import type { BlobHash, CommitResult, Manifest, Ref, RoomId } from "./types.js";
import type { WorkingTree } from "./working-tree.js";

/** Immutable, content-addressed blob storage (backed by S3). */
export interface BlobStore {
  /** Store bytes; returns the content hash. Idempotent — dedupes on hash. */
  putBlob(bytes: Uint8Array): Promise<BlobHash>;
  getBlob(hash: BlobHash): Promise<Uint8Array>;
  hasBlob(hash: BlobHash): Promise<boolean>;
}

/**
 * Room metadata + the atomic HEAD advance. HEAD/manifest history live here
 * (default: a small transactional DB; alternative: S3 conditional writes).
 */
export interface RoomStore {
  /** Current HEAD ref for a room, or null if the room has no commits yet. */
  head(room: RoomId): Promise<Ref | null>;
  getManifest(room: RoomId, ref: Ref): Promise<Manifest>;
  /** Persist a manifest object. Must be called before it is referenced by HEAD. */
  putManifest(manifest: Manifest): Promise<void>;
  /**
   * Atomically advance HEAD from `expected` to `next`. `expected` is null when
   * creating the room's first commit. Returns "conflict" if HEAD has moved.
   */
  casHead(room: RoomId, expected: Ref | null, next: Ref): Promise<"ok" | "conflict">;
}

/** Options for a partial checkout. */
export interface CheckoutOptions {
  /**
   * Restrict materialization to these paths (e.g. the result of a semantic
   * search). Omit to materialize the whole room.
   */
  paths?: string[];
}

/**
 * The store's public surface. Composes a BlobStore + RoomStore and moves bytes
 * in and out of a WorkingTree (an agent-backend Backend).
 */
export interface VersionedStore {
  /**
   * Materialize (a subset of) `ref` into `tree`. Only blobs not already present
   * are fetched. Returns the manifest that was checked out (the commit base).
   */
  checkout(room: RoomId, ref: Ref, tree: WorkingTree, options?: CheckoutOptions): Promise<Manifest>;

  /**
   * Promote the current state of `tree` to a new room version. Diffs the tree
   * against `base` (null for the first commit), uploads new blobs, writes a
   * manifest, and CAS-advances HEAD. On a concurrent HEAD advance it applies
   * per-file last-writer-wins against the current HEAD and retries.
   */
  commit(
    room: RoomId,
    base: Ref | null,
    tree: WorkingTree,
    createdBy: string,
  ): Promise<CommitResult>;
}

export { DefaultVersionedStore } from "./versioned-store.js";
export type { VersionedStoreOptions } from "./versioned-store.js";
export { InMemoryBlobStore, InMemoryRoomStore } from "./stores/memory.js";
export { S3BlobStore, S3RoomStore } from "./stores/s3.js";
export type { S3StoreOptions } from "./stores/s3.js";
export { FsBlobStore, FsRoomStore } from "./stores/fs.js";
export { InMemoryWorkingTree } from "./memory-working-tree.js";
export { hashBytes, hashManifest } from "./hash.js";
export { walkFiles, lwwMerge } from "./manifest.js";
