/**
 * @agentbe/embeddings
 *
 * Pluggable {@link EmbeddingProvider} adapters for @agentbe/index-sync. The
 * interface itself is the plug-in surface — implement it (or pick one of these)
 * and pass it to the index/room. Local (Transformers.js) is the offline,
 * no-key default; OpenAI/Ollama cover hosted and local-server setups.
 */

export { LocalEmbeddingProvider } from "./local.js";
export type { LocalEmbeddingOptions } from "./local.js";
export { OpenAIEmbeddingProvider } from "./openai.js";
export type { OpenAIEmbeddingOptions } from "./openai.js";
export { OllamaEmbeddingProvider } from "./ollama.js";
export type { OllamaEmbeddingOptions } from "./ollama.js";
export { ClipImageEmbeddingProvider } from "./clip.js";
export type { ClipImageEmbeddingOptions } from "./clip.js";
export { createEmbeddingProvider, createImageEmbeddingProvider } from "./factory.js";
export type {
  EmbedderKind,
  EmbedderConfig,
  ImageEmbedderKind,
  ImageEmbedderConfig,
} from "./factory.js";
