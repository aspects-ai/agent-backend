import type { BlobStore, RoomStore } from "@agentbe/versioned-store";

export interface S3StoreConfig {
  /** Bucket holding blobs + manifests. Required. */
  bucket: string;
  /**
   * Key prefix within the bucket. Give each org its own prefix — or its own
   * bucket, which additionally buys IAM-level isolation, per-org lifecycle
   * rules, and per-org data residency.
   */
  prefix?: string;
  region?: string;
  /** Custom endpoint (LocalStack, MinIO, R2). Implies path-style addressing. */
  endpoint?: string;
  /**
   * Static credentials. Omit in production and let the default AWS provider
   * chain resolve them (instance role, IRSA, env, profile).
   */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/**
 * Build S3-backed blob + room stores. The AWS SDK is imported **lazily** so it
 * stays out of the default (filesystem / in-memory) path and off the dependency
 * graph of anyone not using S3 — the same pattern the bin uses for `pg`.
 *
 * Pass the result into `buildRoomService({ blobs, rooms })`.
 */
export async function createS3Stores(
  config: S3StoreConfig,
): Promise<{ blobs: BlobStore; rooms: RoomStore }> {
  if (!config.bucket) throw new Error("createS3Stores: `bucket` is required");
  const { S3Client } = await import("@aws-sdk/client-s3");
  const { S3BlobStore, S3RoomStore } = await import("@agentbe/versioned-store");

  const client = new S3Client({
    ...(config.region ? { region: config.region } : {}),
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    ...(config.credentials ? { credentials: config.credentials } : {}),
  });

  const options = { prefix: config.prefix };
  return {
    blobs: new S3BlobStore(client, config.bucket, options),
    rooms: new S3RoomStore(client, config.bucket, options),
  };
}
