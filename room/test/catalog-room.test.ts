import { describe, expect, it } from "vitest";

import type { QueryHit } from "@agentbe/index-sync";
import type { WorkingTree } from "@agentbe/versioned-store";

import {
  LocalWorkspaceProvider,
  RoomService,
  type DocumentPage,
  type ListDocumentsOptions,
  type MaterializeOptions,
  type RoomAccessContext,
  type RoomCatalog,
} from "../src/index.js";

const ROOM = "catalog";

class DatabaseLikeCatalog implements RoomCatalog {
  private readonly documents = new Map([
    ["contracts/acme.md", "Acme payment terms"],
    ["notes/roadmap.md", "Product roadmap"],
  ]);

  async revision(): Promise<string> {
    return "tx-42";
  }

  async search(_room: string, query: string, k = 5): Promise<QueryHit[]> {
    return [...this.documents]
      .filter(([, content]) => content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, k)
      .map(([path]) => ({ path, hash: `version:${path}`, score: 1 }));
  }

  async listDocuments(
    _room: string,
    options: ListDocumentsOptions = {},
  ): Promise<DocumentPage> {
    const paths = [...this.documents.keys()].sort();
    const start = options.cursor ? paths.findIndex((path) => path > options.cursor!) : 0;
    if (start < 0) return { paths: [] };
    const limit = options.limit ?? 100;
    const page = paths.slice(start, start + limit);
    const nextCursor = start + page.length < paths.length ? page.at(-1) : undefined;
    return { paths: page, ...(nextCursor ? { nextCursor } : {}) };
  }

  async readDocument(_room: string, path: string): Promise<string> {
    const content = this.documents.get(path);
    if (!content) throw new Error(`document not found: ${path}`);
    return content;
  }

  async materialize(
    _room: string,
    _revision: string,
    tree: WorkingTree,
    options?: MaterializeOptions,
  ): Promise<void> {
    const wanted = options?.paths ? new Set(options.paths) : undefined;
    for (const [path, content] of this.documents) {
      if (!wanted || wanted.has(path)) await tree.write(path, content);
    }
  }
}

describe("RoomService with a manifest-independent catalog", () => {
  function service(): RoomService {
    return new RoomService({
      catalog: new DatabaseLikeCatalog(),
      workspaces: new LocalWorkspaceProvider(),
    });
  }

  it("delegates revision, search, read, and paginated listing", async () => {
    const room = service();
    expect(await room.head(ROOM)).toBe("tx-42");
    expect((await room.search(ROOM, "payment"))[0]?.path).toBe("contracts/acme.md");
    expect(await room.readDocument(ROOM, "notes/roadmap.md")).toContain("roadmap");

    const first = await room.listDocumentPage(ROOM, { limit: 1 });
    expect(first.paths).toEqual(["contracts/acme.md"]);
    expect(first.nextCursor).toBe("contracts/acme.md");
    await expect(
      room.listDocumentPage(ROOM, { cursor: first.nextCursor, limit: 1 }),
    ).resolves.toMatchObject({ paths: ["notes/roadmap.md"] });
  });

  it("materializes a full catalog view but keeps it read-only without commit capability", async () => {
    const session = await service().openSession(ROOM);
    try {
      expect(session.canCommit).toBe(false);
      expect(String(await session.exec("cat contracts/acme.md"))).toContain("payment terms");
      await expect(session.commit("alice")).rejects.toThrow(/catalog is read-only/);
    } finally {
      await session.close();
    }
  });

  it("surfaces unsupported direct ingestion instead of assuming manifest writes", async () => {
    await expect(
      service().putDocuments(ROOM, { "new.md": "new" }, "alice"),
    ).rejects.toThrow(/does not support direct ingestion/);
  });

  it("passes authenticated context to policy-aware catalog operations", async () => {
    class PolicyCatalog extends DatabaseLikeCatalog {
      override async readDocument(
        room: string,
        path: string,
        context?: RoomAccessContext,
      ): Promise<string> {
        if (context?.principal !== "alice") throw new Error("forbidden");
        return super.readDocument(room, path);
      }
    }
    const room = new RoomService({ catalog: new PolicyCatalog() });

    await expect(room.readDocument(ROOM, "notes/roadmap.md")).rejects.toThrow(/forbidden/);
    await expect(
      room.readDocument(ROOM, "notes/roadmap.md", { principal: "alice" }),
    ).resolves.toContain("roadmap");
  });
});
