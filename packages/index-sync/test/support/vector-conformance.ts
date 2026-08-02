import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VectorStore } from "../../src/index.js";

export interface VectorHarness {
  store: VectorStore;
  cleanup?: () => Promise<void> | void;
}

export type VectorFactory = () => VectorHarness | Promise<VectorHarness>;

const ROOM = "room";

/** The behavioral contract every `VectorStore` must satisfy. Run against the
 * in-memory reference and the pgvector adapter so they can't drift. */
export function runVectorStoreConformance(name: string, make: VectorFactory): void {
  describe(`vector store conformance: ${name}`, () => {
    let store: VectorStore;
    let cleanup: (() => Promise<void> | void) | undefined;

    beforeEach(async () => {
      const harness = await make();
      store = harness.store;
      cleanup = harness.cleanup;
    });
    afterEach(async () => {
      await cleanup?.();
    });

    it("stores embeddings content-addressed by hash", async () => {
      expect(await store.hasEmbedding("h1")).toBe(false);
      await store.putEmbedding("h1", [1, 0, 0]);
      expect(await store.hasEmbedding("h1")).toBe(true);
    });

    it("ranks a room's records by cosine similarity to the query", async () => {
      await store.putEmbedding("ha", [1, 0, 0]);
      await store.putEmbedding("hb", [0, 1, 0]);
      await store.upsertRecords(ROOM, [
        { path: "a.txt", hash: "ha" },
        { path: "b.txt", hash: "hb" },
      ]);
      const hits = await store.query(ROOM, [1, 0, 0], 5);
      expect(hits[0]?.path).toBe("a.txt");
      expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    });

    it("upserts a path's hash", async () => {
      await store.putEmbedding("ha", [1, 0, 0]);
      await store.putEmbedding("hb", [0, 1, 0]);
      await store.upsertRecords(ROOM, [{ path: "a.txt", hash: "ha" }]);
      await store.upsertRecords(ROOM, [{ path: "a.txt", hash: "hb" }]);
      const hits = await store.query(ROOM, [0, 1, 0], 5);
      expect(hits[0]?.hash).toBe("hb");
    });

    it("deletes records", async () => {
      await store.putEmbedding("ha", [1, 0, 0]);
      await store.upsertRecords(ROOM, [
        { path: "a.txt", hash: "ha" },
        { path: "b.txt", hash: "ha" },
      ]);
      await store.deleteRecords(ROOM, ["a.txt"]);
      const hits = await store.query(ROOM, [1, 0, 0], 5);
      expect(hits.map((h) => h.path)).toEqual(["b.txt"]);
    });

    it("clears a room", async () => {
      await store.putEmbedding("ha", [1, 0, 0]);
      await store.upsertRecords(ROOM, [{ path: "a.txt", hash: "ha" }]);
      await store.clearRoom(ROOM);
      expect(await store.query(ROOM, [1, 0, 0], 5)).toEqual([]);
    });

    it("is room-scoped", async () => {
      await store.putEmbedding("ha", [1, 0, 0]);
      await store.upsertRecords("room-a", [{ path: "a.txt", hash: "ha" }]);
      expect(await store.query("room-b", [1, 0, 0], 5)).toEqual([]);
    });
  });
}
