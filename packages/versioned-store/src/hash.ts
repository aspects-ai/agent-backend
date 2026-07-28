import { createHash } from "node:crypto";

import type { BlobHash, ManifestEntry, Ref, RoomId } from "./types.js";

/** Content hash of a blob (sha-256, hex). */
export function hashBytes(bytes: Uint8Array): BlobHash {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Deterministic ref for a manifest, content-addressed over the room, its
 * lineage (parent), author, and entry set. Two manifests identical in all four
 * collapse to the same ref (idempotent), analogous to a git commit hash minus
 * the timestamp.
 *
 * `room` is part of the hash so a ref is a **global** identifier. Without it,
 * two different rooms committing identical content produced the same ref — safe
 * only so long as every lookup stayed room-qualified, and a trap for any future
 * cache, dedupe layer, or cross-room lookup keyed on a ref alone. It also means
 * the stored manifest is fully covered by its own hash, so integrity can be
 * checked by re-hashing it.
 */
export function hashManifest(
  room: RoomId,
  parent: Ref | null,
  createdBy: string,
  entries: Record<string, ManifestEntry>,
): Ref {
  const normalized = Object.entries(entries)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, e]) => [path, e.hash, e.size, e.mode, e.media ?? null]);
  const canonical = JSON.stringify({ room, parent, createdBy, entries: normalized });
  return createHash("sha256").update(canonical).digest("hex");
}
