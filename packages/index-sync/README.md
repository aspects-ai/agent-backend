# @agentbe/index-sync

> Keeps a semantic index in step with a [`@agentbe/versioned-store`](../versioned-store) room. Defines the `EmbeddingProvider`/`VectorStore` plug-in surface; bring your own model and vector DB.

Embeddings are content-addressed by blob hash — identical content is embedded once and reused across paths, rooms, and repeated syncs. The index is derived and rebuildable, never the source of truth; see [room-architecture.md](../../docs/room-architecture.md) for how this fits into the room's six seams.

## Interfaces

- `EmbeddingProvider` — `embed(texts): Promise<number[][]>` plus `dimensions`. Implemented by [`@agentbe/embeddings`](../embeddings) (local/OpenAI/Ollama); `HashingEmbeddingProvider` here is a dependency-free lexical fallback (signed feature hashing — cosine similarity reflects token overlap).
- `ImageEmbeddingProvider` — `embedImages(images)` and `embedText(texts)` into one shared space, so a text query retrieves images. Implemented by `@agentbe/embeddings`'s `ClipImageEmbeddingProvider`.
- `VectorStore` — storage for embeddings (keyed by content hash) and per-room path records (`upsertRecords`/`deleteRecords`/`clearRoom`/`query`). `InMemoryVectorStore` is the in-process reference implementation; [`@agentbe/vector-pg`](../vector-pg) is the persistent adapter.

## `IndexSync`

Syncs a room's text-embeddable files (`isEmbeddablePath` — markdown, txt, csv, json, yaml, xml, html, etc. by default; override with `isEmbeddable`) into a `VectorStore`.

```typescript
import { IndexSync, InMemoryVectorStore } from "@agentbe/index-sync";
import { LocalEmbeddingProvider } from "@agentbe/embeddings";

const indexSync = new IndexSync(blobStore, roomStore, new LocalEmbeddingProvider(), new InMemoryVectorStore());

await indexSync.sync("my-room", headRef);              // full (re)index at a ref
await indexSync.syncDiff("my-room", fromRef, toRef);    // incremental — only changed paths
const hits = await indexSync.query("my-room", "onboarding checklist", 5);
```

`query` returns `{ path, hash, score }[]`, ranked by cosine similarity — feed `path`s straight into a checkout.

## `ImageIndexSync`

Mirrors `IndexSync` for images (`isImagePath`): embeds image files via an `ImageEmbeddingProvider` and embeds text queries into the same space to retrieve them. Same `sync`/`syncDiff`/`query` shape. Use a **separate** `VectorStore` from the text index — image and text spaces have different dimensions and aren't comparable.

```typescript
import { ImageIndexSync, InMemoryVectorStore } from "@agentbe/index-sync";
import { ClipImageEmbeddingProvider } from "@agentbe/embeddings";

const imageIndexSync = new ImageIndexSync(blobStore, roomStore, new ClipImageEmbeddingProvider(), new InMemoryVectorStore());
```

## Tests

```bash
pnpm test:run
```

Unit tests only — `InMemoryVectorStore`, `IndexSync`/`ImageIndexSync` diffing logic, and `isEmbeddablePath`/`isImagePath`. `test/support/vector-conformance.ts` is a shared behavioral suite any `VectorStore` implementation can run against (used by `@agentbe/vector-pg`'s integration tests to prove parity with `InMemoryVectorStore`).
