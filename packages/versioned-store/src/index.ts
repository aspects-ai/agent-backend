/**
 * @agentbe/versioned-store
 *
 * Content-addressed, S3-backed versioned document store. A room is a sequence
 * of immutable manifests advanced by compare-and-swap on HEAD. Sandboxes work
 * against ephemeral checkouts and promote state via commit-back (per-file LWW
 * on conflict, for now).
 *
 * This entrypoint currently defines the interfaces (the boundaries that matter
 * for keeping the pieces separable); implementations land next.
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
  head(room: RoomId): Promise<Ref | null>;
  getManifest(room: RoomId, ref: Ref): Promise<Manifest>;
  /** Atomically advance HEAD from `expected` to `next`. */
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
   * against `base`, uploads new blobs, writes a manifest, and CAS-advances HEAD.
   * On CAS failure returns a conflict; callers resolve (per-file LWW today) and
   * retry.
   */
  commit(room: RoomId, base: Ref, tree: WorkingTree, createdBy: string): Promise<CommitResult>;
}
