import { createHash } from "node:crypto";

import type { BlobHash, ManifestEntry, Ref } from "./types.js";

/** Content hash of a blob (sha-256, hex). */
export function hashBytes(bytes: Uint8Array): BlobHash {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Deterministic ref for a manifest, content-addressed over its lineage
 * (parent), author, and entry set. Two manifests with identical parent,
 * author, and entries collapse to the same ref (idempotent), analogous to a
 * git commit hash minus the timestamp.
 */
export function hashManifest(
  parent: Ref | null,
  createdBy: string,
  entries: Record<string, ManifestEntry>,
): Ref {
  const normalized = Object.entries(entries)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, e]) => [path, e.hash, e.size, e.mode, e.media ?? null]);
  const canonical = JSON.stringify({ parent, createdBy, entries: normalized });
  return createHash("sha256").update(canonical).digest("hex");
}
