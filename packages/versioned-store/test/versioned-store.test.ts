import { describe, expect, it } from "vitest";

import {
  DefaultVersionedStore,
  InMemoryBlobStore,
  InMemoryRoomStore,
  InMemoryWorkingTree,
  walkFiles,
} from "../src/index.js";
import type { Manifest, Ref, RoomId } from "../src/types.js";
import type { RoomStore } from "../src/index.js";

const ROOM = "room-1";

function makeStore() {
  const blobs = new InMemoryBlobStore();
  const rooms = new InMemoryRoomStore();
  const store = new DefaultVersionedStore(blobs, rooms);
  return { blobs, rooms, store };
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

describe("checkout / commit round-trip", () => {
  it("commits a fresh room and materializes it back", async () => {
    const { store, rooms } = makeStore();
    const tree = new InMemoryWorkingTree();
    await writeFiles(tree, { "a.txt": "alpha", "dir/b.txt": "beta" });

    const ref = committedRef(await store.commit(ROOM, null, tree, "alice"));
    expect(await rooms.head(ROOM)).toBe(ref);

    const fresh = new InMemoryWorkingTree();
    const manifest = await store.checkout(ROOM, ref, fresh);
    expect(manifest.parent).toBeNull();
    expect(await readAll(fresh)).toEqual({ "a.txt": "alpha", "dir/b.txt": "beta" });
  });

  it("dedupes identical content across paths and commits", async () => {
    const { store, blobs } = makeStore();
    const tree = new InMemoryWorkingTree();
    await writeFiles(tree, { "x.txt": "same", "y.txt": "same", "z.txt": "different" });

    await store.commit(ROOM, null, tree, "alice");
    // "same" stored once, "different" once → 2 distinct blobs for 3 files.
    expect(blobs.count).toBe(2);
  });

  it("supports partial checkout of a path subset", async () => {
    const { store } = makeStore();
    const tree = new InMemoryWorkingTree();
    await writeFiles(tree, { "a.txt": "A", "b.txt": "B", "c.txt": "C" });
    const ref = committedRef(await store.commit(ROOM, null, tree, "alice"));

    const fresh = new InMemoryWorkingTree();
    await store.checkout(ROOM, ref, fresh, { paths: ["a.txt", "c.txt"] });
    expect(await readAll(fresh)).toEqual({ "a.txt": "A", "c.txt": "C" });
  });
});

describe("commit-back with per-file LWW", () => {
  async function baseCommit(store: DefaultVersionedStore): Promise<Ref> {
    const tree = new InMemoryWorkingTree();
    await writeFiles(tree, { "a.txt": "a0", "b.txt": "b0" });
    return committedRef(await store.commit(ROOM, null, tree, "alice"));
  }

  it("merges non-overlapping concurrent edits", async () => {
    const { store } = makeStore();
    const r0 = await baseCommit(store);

    // Alice edits a.txt from r0 and commits.
    const treeA = new InMemoryWorkingTree();
    await store.checkout(ROOM, r0, treeA);
    await treeA.write("a.txt", "a-alice");
    await store.commit(ROOM, r0, treeA, "alice");

    // Bob branched from r0, edits b.txt, commits → conflict path, LWW merge.
    const treeB = new InMemoryWorkingTree();
    await store.checkout(ROOM, r0, treeB);
    await treeB.write("b.txt", "b-bob");
    const merged = committedRef(await store.commit(ROOM, r0, treeB, "bob"));

    const fresh = new InMemoryWorkingTree();
    await store.checkout(ROOM, merged, fresh);
    expect(await readAll(fresh)).toEqual({ "a.txt": "a-alice", "b.txt": "b-bob" });
  });

  it("last writer wins on overlapping edits", async () => {
    const { store } = makeStore();
    const r0 = await baseCommit(store);

    const treeA = new InMemoryWorkingTree();
    await store.checkout(ROOM, r0, treeA);
    await treeA.write("a.txt", "a-alice");
    await store.commit(ROOM, r0, treeA, "alice");

    const treeB = new InMemoryWorkingTree();
    await store.checkout(ROOM, r0, treeB);
    await treeB.write("a.txt", "a-bob");
    const merged = committedRef(await store.commit(ROOM, r0, treeB, "bob"));

    const fresh = new InMemoryWorkingTree();
    await store.checkout(ROOM, merged, fresh);
    expect((await readAll(fresh))["a.txt"]).toBe("a-bob");
  });

  it("propagates deletes", async () => {
    const { store } = makeStore();
    const r0 = await baseCommit(store);

    const tree = new InMemoryWorkingTree();
    await store.checkout(ROOM, r0, tree);
    await tree.rm("a.txt");
    const ref = committedRef(await store.commit(ROOM, r0, tree, "alice"));

    const fresh = new InMemoryWorkingTree();
    await store.checkout(ROOM, ref, fresh);
    expect(await readAll(fresh)).toEqual({ "b.txt": "b0" });
  });
});

describe("CAS retry", () => {
  // Wraps a RoomStore to advance HEAD underneath the first casHead call,
  // forcing exactly one lost race so the retry loop is exercised.
  class RacyRoomStore implements RoomStore {
    private raced = false;
    constructor(
      private readonly inner: RoomStore,
      private readonly onRace: () => Promise<void>,
    ) {}
    head(room: RoomId) {
      return this.inner.head(room);
    }
    getManifest(room: RoomId, ref: Ref) {
      return this.inner.getManifest(room, ref);
    }
    putManifest(manifest: Manifest) {
      return this.inner.putManifest(manifest);
    }
    async casHead(room: RoomId, expected: Ref | null, next: Ref) {
      if (!this.raced) {
        this.raced = true;
        await this.onRace();
      }
      return this.inner.casHead(room, expected, next);
    }
  }

  it("retries and merges when HEAD moves between read and CAS", async () => {
    const blobs = new InMemoryBlobStore();
    const rooms = new InMemoryRoomStore();

    // Seed base r0.
    const seed = new DefaultVersionedStore(blobs, rooms);
    const base = new InMemoryWorkingTree();
    await writeFiles(base, { "a.txt": "a0", "b.txt": "b0" });
    const r0 = committedRef(await seed.commit(ROOM, null, base, "alice"));

    // The race: an external committer adds c.txt on top of r0.
    const onRace = async () => {
      const other = new InMemoryWorkingTree();
      await seed.checkout(ROOM, r0, other);
      await other.write("c.txt", "c-ext");
      await seed.commit(ROOM, r0, other, "carol");
    };

    const racyStore = new DefaultVersionedStore(blobs, new RacyRoomStore(rooms, onRace));
    const mine = new InMemoryWorkingTree();
    await seed.checkout(ROOM, r0, mine);
    await mine.write("a.txt", "a-me");
    const merged = committedRef(await racyStore.commit(ROOM, r0, mine, "bob"));

    const fresh = new InMemoryWorkingTree();
    await new DefaultVersionedStore(blobs, rooms).checkout(ROOM, merged, fresh);
    // My edit, the external add, and the untouched file all survive.
    expect(await readAll(fresh)).toEqual({ "a.txt": "a-me", "b.txt": "b0", "c.txt": "c-ext" });
  });
});
