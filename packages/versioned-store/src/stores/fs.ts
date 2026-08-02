import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashBytes } from "../hash.js";
import type { BlobStore, RoomStore } from "../index.js";
import type { BlobHash, Manifest, Ref, RoomId } from "../types.js";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Content-addressed blob storage on the local filesystem. Blobs live at
 * `<dir>/blobs/<hh>/<hash>` (2-char shard). Suitable for dev and single-node
 * self-hosting; use {@link S3BlobStore} for multi-node.
 */
export class FsBlobStore implements BlobStore {
  constructor(private readonly dir: string) {}

  private key(hash: BlobHash): string {
    return path.join(this.dir, "blobs", hash.slice(0, 2), hash);
  }

  async putBlob(bytes: Uint8Array): Promise<BlobHash> {
    const hash = hashBytes(bytes);
    const file = this.key(hash);
    if (await exists(file)) return hash;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return hash;
  }

  async getBlob(hash: BlobHash): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.key(hash)));
    } catch {
      throw new Error(`blob not found: ${hash}`);
    }
  }

  async hasBlob(hash: BlobHash): Promise<boolean> {
    return exists(this.key(hash));
  }
}

/**
 * Room store on the local filesystem. Manifests at
 * `<dir>/rooms/<room>/manifests/<ref>.json`; HEAD at `<dir>/rooms/<room>/HEAD`.
 * `casHead` is atomic for the first commit (exclusive create) but read-compare-
 * write thereafter — correct for a single writer, NOT safe under concurrent
 * writers (same caveat as the S3 store; use a DB-backed CAS for real multiplayer).
 */
export class FsRoomStore implements RoomStore {
  constructor(private readonly dir: string) {}

  private roomDir(room: RoomId): string {
    return path.join(this.dir, "rooms", encodeURIComponent(room));
  }
  private headPath(room: RoomId): string {
    return path.join(this.roomDir(room), "HEAD");
  }
  private manifestPath(room: RoomId, ref: Ref): string {
    return path.join(this.roomDir(room), "manifests", `${ref}.json`);
  }

  async head(room: RoomId): Promise<Ref | null> {
    try {
      return (await readFile(this.headPath(room), "utf-8")).trim();
    } catch {
      return null;
    }
  }

  async getManifest(room: RoomId, ref: Ref): Promise<Manifest> {
    try {
      return JSON.parse(await readFile(this.manifestPath(room, ref), "utf-8")) as Manifest;
    } catch {
      throw new Error(`manifest not found: ${room}@${ref}`);
    }
  }

  async putManifest(manifest: Manifest): Promise<void> {
    const file = this.manifestPath(manifest.room, manifest.ref);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(manifest));
  }

  async casHead(room: RoomId, expected: Ref | null, next: Ref): Promise<"ok" | "conflict"> {
    const head = this.headPath(room);
    await mkdir(path.dirname(head), { recursive: true });
    if (expected === null) {
      try {
        await writeFile(head, next, { flag: "wx" }); // exclusive create — fails if HEAD exists
        return "ok";
      } catch {
        return "conflict";
      }
    }
    const current = await this.head(room);
    if (current !== expected) return "conflict";
    await writeFile(head, next);
    return "ok";
  }
}
