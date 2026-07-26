import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildRoomService } from "../src/index.js";

const PDF = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "packages",
  "versioned-store",
  "test",
  "fixtures",
  "document.pdf",
);
const ROOM = "room";

describe("PDF ingestion", () => {
  it("extracts a PDF's text on upload and makes it searchable", async () => {
    // buildRoomService wires the default UnpdfExtractionProvider.
    const service = buildRoomService();
    const pdf = new Uint8Array(readFileSync(PDF));
    await service.putDocuments(ROOM, { "docs/sample.pdf": pdf }, "alice");

    const docs = await service.listDocuments(ROOM);
    expect(docs).toContain("docs/sample.pdf"); // raw PDF preserved as a blob
    expect(docs).toContain("docs/sample.pdf.txt"); // derived, searchable text

    const hits = await service.search(ROOM, "lorem ipsum dolor sit", 5);
    expect(hits.map((h) => h.path)).toContain("docs/sample.pdf.txt");
  });
});
