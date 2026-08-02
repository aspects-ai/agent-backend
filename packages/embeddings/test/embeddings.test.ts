import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocalEmbeddingProvider,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  createEmbeddingProvider,
} from "../src/index.js";

describe("embedding providers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("the hash provider works with no dependencies", async () => {
    const provider = createEmbeddingProvider({ kind: "hash" });
    const [vector] = await provider.embed(["hello world"]);
    expect(vector?.length).toBe(provider.dimensions);
  });

  it("the factory selects the right provider by kind", () => {
    expect(createEmbeddingProvider({ kind: "local" })).toBeInstanceOf(LocalEmbeddingProvider);
    expect(createEmbeddingProvider({ kind: "openai", apiKey: "k" })).toBeInstanceOf(
      OpenAIEmbeddingProvider,
    );
    expect(createEmbeddingProvider({ kind: "ollama" })).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it("OpenAI provider calls the embeddings endpoint and maps vectors", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }, { embedding: [4, 5, 6] }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await new OpenAIEmbeddingProvider({ apiKey: "k" }).embed(["a", "b"]);
    expect(out).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/embeddings");
  });

  it("Ollama provider calls /api/embed", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ embeddings: [[1, 2]] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await new OllamaEmbeddingProvider().embed(["x"]);
    expect(out).toEqual([[1, 2]]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/embed");
  });

  it("constructs the local provider with expected defaults", () => {
    const provider = new LocalEmbeddingProvider();
    expect(provider.dimensions).toBe(384); // all-MiniLM-L6-v2
  });
});
