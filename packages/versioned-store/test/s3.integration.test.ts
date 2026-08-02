import { randomUUID } from "node:crypto";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";

import {
  DefaultVersionedStore,
  InMemoryWorkingTree,
  S3BlobStore,
  S3RoomStore,
  walkFiles,
} from "../src/index.js";
import type { Ref } from "../src/types.js";

const ENDPOINT = process.env.AGENTBE_S3_ENDPOINT ?? "http://localhost:4566";
const BUCKET = "agentbe-versioned-store-it";

const client = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  forcePathStyle: true,
});

/** Fresh store pair on a per-test key prefix so rooms never collide. */
function makeStore() {
  const prefix = `it/${randomUUID()}/`;
  const blobs = new S3BlobStore(client, BUCKET, { prefix });
  const rooms = new S3RoomStore(client, BUCKET, { prefix });
  return { blobs, rooms, store: new DefaultVersionedStore(blobs, rooms) };
}

async function writeFiles(tree: InMemoryWorkingTree, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) await tree.write(path, content);
}

async function readAll(tree: InMemoryWorkingTree): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of await walkFiles(tree)) out[file.path] = new TextDecoder().decode(file.content);
  return out;
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

describe("S3 conditional-write CAS (the load-bearing behavior)", () => {
  it("first HEAD write succeeds; a second racing first-write conflicts", async () => {
    const { rooms } = makeStore();
    expect(await rooms.casHead(ROOM, null, "ref-a")).toBe("ok");
    // Another writer thinking the room is empty must lose.
    expect(await rooms.casHead(ROOM, null, "ref-b")).toBe("conflict");
    expect(await rooms.head(ROOM)).toBe("ref-a");
  });

  it("advancing from a stale expected ref conflicts", async () => {
    const { rooms } = makeStore();
    expect(await rooms.casHead(ROOM, null, "r1")).toBe("ok");
    expect(await rooms.casHead(ROOM, "r1", "r2")).toBe("ok");
    // HEAD is now r2; a writer still holding r1 must lose.
    expect(await rooms.casHead(ROOM, "r1", "r3")).toBe("conflict");
    expect(await rooms.head(ROOM)).toBe("r2");
  });
});

describe("end-to-end over S3", () => {
  it("commits a room and materializes it back", async () => {
    const { store } = makeStore();
    const tree = new InMemoryWorkingTree();
    await writeFiles(tree, { "a.txt": "alpha", "dir/b.txt": "beta" });
    const ref = committedRef(await store.commit(ROOM, null, tree, "alice"));

    const fresh = new InMemoryWorkingTree();
    await store.checkout(ROOM, ref, fresh);
    expect(await readAll(fresh)).toEqual({ "a.txt": "alpha", "dir/b.txt": "beta" });
  });

  it("dedupes identical blobs", async () => {
    const { store, blobs } = makeStore();
    const tree = new InMemoryWorkingTree();
    await writeFiles(tree, { "x.txt": "same", "y.txt": "same" });
    const ref = committedRef(await store.commit(ROOM, null, tree, "alice"));

    const manifest = await store.checkout(ROOM, ref, new InMemoryWorkingTree());
    // Both paths point at one content hash → a single stored blob.
    expect(manifest.entries["x.txt"]!.hash).toBe(manifest.entries["y.txt"]!.hash);
    expect(await blobs.hasBlob(manifest.entries["x.txt"]!.hash)).toBe(true);
  });

  it("merges concurrent non-overlapping edits (per-file LWW) and propagates deletes", async () => {
    const { store } = makeStore();
    const base = new InMemoryWorkingTree();
    await writeFiles(base, { "a.txt": "a0", "b.txt": "b0" });
    const r0 = committedRef(await store.commit(ROOM, null, base, "alice"));

    const treeA = new InMemoryWorkingTree();
    await store.checkout(ROOM, r0, treeA);
    await treeA.write("a.txt", "a-alice");
    await store.commit(ROOM, r0, treeA, "alice");

    const treeB = new InMemoryWorkingTree();
    await store.checkout(ROOM, r0, treeB);
    await treeB.write("b.txt", "b-bob");
    await treeB.rm("a.txt"); // deletes lose to Alice's concurrent edit? No — LWW: my touched paths win.
    const merged = committedRef(await store.commit(ROOM, r0, treeB, "bob"));

    const fresh = new InMemoryWorkingTree();
    await store.checkout(ROOM, merged, fresh);
    // Bob deleted a.txt (his touched path wins over Alice's edit); b.txt is Bob's.
    expect(await readAll(fresh)).toEqual({ "b.txt": "b-bob" });
  });
});
