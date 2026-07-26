import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { UnpdfExtractionProvider } from "../src/index.js";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "versioned-store",
  "test",
  "fixtures",
  "document.pdf",
);

describe("UnpdfExtractionProvider", () => {
  it("extracts the text layer from a digital PDF", async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const text = await new UnpdfExtractionProvider().extractText(bytes);
    expect(text.toLowerCase()).toContain("lorem ipsum");
    expect(text.length).toBeGreaterThan(100);
  });
});
