import type { ImageEmbeddingProvider } from "@agentbe/index-sync";

export interface ClipImageEmbeddingOptions {
  /** Transformers.js CLIP model id. Default "Xenova/clip-vit-base-patch32". */
  model?: string;
  /** Output dimensions (must match the model). Default 512. */
  dimensions?: number;
}

interface ClipModels {
  processor: (image: unknown) => Promise<unknown>;
  visionModel: (inputs: unknown) => Promise<{ image_embeds: { tolist(): number[][] } }>;
  tokenizer: (texts: string[], options: unknown) => unknown;
  textModel: (inputs: unknown) => Promise<{ text_embeds: { tolist(): number[][] } }>;
  RawImage: { fromBlob(blob: Blob): Promise<unknown> };
}

function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum);
  return n === 0 ? v : v.map((x) => x / n);
}

/**
 * Local CLIP image + text embeddings via Transformers.js — images and text land
 * in one shared 512-dim space, so text queries retrieve images. Offline, no key.
 * `@huggingface/transformers` is an optional peer, loaded lazily; the model
 * downloads once and caches. Default `clip-vit-base-patch32`.
 */
export class ClipImageEmbeddingProvider implements ImageEmbeddingProvider {
  readonly dimensions: number;
  private readonly model: string;
  private models?: Promise<ClipModels>;

  constructor(options: ClipImageEmbeddingOptions = {}) {
    this.model = options.model ?? "Xenova/clip-vit-base-patch32";
    this.dimensions = options.dimensions ?? 512;
  }

  private load(): Promise<ClipModels> {
    if (!this.models) {
      this.models = (async () => {
        const specifier = "@huggingface/transformers";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let mod: any;
        try {
          mod = await import(specifier);
        } catch (err) {
          throw new Error(
            "ClipImageEmbeddingProvider requires the optional peer '@huggingface/transformers'. " +
              `Install it. Cause: ${(err as Error).message}`,
          );
        }
        const [processor, visionModel, tokenizer, textModel] = await Promise.all([
          mod.AutoProcessor.from_pretrained(this.model),
          mod.CLIPVisionModelWithProjection.from_pretrained(this.model),
          mod.AutoTokenizer.from_pretrained(this.model),
          mod.CLIPTextModelWithProjection.from_pretrained(this.model),
        ]);
        return { processor, visionModel, tokenizer, textModel, RawImage: mod.RawImage } as ClipModels;
      })();
    }
    return this.models;
  }

  async embedImages(images: Uint8Array[]): Promise<number[][]> {
    if (images.length === 0) return [];
    const { processor, visionModel, RawImage } = await this.load();
    const out: number[][] = [];
    for (const bytes of images) {
      const image = await RawImage.fromBlob(new Blob([bytes]));
      const inputs = await processor(image);
      const { image_embeds } = await visionModel(inputs);
      out.push(normalize(image_embeds.tolist()[0]!));
    }
    return out;
  }

  async embedText(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const { tokenizer, textModel } = await this.load();
    const inputs = tokenizer(texts, { padding: true, truncation: true });
    const { text_embeds } = await textModel(inputs);
    return text_embeds.tolist().map(normalize);
  }
}
