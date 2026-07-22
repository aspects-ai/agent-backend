import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { hashBytes } from "../hash.js";
import type { BlobStore, RoomStore } from "../index.js";
import type { BlobHash, Manifest, Ref, RoomId } from "../types.js";

function httpStatus(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function errName(err: unknown): string | undefined {
  return (err as { name?: string })?.name;
}

function isNotFound(err: unknown): boolean {
  return httpStatus(err) === 404 || errName(err) === "NotFound" || errName(err) === "NoSuchKey";
}

function isPreconditionFailed(err: unknown): boolean {
  return httpStatus(err) === 412 || errName(err) === "PreconditionFailed";
}

export interface S3StoreOptions {
  /** Key prefix within the bucket (e.g. a tenant namespace). Default "". */
  prefix?: string;
}

/** Content-addressed blob storage over S3. Keys are `${prefix}blobs/<hash>`. */
export class S3BlobStore implements BlobStore {
  private readonly prefix: string;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    options: S3StoreOptions = {},
  ) {
    this.prefix = options.prefix ?? "";
  }

  private key(hash: BlobHash): string {
    return `${this.prefix}blobs/${hash}`;
  }

  async putBlob(bytes: Uint8Array): Promise<BlobHash> {
    const hash = hashBytes(bytes);
    // Content-addressed: identical content → identical key. Skip re-upload.
    if (await this.hasBlob(hash)) return hash;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key(hash), Body: bytes }),
    );
    return hash;
  }

  async getBlob(hash: BlobHash): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(hash) }),
    );
    if (!res.Body) throw new Error(`empty blob body: ${hash}`);
    return res.Body.transformToByteArray();
  }

  async hasBlob(hash: BlobHash): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(hash) }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}

/**
 * Room store over S3. Manifests are objects at
 * `${prefix}rooms/<room>/manifests/<ref>.json`; HEAD is a single object holding
 * the current ref, advanced via S3 conditional writes (If-None-Match for the
 * first commit, If-Match on the read ETag thereafter) for optimistic CAS.
 */
export class S3RoomStore implements RoomStore {
  private readonly prefix: string;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    options: S3StoreOptions = {},
  ) {
    this.prefix = options.prefix ?? "";
  }

  private headKey(room: RoomId): string {
    return `${this.prefix}rooms/${room}/HEAD`;
  }

  private manifestKey(room: RoomId, ref: Ref): string {
    return `${this.prefix}rooms/${room}/manifests/${ref}.json`;
  }

  async head(room: RoomId): Promise<Ref | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.headKey(room) }),
      );
      return (await res.Body!.transformToString()).trim();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getManifest(room: RoomId, ref: Ref): Promise<Manifest> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.manifestKey(room, ref) }),
    );
    return JSON.parse(await res.Body!.transformToString()) as Manifest;
  }

  async putManifest(manifest: Manifest): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.manifestKey(manifest.room, manifest.ref),
        Body: JSON.stringify(manifest),
        ContentType: "application/json",
      }),
    );
  }

  async casHead(room: RoomId, expected: Ref | null, next: Ref): Promise<"ok" | "conflict"> {
    if (expected === null) {
      // First commit: succeed only if HEAD does not yet exist.
      try {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: this.headKey(room),
            Body: next,
            IfNoneMatch: "*",
          }),
        );
        return "ok";
      } catch (err) {
        if (isPreconditionFailed(err)) return "conflict";
        throw err;
      }
    }

    // Read current HEAD + its ETag; bail if it already moved off `expected`,
    // then conditional-put keyed on that ETag so a concurrent write loses.
    let etag: string;
    let current: string;
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.headKey(room) }),
      );
      if (!res.ETag) throw new Error("HEAD object missing ETag");
      etag = res.ETag;
      current = (await res.Body!.transformToString()).trim();
    } catch (err) {
      if (isNotFound(err)) return "conflict";
      throw err;
    }
    if (current !== expected) return "conflict";

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.headKey(room),
          Body: next,
          IfMatch: etag,
        }),
      );
      return "ok";
    } catch (err) {
      if (isPreconditionFailed(err)) return "conflict";
      throw err;
    }
  }
}
