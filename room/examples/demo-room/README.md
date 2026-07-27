# Demo room — the way to run a room to play with

The single, unified way to spin up an agent document room, seeded with the shared
example dataset and backed by the **real embedders**: MiniLM for text and CLIP for
images (Transformers.js, offline, no API key), plus PDF text extraction. The
automated test suite uses a faster hashing embedder, so this is where you exercise
the real semantic path by hand through an MCP client.

**Zero infrastructure by default** — the search index lives in memory and is
rebuilt on boot from the persistent on-disk store, so no database is required. Add
`--pg` to back it with a persistent pgvector index instead (starts a Docker
container) when you want to exercise or test that path.

## What's here

- **Dataset** — seeds from `room/testdata/`, the **single shared corpus for the
  app** (the same data the room test suite and the bin's default seed use). It's
  multimodal: contract text, customer-research notes, a roadmap, a CSV for
  analysis, two images (`assets/logo.png`, `assets/photo.jpg`), and a PDF
  (`docs/sample.pdf`). Nothing is duplicated here.
- `run.sh` — the launcher: builds the room if needed and serves it over MCP with
  `AGENTBE_EMBEDDER=local` + `AGENTBE_IMAGE_EMBEDDER=clip`. `--pg` adds the
  persistent pgvector index (and manages its container).
- `smoke.mjs` — drives the running room over a real stdio MCP connection and
  asserts semantic text ranking, cross-modal (text→image) ranking, PDF-derived
  text search, and sandboxed `run_command`. A manual end-to-end check.
- `.data/` — the persistent blob + manifest store, gitignored.

## Prerequisites

- The workspace installed (`pnpm install`). First launch downloads the MiniLM +
  CLIP models (a few seconds to a minute), cached thereafter.
- Docker — **only** if you use `--pg`.

## Run it

From the repo root, the one-liners:

```bash
make demo             # boot the room's MCP server over HTTP :8848 (in-memory)
make demo-test        # verify it end to end over a real MCP connection
make demo PG=1        # ...backed by a persistent pgvector index (needs Docker)
make demo-test PG=1
```

That's the recommended entry point. Under the hood it calls `run.sh` / `smoke.mjs`,
which you can also invoke directly for finer control:

```bash
# stdio, in-memory index (no Docker) — how an MCP client like Claude Code connects
room/examples/demo-room/run.sh

# serve over HTTP on :8848/mcp (or --http=PORT)
room/examples/demo-room/run.sh --http

# persistent pgvector index instead of in-memory (starts a Docker container)
room/examples/demo-room/run.sh --pg

# start fresh: wipe this room's data, then re-seed from the dataset
room/examples/demo-room/run.sh --reset
```

The on-disk store persists, so committed documents survive a restart either way.
With `--pg` the search index also persists (reused on boot, no re-embedding);
without it, the index is rebuilt in memory from the store on each launch.

## Verify end to end

```bash
make demo-test            # in-memory
make demo-test PG=1        # persistent pgvector

# or directly:
node room/examples/demo-room/smoke.mjs --reset
node room/examples/demo-room/smoke.mjs --pg --reset
```

Expected: natural-language text queries each rank the topically-correct document
first (e.g. *"why do teams stop using the product and cancel"* →
`research/customer-interviews-q1.md`), a text→image query ranks the Python logo
above the unrelated photo (CLIP), the PDF's derived `.pdf.txt` is present, and a
`run_command` counts rows of the CSV inside a sandbox — the whole **search →
checkout → exec** loop over real text + image embeddings.

## Drive it from an MCP client

The repo's `.mcp.json` already wires this up as the `agentbe-room` server
(`bash room/examples/demo-room/run.sh`), so Claude Code connects to it directly.
To use `--pg`, add the flag to that entry's `args`. Then try tools like:

- `search` (text) — `{ "query": "how is the Globex engagement billed", "k": 3, "modality": "text" }`
- `search` (image) — `{ "query": "the Python programming language logo", "modality": "image" }`
- `read_document` — `{ "path": "contracts/globex-sow.md" }`
- `run_command` — `{ "command": "wc -l data/ag_exports.csv", "paths": ["data/ag_exports.csv"] }`
- `open_session` / `write_file` / `commit_session` — the read-write editing loop.

## Notes / caveats

- `run_command` runs **unsandboxed** here (`LocalWorkspaceProvider`,
  isolation:none) — fine for a trusted local demo; the real isolation boundary is
  the Docker/k8s sandbox provider.
- The index is model-specific. Switching `AGENTBE_EMBEDDER` /
  `AGENTBE_IMAGE_EMBEDDER` invalidates a persisted (`--pg`) index — re-run with
  `--reset`.
- With `--pg`, the bin uses fixed pgvector namespaces `text` / `image`; `--reset`
  drops those tables. Don't point it at a database you care about.
