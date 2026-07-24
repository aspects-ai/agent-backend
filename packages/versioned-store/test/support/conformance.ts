import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DefaultVersionedStore, InMemoryWorkingTree, walkFiles } from "../../src/index.js";
import type { BlobStore, Manifest, Ref, RoomStore } from "../../src/index.js";

export interface StoreHarness {
  blobs: BlobStore;
  rooms: RoomStore;
  cleanup?: () => Promise<void> | void;
}

export type StoreFactory = () => StoreHarness | Promise<StoreHarness>;

const ROOM = "room";

async function readAll(tree: InMemoryWorkingTree): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of await walkFiles(tree)) out[file.path] = new TextDecoder().decode(file.content);
  return out;
}

function committedRef(result: { status: string; ref?: Ref }): Ref {
  expect(result.status).toBe("committed");
  return result.ref as Ref;
}

/**
 * The behavioral contract every `BlobStore`/`RoomStore` pair must satisfy. Run
 * against in-memory, filesystem, and S3 backends so a fake can never silently
 * drift from a real store (which is exactly how the CAS-atomicity and byte-read
 * bugs escaped notice earlier).
 */
export function runStoreConformance(name: string, make: StoreFactory): void {
  describe(`store conformance: ${name}`, () => {
    let harness: StoreHarness;
    let store: DefaultVersionedStore;

    beforeEach(async () => {
      harness = await make();
      store = new DefaultVersionedStore(harness.blobs, harness.rooms, { maxCommitRetries: 20 });
    });
    afterEach(async () => {
      await harness.cleanup?.();
    });

    it("round-trips a commit and checkout", async () => {
      const tree = new InMemoryWorkingTree();
      await tree.write("a.txt", "alpha");
      await tree.write("dir/b.txt", "beta");
      const ref = committedRef(await store.commit(ROOM, null, tree, "alice"));

      const fresh = new InMemoryWorkingTree();
      await store.checkout(ROOM, ref, fresh);
      expect(await readAll(fresh)).toEqual({ "a.txt": "alpha", "dir/b.txt": "beta" });
    });

    it("dedupes identical content across paths", async () => {
      const tree = new InMemoryWorkingTree();
      await tree.write("x.txt", "same");
      await tree.write("y.txt", "same");
      const ref = committedRef(await store.commit(ROOM, null, tree, "alice"));

      const manifest = await store.checkout(ROOM, ref, new InMemoryWorkingTree());
      expect(manifest.entries["x.txt"]!.hash).toBe(manifest.entries["y.txt"]!.hash);
      expect(await harness.blobs.hasBlob(manifest.entries["x.txt"]!.hash)).toBe(true);
    });

    it("materializes only requested paths on partial checkout", async () => {
      const tree = new InMemoryWorkingTree();
      await tree.write("a.txt", "A");
      await tree.write("b.txt", "B");
      const ref = committedRef(await store.commit(ROOM, null, tree, "alice"));

      const fresh = new InMemoryWorkingTree();
      await store.checkout(ROOM, ref, fresh, { paths: ["a.txt"] });
      expect(await readAll(fresh)).toEqual({ "a.txt": "A" });
    });

    it("merges non-overlapping edits and propagates deletes (per-file LWW)", async () => {
      const base = new InMemoryWorkingTree();
      await base.write("a.txt", "a0");
      await base.write("b.txt", "b0");
      const r0 = committedRef(await store.commit(ROOM, null, base, "alice"));

      const a = new InMemoryWorkingTree();
      await store.checkout(ROOM, r0, a);
      await a.write("a.txt", "a-edited");
      await store.commit(ROOM, r0, a, "alice");

      const b = new InMemoryWorkingTree();
      await store.checkout(ROOM, r0, b);
      await b.write("b.txt", "b-edited");
      await b.rm("a.txt");
      const merged = committedRef(await store.commit(ROOM, r0, b, "bob"));

      const fresh = new InMemoryWorkingTree();
      await store.checkout(ROOM, merged, fresh);
      // Bob's touched paths win: a.txt deleted, b.txt his.
      expect(await readAll(fresh)).toEqual({ "b.txt": "b-edited" });
    });

    it("honors the HEAD CAS contract (sequential)", async () => {
      const { rooms } = harness;
      expect(await rooms.casHead(ROOM, null, "r0")).toBe("ok");
      expect(await rooms.casHead(ROOM, null, "rX")).toBe("conflict"); // room already exists
      expect(await rooms.head(ROOM)).toBe("r0");
      expect(await rooms.casHead(ROOM, "r0", "r1")).toBe("ok");
      expect(await rooms.casHead(ROOM, "r0", "rZ")).toBe("conflict"); // stale expected
      expect(await rooms.head(ROOM)).toBe("r1");
    });

    it("persists and round-trips a manifest faithfully", async () => {
      const manifest: Manifest = {
        room: ROOM,
        ref: "ref-1",
        parent: null,
        createdBy: "alice",
        entries: {
          "a.txt": { hash: "h1", size: 5, mode: 0o100644 },
          "img.png": {
            hash: "h2",
            size: 9,
            mode: 0o100644,
            media: { contentType: "image/png", derivedTextPath: "img.txt" },
          },
        },
      };
      await harness.rooms.putManifest(manifest);
      expect(await harness.rooms.getManifest(ROOM, "ref-1")).toEqual(manifest);
    });
  });
}
