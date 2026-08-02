import type { EmbeddingProvider } from "@agentbe/index-sync";

export interface OllamaEmbeddingOptions {
  model?: string;
  baseUrl?: string;
  dimensions?: number;
}

/** Embeddings from a local Ollama server (`/api/embed`). Near-zero dependency —
 * just requires Ollama running. Default model nomic-embed-text (768-dim). */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OllamaEmbeddingOptions = {}) {
    this.model = options.model ?? "nomic-embed-text";
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
    this.dimensions = options.dimensions ?? 768;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embeddings failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { embeddings: number[][] };
    return json.embeddings;
  }
}
