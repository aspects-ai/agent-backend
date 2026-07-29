# @agentbe/vector-pg

> pgvector-backed, persistent `VectorStore` for [`@agentbe/index-sync`](../index-sync) — durable, ANN-indexed vector search in place of the in-memory reference store.

Implements index-sync's `VectorStore` interface, so it drops straight into `IndexSync`/`ImageIndexSync` in place of `InMemoryVectorStore`. See [room-deployment.md](../../docs/room-deployment.md#storage-tiers) for when to use it in a deployed room (`AGENTBE_VECTOR=pg`) — without a persistent index the room re-embeds the entire corpus on every restart.

## `PgVectorStore`

```typescript
import { Pool } from "pg";
import { PgVectorStore } from "@agentbe/vector-pg";
import { IndexSync } from "@agentbe/index-sync";

const pool = new Pool({ connectionString: process.env.AGENTBE_PG_URL });
const textStore = new PgVectorStore(pool, { dimensions: 384 });
const indexSync = new IndexSync(blobStore, roomStore, embedder, textStore);
```

Takes any structural `PgQueryable` (just needs a `query(text, params)` method) rather than a hard dependency on `pg` — pass a `pg.Pool` or `Client`.

`dimensions` must match the embedder and is required — pgvector columns are fixed-dimension. Use a separate store (or `namespace`) per embedding space, e.g. 384-dim text vs. 512-dim CLIP images:

```typescript
const imageStore = new PgVectorStore(pool, { dimensions: 512, namespace: "images" });
```

`namespace` (default `"agentbe"`) prefixes the two tables this store manages: `<namespace>_embeddings` (hash → vector, content-addressed) and `<namespace>_records` (room, path → hash). Tables, the `vector` extension, and an HNSW cosine index are created lazily on first use — no migration step required. `query` ranks a room's records by cosine distance (`<=>`).

## Tests

```bash
pnpm test:run          # unit tests, mocked PgQueryable
pnpm test:integration   # needs a live Postgres with pgvector — AGENTBE_PG_URL (default postgresql://postgres:test@localhost:5433/agentbe)
```

The integration suite runs `@agentbe/index-sync`'s shared `vector-conformance` suite against a real `PgVectorStore`, proving it behaves like `InMemoryVectorStore`.
