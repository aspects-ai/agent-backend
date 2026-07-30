# Agent Document Room

A multiplayer, versioned, semantically-searchable, multimodal document store
with a sandbox attached. A corpus of documents (text, images, PDFs) lives in a
shared **room**; agents search across it, check out a working subset into a
POSIX sandbox, run shell/code against it, and commit changes back as a new
version. Exposed to agents as an MCP server.

`RoomService` depends on a `RoomCatalog`, not on manifests. The bundled
`ManifestRoomCatalog` is the zero-database default for bounded, writable
personal/team workspaces. Organization-scale deployments can supply a
database-backed catalog with paginated listing, change-log/outbox indexing,
and selective or lazy sandbox materialization; such catalogs are read-only in
the sandbox unless they explicitly implement workspace commits. In both
constructor forms, `RoomService` always operates through a catalog; when the
legacy `blobs`/`rooms`/`embedder` dependencies are supplied, it constructs the
manifest adapter internally. See
[Room Catalog Adapters](../docs/room-catalogs.md) for wiring examples, the
adapter contract, Postgres responsibilities, access control, and migration
guidance.

For the concepts (seams, manifest model, isolation) see
[docs/room-architecture.md](../docs/room-architecture.md). For running it in
production (storage tiers, sandbox providers, the full env var reference) see
[docs/room-deployment.md](../docs/room-deployment.md).

## Quick start

```bash
make demo             # boot a room's MCP server over HTTP :8848, seeded with sample data
make demo-test        # verify it end to end over a real MCP connection
```

See [room/examples/demo-room/README.md](examples/demo-room/README.md) for what
this boots and how to drive it from an MCP client. For multiple isolated rooms
on one host, see [room/examples/multi-room/README.md](examples/multi-room/README.md);
for Kubernetes with sandbox-per-session pods, see
[room/examples/k8s/README.md](examples/k8s/README.md).

## MCP tool surface

| Tool | Purpose |
|---|---|
| `search` | Semantic search over the room. `modality: "text" \| "image" \| "all"` — text queries match images via CLIP. |
| `list_documents` | List a bounded page of document paths in the room (`cursor`/`limit`). |
| `read_document` | Read a document's text contents by path. |
| `run_command` | Run a shell command over a sandbox checkout. One-shot (optionally scoped to `paths`) or against a warm `session`. |
| `open_session` | Open a warm sandbox session. Scoped (`paths`) sessions are read-only; full sessions are writable only when the catalog supports workspace commits. |
| `write_file` | Write a file into a warm session's workspace. |
| `commit_session` | Commit a warm session when its catalog supports workspace commits. |
| `close_session` | Close a warm session and release its sandbox. |
| `put_document` | Add or update a document when its catalog supports direct ingestion. |

Attribution (`put_document`, `commit_session`) is derived from the
authenticated identity, never a caller-supplied argument — see
[room-architecture.md's isolation model](../docs/room-architecture.md#isolation-model).

See [room/src/mcp/server.ts](src/mcp/server.ts) for exact parameters.
