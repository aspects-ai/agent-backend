import { createHash } from "node:crypto";

/** Turns text into a fixed-dimension vector. Bring your own model, or use the
 * dependency-free {@link HashingEmbeddingProvider} default. */
export interface EmbeddingProvider {
  readonly dimensions: number;
  /** Embed a batch of texts, preserving order. */
  embed(texts: string[]): Promise<number[][]>;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/**
 * Deterministic, dependency-free lexical embedder via signed feature hashing.
 * Cosine similarity between two vectors reflects their token overlap — enough
 * for a real lexical default and for reproducible tests, with no external model.
 * Swap in a semantic model by implementing {@link EmbeddingProvider}.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  constructor(readonly dimensions = 256) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorize(text));
  }

  private vectorize(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    for (const token of tokenize(text)) {
      const digest = createHash("sha1").update(token).digest();
      const bucket = digest.readUInt32BE(0) % this.dimensions;
      const sign = (digest[4]! & 1) === 1 ? 1 : -1;
      v[bucket]! += sign;
    }
    return l2normalize(v);
  }
}
