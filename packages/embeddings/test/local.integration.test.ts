import { describe, expect, it } from "vitest";

import { LocalEmbeddingProvider } from "../src/index.js";

// Requires @huggingface/transformers + a one-time model download (all-MiniLM).
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe("LocalEmbeddingProvider (real model)", () => {
  it("produces 384-dim vectors that capture meaning, not just keywords", async () => {
    const provider = new LocalEmbeddingProvider();
    const [query, related, unrelated] = await provider.embed([
      "reasons a user abandons a product",
      "customer churn and subscription retention",
      "baking sourdough bread in a hot oven",
    ]);

    expect(query?.length).toBe(384);
    // "churn/retention" shares almost no words with the query, yet must rank
    // above the lexically-and-semantically unrelated baking sentence.
    expect(cosine(query!, related!)).toBeGreaterThan(cosine(query!, unrelated!));
  });
});
