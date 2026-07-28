import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { HashingEmbeddingProvider } from "@agentbe/index-sync";
import { beforeAll, describe, expect, it } from "vitest";

import { LocalWorkspaceProvider, buildRoomService, createS3Stores } from "../src/index.js";

/**
 * The room service running on the S3 tier — the production store. Requires
 * LocalStack:
 *   docker run -d -p 4566:4566 -e SERVICES=s3 localstack/localstack:3
 */
const ENDPOINT = process.env.AGENTBE_S3_ENDPOINT ?? "http://localhost:4566";
const BUCKET = "agentbe-room-test";
const CREDENTIALS = { accessKeyId: "test", secretAccessKey: "test" };

const client = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: CREDENTIALS,
  forcePathStyle: true,
});

beforeAll(async () => {
  await client.send(new CreateBucketCommand({ Bucket: BUCKET })).catch(() => undefined);
});

async function s3Service(prefix: string) {
  const { blobs, rooms } = await createS3Stores({
    bucket: BUCKET,
    prefix,
    region: "us-east-1",
    endpoint: ENDPOINT,
    credentials: CREDENTIALS,
  });
  return buildRoomService({
    blobs,
    rooms,
    embedder: new HashingEmbeddingProvider(),
    workspaces: new LocalWorkspaceProvider(),
  });
}

describe("room service over S3", () => {
  it("round-trips documents through the S3 store", async () => {
    const service = await s3Service(`t-${Date.now()}-basic/`);
    await service.putDocuments(
      "acme",
      { "contract.md": "Globex bills 250 per hour", "data.csv": "a,b\n1,2\n" },
      "ada@acme.com",
    );
    expect(await service.listDocuments("acme")).toEqual(
      expect.arrayContaining(["contract.md", "data.csv"]),
    );
    expect(await service.readDocument("acme", "contract.md")).toContain("250 per hour");

    const hits = await service.search("acme", "Globex hourly billing", 3);
    expect(hits.map((h) => h.path)).toContain("contract.md");
  });

  it("keeps data across a service restart (durability, not process memory)", async () => {
    const prefix = `t-${Date.now()}-restart/`;
    const first = await s3Service(prefix);
    await first.putDocuments("acme", { "kept.md": "survives" }, "ada@acme.com");

    // A brand-new service against the same prefix — nothing shared in-process.
    const second = await s3Service(prefix);
    await second.reindexHead("acme");
    expect(await second.listDocuments("acme")).toContain("kept.md");
    expect(await second.readDocument("acme", "kept.md")).toContain("survives");
  });

  it("isolates rooms by prefix — the per-org deployment shape", async () => {
    const stamp = Date.now();
    // Separate prefixes stand in for separate orgs (a separate bucket would
    // additionally give IAM-level isolation).
    const acme = await s3Service(`t-${stamp}-acme/`);
    const globex = await s3Service(`t-${stamp}-globex/`);

    await acme.putDocuments("room", { "secret.md": "acme confidential" }, "ada@acme.com");
    await globex.putDocuments("room", { "secret.md": "globex confidential" }, "bob@globex.com");

    // Same room name, same path — different prefixes must not collide.
    expect(await acme.readDocument("room", "secret.md")).toContain("acme confidential");
    expect(await globex.readDocument("room", "secret.md")).toContain("globex confidential");
  });

  it("records the committing principal in the manifest", async () => {
    const prefix = `t-${Date.now()}-author/`;
    const { rooms } = await createS3Stores({
      bucket: BUCKET,
      prefix,
      region: "us-east-1",
      endpoint: ENDPOINT,
      credentials: CREDENTIALS,
    });
    const service = await s3Service(prefix);
    const ref = await service.putDocuments("acme", { "a.md": "x" }, "grace@acme.com");
    const manifest = await rooms.getManifest("acme", ref);
    expect(manifest.createdBy).toBe("grace@acme.com");
  });

  it("shares blobs across rooms while keeping manifest refs distinct", async () => {
    const prefix = `t-${Date.now()}-dedupe/`;
    const service = await s3Service(prefix);
    const body = "the very same bytes in two rooms";
    const a = await service.putDocuments("room-a", { "doc.md": body }, "ada@acme.com");
    const b = await service.putDocuments("room-b", { "doc.md": body }, "ada@acme.com");

    // The room is part of `hashManifest`, so identical content in two rooms
    // yields distinct refs — a ref identifies a manifest globally, and a cache
    // or cross-room lookup keyed on one can't conflate two rooms' histories.
    expect(a).not.toBe(b);

    // Dedupe still happens where it should: at the content-addressed blob
    // layer, which is NOT room-namespaced. Two rooms, one stored blob.
    expect(await service.readDocument("room-a", "doc.md")).toContain(body);
    expect(await service.readDocument("room-b", "doc.md")).toContain(body);

    // And each room's manifest names its own room.
    const { rooms } = await createS3Stores({
      bucket: BUCKET,
      prefix,
      region: "us-east-1",
      endpoint: ENDPOINT,
      credentials: CREDENTIALS,
    });
    expect((await rooms.getManifest("room-a", a)).room).toBe("room-a");
    expect((await rooms.getManifest("room-b", b)).room).toBe("room-b");
  });
});
