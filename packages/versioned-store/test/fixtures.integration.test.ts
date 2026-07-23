import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";

import {
  DefaultVersionedStore,
  InMemoryWorkingTree,
  S3BlobStore,
  S3RoomStore,
  hashBytes,
} from "../src/index.js";
import type { Ref } from "../src/types.js";

const ENDPOINT = process.env.AGENTBE_S3_ENDPOINT ?? "http://localhost:4566";
const BUCKET = "agentbe-versioned-store-it";
const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

// Real files pulled from the web (see fixtures/README.md): binary images, PDFs,
// and a CSV — the multimodal + tabular data the room is actually meant to hold.
const FIXTURES = ["photo.jpg", "logo.png", "minimal.pdf", "document.pdf", "ag_exports.csv"];

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

const client = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  forcePathStyle: true,
});

function makeStore() {
  const prefix = `it-fixtures/${randomUUID()}/`;
  const blobs = new S3BlobStore(client, BUCKET, { prefix });
  const rooms = new S3RoomStore(client, BUCKET, { prefix });
  return { blobs, rooms, store: new DefaultVersionedStore(blobs, rooms) };
}

function committedRef(result: { status: string; ref?: Ref }): Ref {
  expect(result.status).toBe("committed");
  return result.ref as Ref;
}

const ROOM = "room";

beforeAll(async () => {
  try {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw err;
  }
});

describe("real multimodal fixtures over S3", () => {
  it("round-trips every binary fixture byte-exact through S3BlobStore", async () => {
    const { blobs } = makeStore();
    for (const name of FIXTURES) {
      const original = load(name);
      const hash = await blobs.putBlob(original);
      const roundtripped = await blobs.getBlob(hash);
      expect(roundtripped.length, name).toBe(original.length);
      expect(bytesEqual(roundtripped, original), `${name} bytes`).toBe(true);
      expect(hashBytes(roundtripped), `${name} hash`).toBe(hash);
    }
  });

  it("commits a mixed multimodal tree and checks it out byte-exact", async () => {
    const { store } = makeStore();
    const tree = new InMemoryWorkingTree();
    for (const name of FIXTURES) await tree.write(`assets/${name}`, load(name));
    await tree.write("notes.md", "# room notes\nsome text alongside the binaries\n");

    const ref = committedRef(await store.commit(ROOM, null, tree, "alice"));

    const fresh = new InMemoryWorkingTree();
    await store.checkout(ROOM, ref, fresh);
    for (const name of FIXTURES) {
      const out = (await fresh.read(`assets/${name}`)) as Uint8Array;
      expect(bytesEqual(out, load(name)), `${name} after checkout`).toBe(true);
    }
    expect(await fresh.read("notes.md", { encoding: "utf-8" })).toContain("room notes");
  });

  it("dedupes a repeated binary fixture", async () => {
    const { blobs } = makeStore();
    const bytes = load("photo.jpg");
    const h1 = await blobs.putBlob(bytes);
    const h2 = await blobs.putBlob(bytes);
    expect(h2).toBe(h1);
    expect(await blobs.hasBlob(h1)).toBe(true);
  });

  it("partial-checkout materializes only the requested binary", async () => {
    const { store } = makeStore();
    const tree = new InMemoryWorkingTree();
    for (const name of FIXTURES) await tree.write(name, load(name));
    const ref = committedRef(await store.commit(ROOM, null, tree, "alice"));

    const fresh = new InMemoryWorkingTree();
    await store.checkout(ROOM, ref, fresh, { paths: ["minimal.pdf"] });
    expect(await fresh.exists("minimal.pdf")).toBe(true);
    expect(await fresh.exists("photo.jpg")).toBe(false);
    const out = (await fresh.read("minimal.pdf")) as Uint8Array;
    expect(bytesEqual(out, load("minimal.pdf"))).toBe(true);
  });
});
