import type { EmbeddingProvider } from "@agentbe/index-sync";

export interface OpenAIEmbeddingOptions {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

/** OpenAI embeddings via the REST API (no SDK dependency). Default
 * text-embedding-3-small (1536-dim). Needs `OPENAI_API_KEY` or an explicit key. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OpenAIEmbeddingOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? "text-embedding-3-small";
    this.dimensions = options.dimensions ?? 1536;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.apiKey) {
      throw new Error("OpenAIEmbeddingProvider: missing API key (set OPENAI_API_KEY or pass apiKey).");
    }
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map((d) => d.embedding);
  }
}
