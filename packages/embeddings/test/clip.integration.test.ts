import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ClipImageEmbeddingProvider } from "../src/index.js";

// Requires @huggingface/transformers + a one-time CLIP model download.
const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "versioned-store",
  "test",
  "fixtures",
);

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are L2-normalized
}

describe("ClipImageEmbeddingProvider (real model)", () => {
  it("embeds image + text in one space; the matching caption scores higher", async () => {
    const clip = new ClipImageEmbeddingProvider();
    const logo = new Uint8Array(readFileSync(path.join(FIXTURES, "logo.png"))); // Python logo

    const [imageVec] = await clip.embedImages([logo]);
    expect(imageVec?.length).toBe(512);

    const [pythonCaption, kittenCaption] = await clip.embedText([
      "the Python programming language logo",
      "a photograph of a fluffy kitten",
    ]);
    // The Python logo must match "python logo" more than "fluffy kitten".
    expect(cosine(imageVec!, pythonCaption!)).toBeGreaterThan(cosine(imageVec!, kittenCaption!));
  });
});
