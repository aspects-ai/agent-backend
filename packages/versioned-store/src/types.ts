/**
 * Core value types for the versioned store.
 *
 * Design (see project decisions): the store is content-addressed over S3.
 * A blob is an immutable object keyed by its content hash. A room snapshot is
 * a Manifest (path -> entry). HEAD is a pointer to a manifest, advanced by CAS.
 */

/** SHA-256 (or similar) content hash of a blob, hex-encoded. */
export type BlobHash = string;

/** Opaque identifier for a manifest/commit within a room. */
export type Ref = string;

/** Stable identifier for a room (the top-level collaboration boundary). */
export type RoomId = string;

/** A single file entry within a manifest. */
export interface ManifestEntry {
  /** Content hash of the blob this path points at. */
  hash: BlobHash;
  /** Size in bytes of the raw blob. */
  size: number;
  /** POSIX mode bits (e.g. 0o644). */
  mode: number;
  /**
   * Optional derived-media metadata. Raw media stays as a content-addressed
   * blob; extracted text (OCR/transcript) is committed as its own sibling
   * entry so the sandbox shell can operate on it directly.
   */
  media?: MediaMetadata;
}

export interface MediaMetadata {
  /** MIME type of the raw asset, e.g. "video/mp4", "image/png". */
  contentType: string;
  /** Path of the committed derived-text sibling, if one exists. */
  derivedTextPath?: string;
}

/** An immutable snapshot of a room at a point in time. */
export interface Manifest {
  room: RoomId;
  /** This snapshot's ref. */
  ref: Ref;
  /** Parent ref, or null for the first commit. */
  parent: Ref | null;
  /** Identity that authored this snapshot (for the log; not access control). */
  createdBy: string;
  /** path -> entry. Paths are POSIX-relative to the room root. */
  entries: Record<string, ManifestEntry>;
}

/** Result of an attempted commit-back. */
export type CommitResult =
  | { status: "committed"; ref: Ref }
  | { status: "conflict"; theirRef: Ref; base: Ref };
