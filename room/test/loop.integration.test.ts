import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { S3BlobStore, S3RoomStore } from "@agentbe/versioned-store";
import { HashingEmbeddingProvider, InMemoryVectorStore } from "@agentbe/index-sync";
import { beforeAll, describe, expect, it } from "vitest";

import { LocalWorkspaceProvider, RoomService } from "../src/index.js";

const ENDPOINT = process.env.AGENTBE_S3_ENDPOINT ?? "http://localhost:4566";
const BUCKET = "agentbe-room-it";
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packages",
  "versioned-store",
  "test",
  "fixtures",
);
const ROOM = "room";

const client = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  forcePathStyle: true,
});

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));
}

function makeService(): RoomService {
  const prefix = `room/${randomUUID()}/`;
  return new RoomService({
    blobs: new S3BlobStore(client, BUCKET, { prefix }),
    rooms: new S3RoomStore(client, BUCKET, { prefix }),
    embedder: new HashingEmbeddingProvider(),
    vectors: new InMemoryVectorStore(),
    workspaces: new LocalWorkspaceProvider(),
  });
}

beforeAll(async () => {
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw err;
  }
});

describe("RoomService full loop over S3", () => {
  it("upload → search → read-only analysis → edit/commit → re-search", async () => {
    const svc = makeService();
    const csv = loadFixture("ag_exports.csv");
    const png = loadFixture("logo.png");

    await svc.putDocuments(
      ROOM,
      {
        "data/ag_exports.csv": csv,
        "assets/logo.png": png,
        "notes.md": "vendor invoice payment analysis for the fiscal year",
      },
      "alice",
    );

    const hits = await svc.search(ROOM, "agricultural exports by state", 3);
    expect(hits[0]?.path).toBe("data/ag_exports.csv");

    // use case A: read-only analysis session over the search hit
    const ro = await svc.openSession(ROOM, { paths: [hits[0]!.path] });
    try {
      expect(ro.canCommit).toBe(false);
      const rows = parseInt(String(await ro.exec("wc -l < data/ag_exports.csv")).trim(), 10);
      expect(rows).toBe(csv.reduce((n, b) => n + (b === 0x0a ? 1 : 0), 0));
    } finally {
      await ro.close();
    }

    // use case B: full session — binary survived, then edit + commit
    const rw = await svc.openSession(ROOM);
    let r1 = "";
    try {
      const pngBack = (await rw.tree.read("assets/logo.png")) as Uint8Array;
      expect(Buffer.from(pngBack).equals(Buffer.from(png))).toBe(true);
      await rw.tree.write("analysis/summary.md", "rows analyzed and summarized");
      r1 = await rw.commit("alice");
      expect(r1).toBeTruthy();
    } finally {
      await rw.close();
    }

    expect((await svc.search(ROOM, "rows analyzed summary", 3)).map((h) => h.path)).toContain(
      "analysis/summary.md",
    );
  });
});
