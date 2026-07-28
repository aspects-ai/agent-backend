import posix from "node:path/posix";

import { hashManifest } from "./hash.js";
import { walkFiles, lwwMerge } from "./manifest.js";
import type {
  BlobStore,
  CheckoutOptions,
  RoomStore,
  VersionedStore,
} from "./index.js";
import type { CommitResult, ManifestEntry, Ref, RoomId } from "./types.js";
import type { WorkingTree } from "./working-tree.js";

export interface VersionedStoreOptions {
  /** Max commit attempts before giving up and returning a conflict. */
  maxCommitRetries?: number;
}

const DEFAULT_MAX_RETRIES = 8;

/**
 * Default implementation composing a BlobStore + RoomStore. Backend-agnostic —
 * works against in-memory or S3 stores identically.
 */
export class DefaultVersionedStore implements VersionedStore {
  private readonly maxRetries: number;

  constructor(
    private readonly blobs: BlobStore,
    private readonly rooms: RoomStore,
    options: VersionedStoreOptions = {},
  ) {
    this.maxRetries = options.maxCommitRetries ?? DEFAULT_MAX_RETRIES;
  }

  async checkout(
    room: RoomId,
    ref: Ref,
    tree: WorkingTree,
    options?: CheckoutOptions,
  ): Promise<import("./types.js").Manifest> {
    const manifest = await this.rooms.getManifest(room, ref);
    const wanted = options?.paths;
    for (const [path, entry] of Object.entries(manifest.entries)) {
      if (wanted && !wanted.includes(path)) continue;
      const bytes = await this.blobs.getBlob(entry.hash);
      const dir = posix.dirname(path);
      if (dir && dir !== ".") await tree.mkdir(dir, { recursive: true });
      await tree.write(path, bytes);
    }
    return manifest;
  }

  async commit(
    room: RoomId,
    base: Ref | null,
    tree: WorkingTree,
    createdBy: string,
  ): Promise<CommitResult> {
    // Content-address every file in the working tree, uploading new blobs.
    const files = await walkFiles(tree);
    const mine: Record<string, ManifestEntry> = {};
    for (const file of files) {
      const hash = await this.blobs.putBlob(file.content);
      mine[file.path] = { hash, size: file.content.byteLength, mode: file.mode };
    }

    const baseEntries = base === null ? {} : (await this.rooms.getManifest(room, base)).entries;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const head = await this.rooms.head(room);

      // Fast path: HEAD is where we branched from — write our entries as-is.
      // Otherwise, someone advanced HEAD concurrently: per-file LWW merge.
      let entries: Record<string, ManifestEntry>;
      let parent: Ref | null;
      if (head === base) {
        entries = mine;
        parent = base;
      } else {
        const theirs = (await this.rooms.getManifest(room, head as Ref)).entries;
        entries = lwwMerge(theirs, mine, baseEntries);
        parent = head;
      }

      const ref = hashManifest(room, parent, createdBy, entries);
      await this.rooms.putManifest({ room, ref, parent, createdBy, entries });
      const result = await this.rooms.casHead(room, head, ref);
      if (result === "ok") return { status: "committed", ref };
      // CAS lost a race — loop and re-merge against the new HEAD.
    }

    const theirRef = (await this.rooms.head(room)) ?? "";
    return { status: "conflict", theirRef, base: base ?? "" };
  }
}
