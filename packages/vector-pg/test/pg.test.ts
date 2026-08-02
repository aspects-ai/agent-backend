import { describe, expect, it } from "vitest";

import { PgVectorStore, type PgQueryable } from "../src/index.js";

/** Records queries and returns canned rows for the ranking SELECT. */
class FakePg implements PgQueryable {
  readonly calls: Array<{ text: string; params?: unknown[] }> = [];
  async query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> {
    this.calls.push({ text, params });
    if (text.includes("SELECT r.path")) {
      return { rows: [{ path: "a.txt", hash: "ha", score: 0.9 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

describe("PgVectorStore (unit, fake client)", () => {
  it("namespaces tables to the given dimension and formats vectors", async () => {
    const pg = new FakePg();
    await new PgVectorStore(pg, { dimensions: 3, namespace: "text" }).putEmbedding("h1", [1, 2, 3]);

    expect(pg.calls.some((c) => c.text.includes("CREATE TABLE IF NOT EXISTS text_embeddings"))).toBe(
      true,
    );
    expect(pg.calls.some((c) => c.text.includes("vector(3)"))).toBe(true);
    const insert = pg.calls.find((c) => c.text.includes("INSERT INTO text_embeddings"));
    expect(insert?.params).toEqual(["h1", "[1,2,3]"]);
  });

  it("issues a cosine ranking query and maps rows to hits", async () => {
    const pg = new FakePg();
    const store = new PgVectorStore(pg, { dimensions: 3 });
    const hits = await store.query("room-1", [1, 0, 0], 5);

    expect(hits).toEqual([{ path: "a.txt", hash: "ha", score: 0.9 }]);
    const select = pg.calls.find((c) => c.text.includes("SELECT r.path"));
    expect(select?.text).toContain("<=> $2::vector");
    expect(select?.params).toEqual(["room-1", "[1,0,0]", 5]);
  });
});
