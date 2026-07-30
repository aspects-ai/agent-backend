import { describe, expect, it } from "vitest";

import {
  InMemoryBlobStore,
  InMemoryRoomStore,
  type BlobStore,
} from "@agentbe/versioned-store";
import { HashingEmbeddingProvider, InMemoryVectorStore } from "@agentbe/index-sync";

import { LocalWorkspaceProvider, RoomService } from "../src/index.js";

const ROOM = "room";

function makeService(): RoomService {
  return new RoomService({
    blobs: new InMemoryBlobStore(),
    rooms: new InMemoryRoomStore(),
    embedder: new HashingEmbeddingProvider(),
    vectors: new InMemoryVectorStore(),
    workspaces: new LocalWorkspaceProvider(),
  });
}

describe("RoomService", () => {
  it("adds documents and finds them by semantic search", async () => {
    const svc = makeService();
    await svc.putDocuments(
      ROOM,
      {
        "vendors.md": "Acme Corp vendor invoice and payment totals for the year",
        "recipes.md": "cook pasta with tomato and basil sauce",
      },
      "alice",
    );
    const hits = await svc.search(ROOM, "vendor invoice payment", 2);
    expect(hits[0]?.path).toBe("vendors.md");
  });

  it("preserves existing documents across incremental adds", async () => {
    const svc = makeService();
    const r0 = await svc.putDocuments(ROOM, { "a.md": "alpha content" }, "alice");
    const r1 = await svc.putDocuments(ROOM, { "b.md": "beta content" }, "alice");
    expect(r1).not.toBe(r0);
    expect((await svc.search(ROOM, "alpha content", 5)).some((h) => h.path === "a.md")).toBe(true);
    expect((await svc.search(ROOM, "beta content", 5)).some((h) => h.path === "b.md")).toBe(true);
  });

  it("adds a document without downloading the existing corpus", async () => {
    class ObservedBlobs implements BlobStore {
      readonly inner = new InMemoryBlobStore();
      readonly reads: string[] = [];
      putBlob(bytes: Uint8Array): Promise<string> {
        return this.inner.putBlob(bytes);
      }
      async getBlob(hash: string): Promise<Uint8Array> {
        const bytes = await this.inner.getBlob(hash);
        this.reads.push(new TextDecoder().decode(bytes));
        return bytes;
      }
      hasBlob(hash: string): Promise<boolean> {
        return this.inner.hasBlob(hash);
      }
    }

    const blobs = new ObservedBlobs();
    const svc = new RoomService({
      blobs,
      rooms: new InMemoryRoomStore(),
      embedder: new HashingEmbeddingProvider(),
      vectors: new InMemoryVectorStore(),
    });
    await svc.putDocuments(ROOM, { "a.md": "alpha existing corpus" }, "alice");
    blobs.reads.length = 0;

    await svc.putDocuments(ROOM, { "b.md": "beta incremental document" }, "alice");

    expect(blobs.reads).not.toContain("alpha existing corpus");
    expect(await svc.listDocuments(ROOM)).toEqual(["a.md", "b.md"]);
  });

  it("full session runs a command, edits, and commits back", async () => {
    const svc = makeService();
    await svc.putDocuments(ROOM, { "data.txt": "one\ntwo\nthree\n" }, "alice");

    const session = await svc.openSession(ROOM);
    try {
      expect(session.canCommit).toBe(true);
      const wc = await session.exec("wc -l < data.txt");
      expect(parseInt(String(wc).trim(), 10)).toBe(3);
      await session.tree.write("summary.md", "counted three lines in the data");
      const ref = await session.commit("alice");
      expect(ref).toBeTruthy();
    } finally {
      await session.close();
    }

    expect(
      (await svc.search(ROOM, "counted lines summary", 5)).some((h) => h.path === "summary.md"),
    ).toBe(true);
  });

  it("paths-scoped session is read-only (guards the partial-commit footgun)", async () => {
    const svc = makeService();
    await svc.putDocuments(ROOM, { "a.md": "alpha keep me", "b.md": "beta keep me" }, "alice");

    const session = await svc.openSession(ROOM, { paths: ["a.md"] });
    try {
      expect(session.canCommit).toBe(false);
      const cat = await session.exec("cat a.md");
      expect(String(cat)).toContain("alpha");
      await expect(session.commit("alice")).rejects.toThrow(/paths-scoped/);
    } finally {
      await session.close();
    }

    // b.md was never checked out but is still safely in the room.
    expect((await svc.search(ROOM, "beta keep me", 5)).some((h) => h.path === "b.md")).toBe(true);
  });
});

describe("RoomService retrieval-only (no sandbox provider)", () => {
  function retrievalOnly(): RoomService {
    return new RoomService({
      blobs: new InMemoryBlobStore(),
      rooms: new InMemoryRoomStore(),
      embedder: new HashingEmbeddingProvider(),
      vectors: new InMemoryVectorStore(),
      // no `workspaces` — retrieval/ingestion need no sandbox
    });
  }

  it("ingests, searches, reads, and lists without a WorkspaceProvider", async () => {
    const svc = retrievalOnly();
    await svc.putDocuments(ROOM, { "vendors.md": "acme vendor invoice payment totals" }, "alice");
    expect((await svc.search(ROOM, "vendor invoice payment", 3))[0]?.path).toBe("vendors.md");
    expect(await svc.readDocument(ROOM, "vendors.md")).toContain("acme");
    expect(await svc.listDocuments(ROOM)).toContain("vendors.md");
  });

  it("refuses to open a session without a provider", async () => {
    const svc = retrievalOnly();
    await svc.putDocuments(ROOM, { "a.md": "alpha" }, "alice");
    await expect(svc.openSession(ROOM)).rejects.toThrow(/WorkspaceProvider/);
  });
});
