import { describe, expect, it } from "vitest";

import {
  DefaultVersionedStore,
  InMemoryBlobStore,
  InMemoryRoomStore,
  InMemoryWorkingTree,
} from "@agentbe/versioned-store";

import { ImageIndexSync, InMemoryVectorStore, type ImageEmbeddingProvider } from "../src/index.js";

const ROOM = "room";

/** Deterministic fake: an image → one-hot by its first byte; a text query →
 * one-hot by a keyword. Lets us assert routing/ranking without a real model. */
class FakeImageEmbedder implements ImageEmbeddingProvider {
  readonly dimensions = 8;
  private oneHot(index: number): number[] {
    const v = new Array<number>(8).fill(0);
    v[index % 8] = 1;
    return v;
  }
  async embedImages(images: Uint8Array[]): Promise<number[][]> {
    return images.map((img) => this.oneHot(img[0] ?? 0));
  }
  async embedText(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.oneHot(t.includes("one") ? 1 : t.includes("two") ? 2 : 0));
  }
}

describe("ImageIndexSync", () => {
  async function seeded() {
    const blobs = new InMemoryBlobStore();
    const rooms = new InMemoryRoomStore();
    const store = new DefaultVersionedStore(blobs, rooms);
    const index = new ImageIndexSync(blobs, rooms, new FakeImageEmbedder(), new InMemoryVectorStore());

    const tree = new InMemoryWorkingTree();
    await tree.write("cat.png", new Uint8Array([1, 9, 9])); // → one-hot[1]
    await tree.write("dog.png", new Uint8Array([2, 9, 9])); // → one-hot[2]
    await tree.write("notes.md", "some text"); // not an image
    const result = await store.commit(ROOM, null, tree, "seed");
    const ref = result.status === "committed" ? result.ref : "";
    return { index, ref };
  }

  it("indexes only image files and ranks by text→image similarity", async () => {
    const { index, ref } = await seeded();
    const { indexed } = await index.sync(ROOM, ref);
    expect(indexed).toBe(2); // cat.png + dog.png, not notes.md

    const one = await index.query(ROOM, "one", 5);
    expect(one[0]?.path).toBe("cat.png");
    expect(one.map((h) => h.path)).not.toContain("notes.md");

    const two = await index.query(ROOM, "two", 5);
    expect(two[0]?.path).toBe("dog.png");
  });
});
