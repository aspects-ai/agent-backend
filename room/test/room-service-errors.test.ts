import { describe, expect, it } from "vitest";

import { InMemoryBlobStore, InMemoryRoomStore } from "@agentbe/versioned-store";
import type { Manifest, Ref, RoomId, RoomStore } from "@agentbe/versioned-store";
import { HashingEmbeddingProvider, InMemoryVectorStore } from "@agentbe/index-sync";

import { LocalWorkspaceProvider, RoomService } from "../src/index.js";

const ROOM = "room";

function makeService(rooms: RoomStore = new InMemoryRoomStore()): RoomService {
  return new RoomService({
    blobs: new InMemoryBlobStore(),
    rooms,
    embedder: new HashingEmbeddingProvider(),
    vectors: new InMemoryVectorStore(),
    workspaces: new LocalWorkspaceProvider(),
  });
}

/** A room store whose HEAD advance never succeeds — forces commit to exhaust
 * its retries so we can assert the conflict surfaces as an error. */
class AlwaysConflictRooms implements RoomStore {
  constructor(private readonly inner: RoomStore) {}
  head(room: RoomId): Promise<Ref | null> {
    return this.inner.head(room);
  }
  getManifest(room: RoomId, ref: Ref): Promise<Manifest> {
    return this.inner.getManifest(room, ref);
  }
  putManifest(manifest: Manifest): Promise<void> {
    return this.inner.putManifest(manifest);
  }
  async casHead(): Promise<"ok" | "conflict"> {
    return "conflict";
  }
}

describe("RoomService error paths", () => {
  it("returns empty results and null head for an unknown room", async () => {
    const svc = makeService();
    expect(await svc.head("does-not-exist")).toBeNull();
    expect(await svc.search("does-not-exist", "anything")).toEqual([]);
  });

  it("throws when a session is used after close", async () => {
    const svc = makeService();
    await svc.putDocuments(ROOM, { "a.md": "alpha" }, "alice");
    const session = await svc.openSession(ROOM);
    await session.close();
    await expect(session.exec("echo hi")).rejects.toThrow(/closed/);
    await expect(session.commit("alice")).rejects.toThrow(/closed/);
  });

  it("close is idempotent", async () => {
    const svc = makeService();
    await svc.putDocuments(ROOM, { "a.md": "alpha" }, "alice");
    const session = await svc.openSession(ROOM);
    await session.close();
    await expect(session.close()).resolves.toBeUndefined();
  });

  it("surfaces an unresolvable commit conflict as an error", async () => {
    const svc = makeService(new AlwaysConflictRooms(new InMemoryRoomStore()));
    await expect(svc.putDocuments(ROOM, { "a.md": "alpha" }, "alice")).rejects.toThrow(
      /commit failed/,
    );
  });

  it("a paths-scoped session refuses to commit", async () => {
    const svc = makeService();
    await svc.putDocuments(ROOM, { "a.md": "alpha", "b.md": "beta" }, "alice");
    const session = await svc.openSession(ROOM, { paths: ["a.md"] });
    try {
      await expect(session.commit("alice")).rejects.toThrow(/paths-scoped/);
    } finally {
      await session.close();
    }
  });
});
