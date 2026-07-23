import { describe, expect, it } from "vitest";

import { InMemoryBlobStore, InMemoryRoomStore } from "@agentbe/versioned-store";
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
