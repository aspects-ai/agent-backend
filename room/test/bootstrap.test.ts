import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildRoomService, seedRoomFromDir } from "../src/index.js";

const TESTDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "testdata");

describe("bootstrap seed", () => {
  it("seeds the demo corpus and makes it searchable", async () => {
    const service = buildRoomService();
    const seeded = await seedRoomFromDir(service, "demo", TESTDATA);
    expect(seeded).toBe(5);

    const docs = await service.listDocuments("demo");
    expect(docs).toContain("contracts/acme-msa.md");
    expect(docs).toContain("data/ag_exports.csv");

    const hits = await service.search("demo", "vendor payment terms net-30 invoice", 3);
    expect(hits.some((h) => h.path.startsWith("contracts/"))).toBe(true);
  });
});
