# @agentbe/embeddings

> Pluggable `EmbeddingProvider` / `ImageEmbeddingProvider` adapters for [`@agentbe/index-sync`](../index-sync) — local (Transformers.js), OpenAI, Ollama, and CLIP.

The interfaces themselves (`EmbeddingProvider`, `ImageEmbeddingProvider`) live in `@agentbe/index-sync`; this package is just implementations of them, so the room can swap embedders without touching `IndexSync`/`ImageIndexSync`.

## Providers

| Provider | Space | Default model | Needs |
|---|---|---|---|
| `LocalEmbeddingProvider` | text, 384-dim | `Xenova/all-MiniLM-L6-v2` | `@huggingface/transformers` (optional peer), offline after first download |
| `OpenAIEmbeddingProvider` | text, 1536-dim | `text-embedding-3-small` | `OPENAI_API_KEY` (or `apiKey`) |
| `OllamaEmbeddingProvider` | text, 768-dim | `nomic-embed-text` | a local Ollama server (`OLLAMA_HOST`, default `http://localhost:11434`) |
| `ClipImageEmbeddingProvider` | image + text, 512-dim, shared space | `Xenova/clip-vit-base-patch32` | `@huggingface/transformers` (optional peer) |

`LocalEmbeddingProvider` and `ClipImageEmbeddingProvider` load `@huggingface/transformers` lazily on first `embed`/`embedImages` call and throw a clear error if it isn't installed — install it yourself (`npm i @huggingface/transformers`) to use them. Model weights download once and cache.

## Usage

```typescript
import { LocalEmbeddingProvider, OpenAIEmbeddingProvider, ClipImageEmbeddingProvider } from "@agentbe/embeddings";
import { IndexSync } from "@agentbe/index-sync";

const embedder = new LocalEmbeddingProvider();
const indexSync = new IndexSync(blobs, rooms, embedder, vectorStore);
```

```typescript
const embedder = new OpenAIEmbeddingProvider({ model: "text-embedding-3-large", dimensions: 3072 });
```

Images and text share one CLIP space, so a text query retrieves images:

```typescript
const clip = new ClipImageEmbeddingProvider();
const [imageVector] = await clip.embedImages([pngBytes]);
const [textVector] = await clip.embedText(["a photo of a cat"]);
```

### Selecting by config

`createEmbeddingProvider`/`createImageEmbeddingProvider` pick a provider from a config object (e.g. driven by an env var like `AGENTBE_EMBEDDER`) instead of importing a class directly:

```typescript
import { createEmbeddingProvider } from "@agentbe/embeddings";

const embedder = createEmbeddingProvider({ kind: "openai", apiKey: process.env.OPENAI_API_KEY });
```

`kind` is `"local" | "openai" | "ollama" | "hash"` — `"hash"` returns `@agentbe/index-sync`'s dependency-free `HashingEmbeddingProvider`, useful as a zero-setup fallback. `createImageEmbeddingProvider` supports `kind: "clip"` (the only option today).

## Tests

```bash
pnpm test:run          # unit tests — factory wiring, OpenAI/Ollama request shape (fetch mocked)
pnpm test:integration   # real models — downloads MiniLM/CLIP on first run, no network calls beyond that
```
