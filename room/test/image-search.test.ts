import { describe, expect, it } from "vitest";

import { InMemoryBlobStore, InMemoryRoomStore } from "@agentbe/versioned-store";
import {
  HashingEmbeddingProvider,
  InMemoryVectorStore,
  type ImageEmbeddingProvider,
} from "@agentbe/index-sync";

import { RoomService } from "../src/index.js";

const ROOM = "room";

/** Deterministic fake: image → one-hot by first byte; text query → one-hot by
 * keyword. Verifies routing/ranking without a real CLIP model. */
class FakeImageEmbedder implements ImageEmbeddingProvider {
  readonly dimensions = 8;
  private oneHot(i: number): number[] {
    const v = new Array<number>(8).fill(0);
    v[i % 8] = 1;
    return v;
  }
  async embedImages(images: Uint8Array[]): Promise<number[][]> {
    return images.map((img) => this.oneHot(img[0] ?? 0));
  }
  async embedText(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.oneHot(t.includes("cat") ? 1 : t.includes("dog") ? 2 : 0));
  }
}

function makeService(withImages = true): RoomService {
  return new RoomService({
    blobs: new InMemoryBlobStore(),
    rooms: new InMemoryRoomStore(),
    embedder: new HashingEmbeddingProvider(),
    vectors: new InMemoryVectorStore(),
    ...(withImages ? { imageEmbedder: new FakeImageEmbedder() } : {}),
  });
}

async function seed(svc: RoomService): Promise<void> {
  await svc.putDocuments(
    ROOM,
    {
      "notes.md": "vendor invoice payment terms",
      "cat.png": new Uint8Array([1, 9, 9]), // → one-hot[1]
      "dog.png": new Uint8Array([2, 9, 9]), // → one-hot[2]
    },
    "seed",
  );
}

describe("image + multimodal search", () => {
  it("image modality retrieves images by text→image similarity, excluding docs", async () => {
    const svc = makeService();
    await seed(svc);
    const hits = await svc.search(ROOM, "a cat", 5, "image");
    expect(hits[0]?.path).toBe("cat.png");
    expect(hits.map((h) => h.path)).not.toContain("notes.md");
  });

  it("text modality searches only documents, excluding images", async () => {
    const svc = makeService();
    await seed(svc);
    const hits = await svc.search(ROOM, "vendor invoice payment", 5, "text");
    expect(hits.map((h) => h.path)).toContain("notes.md");
    expect(hits.map((h) => h.path)).not.toContain("cat.png");
  });

  it("combined (default) search spans both modalities", async () => {
    const svc = makeService();
    await seed(svc);
    expect((await svc.search(ROOM, "vendor invoice payment", 10)).map((h) => h.path)).toContain(
      "notes.md",
    );
    expect((await svc.search(ROOM, "a cat", 10)).map((h) => h.path)).toContain("cat.png");
  });

  it("returns no image results when no image embedder is configured", async () => {
    const svc = makeService(false);
    await svc.putDocuments(ROOM, { "cat.png": new Uint8Array([1, 9, 9]) }, "seed");
    expect(await svc.search(ROOM, "a cat", 5, "image")).toEqual([]);
  });
});
