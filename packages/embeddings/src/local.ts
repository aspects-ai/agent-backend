import type { EmbeddingProvider } from "@agentbe/index-sync";

export interface LocalEmbeddingOptions {
  /** Transformers.js model id. Default "Xenova/all-MiniLM-L6-v2" (384-dim). */
  model?: string;
  /** Quantization for a smaller download/footprint. Default "q8". */
  dtype?: "fp32" | "fp16" | "q8" | "q4";
  /** Output dimensions (must match the model). Default 384. */
  dimensions?: number;
}

type Extractor = (
  texts: string[],
  options: { pooling: string; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * Local, in-process embeddings via Transformers.js — no API key, offline, and
 * private (text never leaves the machine, which matters for a document room).
 * `@huggingface/transformers` is an **optional peer dependency**, loaded lazily
 * on first use; the model weights download once and cache. Default model is
 * all-MiniLM-L6-v2 (384-dim, quantized) — a small, fast out-of-the-box default;
 * point `model` at a stronger model for production.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly model: string;
  private readonly dtype: string;
  private extractor?: Promise<Extractor>;

  constructor(options: LocalEmbeddingOptions = {}) {
    this.model = options.model ?? "Xenova/all-MiniLM-L6-v2";
    this.dtype = options.dtype ?? "q8";
    this.dimensions = options.dimensions ?? 384;
  }

  private load(): Promise<Extractor> {
    if (!this.extractor) {
      this.extractor = (async () => {
        // Variable specifier keeps @huggingface/transformers optional (not
        // resolved at compile time; loaded only when the local provider is used).
        const specifier = "@huggingface/transformers";
        let mod: { pipeline?: unknown };
        try {
          mod = (await import(specifier)) as { pipeline?: unknown };
        } catch (err) {
          throw new Error(
            "LocalEmbeddingProvider requires the optional peer '@huggingface/transformers'. " +
              `Install it (e.g. \`npm i @huggingface/transformers\`). Cause: ${(err as Error).message}`,
          );
        }
        const pipeline = mod.pipeline as (
          task: string,
          model: string,
          options: { dtype: string },
        ) => Promise<Extractor>;
        return pipeline("feature-extraction", this.model, { dtype: this.dtype });
      })();
    }
    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  }
}
