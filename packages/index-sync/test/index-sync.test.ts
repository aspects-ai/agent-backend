import { describe, expect, it } from "vitest";

import {
  DefaultVersionedStore,
  InMemoryBlobStore,
  InMemoryRoomStore,
  InMemoryWorkingTree,
} from "@agentbe/versioned-store";

import {
  HashingEmbeddingProvider,
  IndexSync,
  InMemoryVectorStore,
  type EmbeddingProvider,
} from "../src/index.js";

const ROOM = "room";

/** Wraps an embedder to count how many texts were actually embedded. */
class CountingEmbedder implements EmbeddingProvider {
  textsEmbedded = 0;
  constructor(private readonly inner: EmbeddingProvider) {}
  get dimensions(): number {
    return this.inner.dimensions;
  }
  async embed(texts: string[]): Promise<number[][]> {
    this.textsEmbedded += texts.length;
    return this.inner.embed(texts);
  }
}

function setup() {
  const blobs = new InMemoryBlobStore();
  const rooms = new InMemoryRoomStore();
  const store = new DefaultVersionedStore(blobs, rooms);
  const embedder = new CountingEmbedder(new HashingEmbeddingProvider());
  const vectors = new InMemoryVectorStore();
  const index = new IndexSync(blobs, rooms, embedder, vectors);
  return { store, embedder, index };
}

async function commit(
  store: DefaultVersionedStore,
  base: string | null,
  files: Record<string, string | Uint8Array>,
): Promise<string> {
  const tree = new InMemoryWorkingTree();
  for (const [path, content] of Object.entries(files)) await tree.write(path, content);
  const result = await store.commit(ROOM, base, tree, "tester");
  if (result.status !== "committed") throw new Error("commit failed");
  return result.ref;
}

describe("IndexSync", () => {
  it("returns the most relevant document for a query", async () => {
    const { store, index } = setup();
    const ref = await commit(store, null, {
      "vendors.md": "Acme Corp vendor invoice and payment totals for the fiscal year",
      "recipes.md": "how to cook pasta with tomato basil and garlic sauce",
    });
    await index.sync(ROOM, ref);

    const hits = await index.query(ROOM, "vendor invoice payment", 2);
    expect(hits[0]?.path).toBe("vendors.md");
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it("embeds each unique blob once and never re-embeds unchanged content", async () => {
    const { store, index, embedder } = setup();
    const ref = await commit(store, null, {
      "a.md": "identical shared content here",
      "b.md": "identical shared content here", // same bytes → same hash
      "c.md": "completely different words entirely",
    });

    await index.sync(ROOM, ref);
    // Two distinct blobs (a/b share one, c another) → two embeddings, not three.
    expect(embedder.textsEmbedded).toBe(2);

    // Re-syncing the same ref embeds nothing new.
    const before = embedder.textsEmbedded;
    await index.sync(ROOM, ref);
    expect(embedder.textsEmbedded).toBe(before);
  });

  it("syncDiff applies adds, changes, and deletes", async () => {
    const { store, index } = setup();
    const r0 = await commit(store, null, { "a.md": "alpha content", "b.md": "beta content" });
    await index.sync(ROOM, r0);

    // a modified, c added, b deleted (tree omits b).
    const r1 = await commit(store, r0, { "a.md": "alpha content revised", "c.md": "gamma content" });
    const diff = await index.syncDiff(ROOM, r0, r1);
    expect(diff).toEqual({ added: 1, changed: 1, deleted: 1 });

    const gamma = await index.query(ROOM, "gamma content", 5);
    expect(gamma[0]?.path).toBe("c.md");
    // The deleted doc is gone from the index.
    const all = await index.query(ROOM, "beta content", 5);
    expect(all.some((h) => h.path === "b.md")).toBe(false);
  });

  it("skips non-text (binary) files", async () => {
    const { store, index } = setup();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ref = await commit(store, null, { "notes.md": "some searchable text", "logo.png": png });

    const result = await index.sync(ROOM, ref);
    expect(result.indexed).toBe(1); // only notes.md

    const hits = await index.query(ROOM, "searchable", 5);
    expect(hits.some((h) => h.path === "logo.png")).toBe(false);
    expect(hits[0]?.path).toBe("notes.md");
  });
});
