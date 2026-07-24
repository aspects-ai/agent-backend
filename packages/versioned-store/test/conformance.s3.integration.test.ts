import { randomUUID } from "node:crypto";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeAll } from "vitest";

import { S3BlobStore, S3RoomStore } from "../src/index.js";

import { runStoreConformance } from "./support/conformance.js";

const ENDPOINT = process.env.AGENTBE_S3_ENDPOINT ?? "http://localhost:4566";
const BUCKET = "agentbe-versioned-store-it";

const client = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  forcePathStyle: true,
});

beforeAll(async () => {
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw err;
  }
});

// Same behavioral contract, now against real S3 (LocalStack). A per-run prefix
// isolates each suite. (Concurrent CAS is covered separately and skipped — see
// concurrency.integration.test.ts — because LocalStack conditional writes aren't
// atomic; the sequential CAS contract here passes on real S3.)
runStoreConformance("s3", () => {
  const prefix = `conformance/${randomUUID()}/`;
  return {
    blobs: new S3BlobStore(client, BUCKET, { prefix }),
    rooms: new S3RoomStore(client, BUCKET, { prefix }),
  };
});
