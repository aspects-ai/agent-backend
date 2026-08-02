import {
  HashingEmbeddingProvider,
  type EmbeddingProvider,
  type ImageEmbeddingProvider,
} from "@agentbe/index-sync";

import { ClipImageEmbeddingProvider } from "./clip.js";
import { LocalEmbeddingProvider } from "./local.js";
import { OllamaEmbeddingProvider } from "./ollama.js";
import { OpenAIEmbeddingProvider } from "./openai.js";

export type EmbedderKind = "local" | "openai" | "ollama" | "hash";

export interface EmbedderConfig {
  /** Which provider. Default "local". */
  kind?: EmbedderKind;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
}

/** Select an {@link EmbeddingProvider} by config — the easy plug-in surface for
 * apps/CLIs (e.g. driven by an `AGENTBE_EMBEDDER` env var). Programmatic callers
 * can also just construct a provider (or their own) directly. */
export function createEmbeddingProvider(config: EmbedderConfig = {}): EmbeddingProvider {
  const kind = config.kind ?? "local";
  switch (kind) {
    case "local":
      return new LocalEmbeddingProvider({ model: config.model, dimensions: config.dimensions });
    case "openai":
      return new OpenAIEmbeddingProvider({
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        dimensions: config.dimensions,
      });
    case "ollama":
      return new OllamaEmbeddingProvider({
        model: config.model,
        baseUrl: config.baseUrl,
        dimensions: config.dimensions,
      });
    case "hash":
      return new HashingEmbeddingProvider(config.dimensions);
    default:
      throw new Error(`unknown embedder kind: ${String(kind)}`);
  }
}

export type ImageEmbedderKind = "clip";

export interface ImageEmbedderConfig {
  /** Which image provider. Default "clip". */
  kind?: ImageEmbedderKind;
  model?: string;
  dimensions?: number;
}

/** Select an {@link ImageEmbeddingProvider} by config (default local CLIP). */
export function createImageEmbeddingProvider(
  config: ImageEmbedderConfig = {},
): ImageEmbeddingProvider {
  const kind = config.kind ?? "clip";
  switch (kind) {
    case "clip":
      return new ClipImageEmbeddingProvider({ model: config.model, dimensions: config.dimensions });
    default:
      throw new Error(`unknown image embedder kind: ${String(kind)}`);
  }
}
