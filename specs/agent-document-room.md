# Agent Document Room — Working Spec

> **Status:** Working spec (temporary). Living document tracking the build-out of the agent document room on top of `agent-backend`. Not an OpenSDD behavioral contract — the room is deliberately spec-lite. Supersede/delete once the plan is stable and the durable pieces graduate to `docs/`.
>
> **Last updated:** 2026-07-22 · **Owner:** danny

## 1. Goal

A multiplayer, versioned, semantically-searchable, multimodal document room for agents. Put a corpus of documents (text + image, later audio/video) into a shared room where each document is versioned; discover across it with semantic search; and pull individual documents into a POSIX sandbox to run code / shell against them. The read/search corpus and the execution surface are unified for the agent (one logical corpus, a search tool + a shell), even though they are distinct systems underneath.

### Driving use cases

- **A. Contract corpus (read-heavy).** A few GB of contracts + tabular files (Excel/CSV) shared among a couple of people. Q&A + analysis, e.g. "total transaction value paid to vendor X last year" — semantic search to find relevant docs, then CLI/code to parse spreadsheets. Read-only; no write concerns.
- **B. Research workspace (read-write) — the motivating current case.** A team's shared store of customer-conversation transcripts, ad-hoc research, and AI-generated notes. Today it's a Git repo agents pull/publish to, which forces everyone to run agents locally. We want to decouple execution from the laptop: the working tree + shell live server-side, shared.

## 2. Architecture

Six concerns, kept as separate seams. The room product is the orchestrator that composes them; nothing but the orchestrator knows about all six.

```
        ingestion (OCR / transcription / table extraction)
                     │  raw asset + derived text/artifacts
                     ▼
   ┌─────────────────────────────┐        ┌──────────────────┐
   │  Canonical store (S3)       │  hash  │  Search index     │
   │  content-addressed blobs    │───────▶│  semantic+lexical │
   │  + versioned manifests      │        │  keyed by hash    │
   │  + HEAD (CAS)               │        └──────────────────┘
   └───────────┬─────────────────┘                 ▲
     checkout  │  ▲ commit-back                     │ query
     (subset)  ▼  │                                 │ (room-scoped)
   ┌─────────────────────────────┐                 │
   │  Ephemeral workspace         │  ◀──────────────┘
   │  = agent-backend Backend     │   agent: search → checkout → exec → commit
   │  POSIX FS + shell + MCP/SSH  │
   └─────────────────────────────┘
```

**The agent loop:**
1. Query the index → paths / blob-hashes (index is a service, not in the sandbox).
2. Ensure those paths are materialized → partial checkout into an agent-backend working tree.
3. Run shell / code against the working set.
4. `commit-back` → diff tree vs base manifest, upload new blobs, write manifest, CAS-advance HEAD.
5. On CAS conflict → per-file LWW resolve + retry.
6. Post-commit → re-index changed paths (keyed by blob hash → no rework on unchanged blobs).

## 3. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Store | **S3, content-addressed** | Multimodal-native, dedupe-for-free, ceiling is file *count* not bytes |
| Version model | **Manifest-on-S3** (path→hash snapshot), not Git | LWW + per-task commits deleted Git's main value (3-way merge) while keeping its binary/file-count liabilities |
| Sandbox | **Checkout model** (materialize subset → agent-backend) | POSIX-on-object-storage not yet mature enough; Git-style working tree is the proven primitive |
| CAS primitive | **S3 + small DB** (Dynamo/Postgres) holds HEAD + manifest history; S3 conditional-write is the DB-free fallback | Atomic HEAD advance without a lock service |
| Workspace lifetime | **Ephemeral per task** now; long-lived later | Minimizes conflict window; commit-back is the only way state becomes real |
| Commits | **Per task** | Each manifest is a revert target |
| Merge | **Per-file last-writer-wins** now; grow into 3-way merge later from retained manifests | Multiplayer isn't hot yet; not a one-way door |
| Access control | **Room-level only** (maps to `agent-backend` `.scope()`); granular ACL deferred | AC is a later nice-to-have |
| Derived text | **Committed as real files** (raw media stays a blob; embeddings are index-side only) | The shell must be able to `grep`/parse extracted text |
| Language | agent-backend keeps Python + TS; **everything new is TS-only** | — |

## 4. Monorepo layout & firewall

Package-first (apps at root, libs under `packages/`; convention from `aspects-apps`). `agent-backend` is a library, so it is a peer under `packages/`, not special.

```
packages/
  agent-backend/     typescript/ python/ opensdd/    # substrate lib (dual-language)
  versioned-store/   src/ ...                         # TS-only, the linchpin
  index-sync/        src/ ...                          # TS-only
  ingestion/         (adapters; later)
agentbe-daemon/      # deploy peer: Docker + deploy-tool, bundles agent-backend
room/                # the app (Next.js), root peer
docs/  specs/  Makefile ...
```

**Firewall rules (load-bearing):**
- `agent-backend` keeps its own README/pitch/release and a **dependency-light graph** — no S3/vector/model SDKs leak in. Those live only in the new packages.
- `opensdd/` governs **only** agent-backend and stays scoped inside its package. The room and other new packages are spec-lite (this doc), no OpenSDD.
- Consumption model, not licensing: ship a Papermark-style deployable `room` app **and** importable libs from one monorepo.

## 5. Package plan

### 5.1 `packages/agent-backend` — substrate ✓ (exists)
The execution/sandbox plane and part of store durability. Provides the `FileBasedBackend` (`exec/read/write/readdir/stat/scope`) + daemon (MCP/SSH over POSIX). Consumed by `versioned-store` as the `WorkingTree`. No changes needed for the room beyond being a stable dependency.

### 5.2 `packages/versioned-store` — the linchpin (core ✓, S3 adapters TODO)
Content-addressed store + checkout/commit-back. The `WorkingTree` surface is the **entire** coupling to agent-backend (its `FileBasedBackend` satisfies it structurally).

**Done (in-memory-backed, unit-tested — 7 green):**
- ✅ Interfaces + `Manifest` schema (`BlobStore`, `RoomStore`, `VersionedStore`, `WorkingTree`).
- ✅ **`DefaultVersionedStore`** — backend-agnostic `checkout` (incl. `paths`-subset partial checkout) and `commit`.
- ✅ **Per-file LWW + CAS retry** — merge against concurrent HEAD (touched paths win, non-overlap preserved, deletes propagate), bounded retry, `conflict` only if it can't converge.
- ✅ sha-256 content addressing + deterministic content-addressed manifest refs; tree walk; dedupe.
- ✅ `InMemoryBlobStore` / `InMemoryRoomStore` / `InMemoryWorkingTree` (tests + local dev).

**Done — S3 adapters (verified end-to-end against LocalStack):**
- ✅ **`S3BlobStore`** — content-hash keys (`<prefix>blobs/<hash>`), `hasBlob` HEAD-check dedupe, streaming get. Adds `@aws-sdk/client-s3`.
- ✅ **`S3RoomStore`** — manifests as S3 objects; HEAD via **conditional write** (`If-None-Match` for first commit, `If-Match` on read-ETag thereafter) for optimistic CAS. **Confirmed LocalStack honors both conditions** — DB-backed variant not needed for now.
- ✅ **Integration tests** (`test:integration`, gated by config; not in the default unit run) against LocalStack — **9 green**: the two CAS-conflict probes + byte-exact round-trips of **real multimodal/tabular fixtures** (JPEG, PNG, two PDFs, CSV) incl. a mixed-tree commit/checkout, dedupe, and partial checkout of a single binary. Fixtures committed under `test/fixtures/` (~180 KB).

**Test harness:** `test:run`/`test:unit` = fast in-memory (7 tests). `test:integration` = LocalStack (`docker run -d -p 4566:4566 -e SERVICES=s3 localstack/localstack:3`), endpoint overridable via `AGENTBE_S3_ENDPOINT`.

**Open impl questions:** blob chunking threshold for very large files; manifest size limits for huge rooms (paginate / tree-of-manifests?); GC of unreferenced blobs.

### 5.3 `packages/index-sync` — search (✓ implemented + unit-tested, 4 green)
Keeps a semantic/lexical index in step with manifests; **derived and rebuildable**, keyed by blob hash so unchanged blobs are never re-embedded (across paths, rooms, and repeated syncs).

**Done:**
- ✅ `IndexSync.sync(room, ref)` (full reindex) + `syncDiff(room, fromRef, toRef)` (incremental add/change/delete) + room-scoped `query(room, text, k)`.
- ✅ **`EmbeddingProvider`** interface + **`HashingEmbeddingProvider`** — a dependency-free signed-feature-hashing lexical embedder (real default + deterministic test embedder; swap in a semantic model by implementing the interface).
- ✅ **`VectorStore`** interface + **`InMemoryVectorStore`** (content-addressed embeddings keyed by hash; per-room path→hash records; cosine top-k). BYO vector DB by implementing the interface.
- ✅ Embeddable-path filter (text extensions); binaries indexed via their committed derived-text siblings, never embedded directly.
- ✅ Runs **outside** the sandbox; room-scoped (no per-doc ACL yet); returns paths/hashes to feed into `checkout`.

**TODO / next:** real semantic embedding provider (e.g. Claude/OpenAI) + a real vector-store adapter (e.g. pgvector/Qdrant) behind the interfaces; media derived-text ingestion (see 5.4) so images/PDF/audio become searchable.

### 5.4 `packages/ingestion` — extraction adapters (later; optional plugins)
Per-asset pipeline turning raw media into searchable + shell-analyzable form. **Not core** — a set of swappable adapters.
- Adapters: OCR (images/PDF), transcription (audio/video), table extraction (Excel/CSV normalization).
- Output contract: raw asset stays a content-addressed blob; **derived text committed as a sibling file**; embedding handed to `index-sync`. Derived artifacts are rebuildable — history tracks the raw asset as canonical.

### 5.5 `room` — the app (root `room/`; service core ✓, API/UI/auth TODO)
The orchestrator + product surface. Service core folds in the `BackendWorkingTree` adapter (moved here from the deleted `integration` package) + the e2e loop test.

**Done — service core (`RoomService` / `RoomSession`), unit + S3-integration tested (6 unit + 1 integration green):**
- ✅ `putDocuments(room, files, author)` — full-checkout-of-HEAD then write then commit (never drops existing docs), auto-reindex.
- ✅ `search(room, query, k)` — semantic search over the room.
- ✅ `openSession(room, {paths?})` — provisions an ephemeral agent-backend workspace, checks out HEAD (full = read-write, `paths`-scoped = **read-only**, which enforces the partial-commit guard from §7), exposes `exec` + working tree + `commit(author)` (reindexes, chains base) + `close()`.
- ✅ **`WorkspaceProvider`** seam + **`LocalWorkspaceProvider`** (temp-dir `LocalFilesystemBackend`); a Docker/daemon provider is the production swap.
- ✅ The `BackendWorkingTree` adapter (agent-backend `Backend` → `WorkingTree`, byte-read fix) lives here.

**TODO:**
- ☐ **HTTP API** (Next.js) over `RoomService`: room CRUD, upload, search, session/exec/commit.
- ☐ **Agent loop wiring**: expose `search → checkout → exec → commit-back` as agent tools (MCP / AI-SDK).
- ☐ **Membership + room-level auth** (granular ACL deferred).
- ☐ **UI** + batteries-included deploy (`clone → configure S3 + vector store + model key → run`).
- ☐ Real embedding provider + vector-store adapter (currently `HashingEmbeddingProvider` + `InMemoryVectorStore`).

## 6. Build sequence

Dependency-first. Land each, verify, then proceed.
1. ✅ Monorepo restructure (done — commit `a1797f3`).
2. ✅ **`versioned-store`** — core + in-memory + unit tests, **and** S3 adapters verified end-to-end against LocalStack. The substrate is real.
3. ✅ **`index-sync`** (5.3) — sync/syncDiff/query + BYO embedder/vector-store, hash-keyed dedup, unit-tested (4 green).
3.5. ✅ **Integration hardening** (`packages/integration`) — `BackendWorkingTree` adapter (agent-backend `Backend` → `WorkingTree`) + full-loop e2e test: **search → checkout → exec → commit-back → reindex** over S3 + a real `LocalFilesystemBackend`, using real fixtures (CSV `wc -l` = use case A; PNG byte-fidelity). **Surfaced & fixed a real seam:** agent-backend `read()` defaults to a UTF-8 *string*, which would corrupt binaries in checkout/commit — the adapter forces byte reads. 2 integration + 3 unit tests green. Adapter kept out of agent-backend (no breaking spec change) and out of versioned-store (structural, no dependency).
4. **`room` app** (5.5) — ✅ **service core** (`RoomService`/`RoomSession` + `LocalWorkspaceProvider`) wiring store + index + agent-backend into the loop; unit + S3-integration tested. ☐ Remaining: HTTP API + agent-tool wiring + room-level auth + UI. **← next: the API/tools layer over the proven core.**
5. **`ingestion`** (5.4) — multimodal, added as the corpus demands it. (Also unblocks real search over binaries via derived text.)

## 7. Open questions / deferred

- **Granular (per-document) ACL** — needs the index to filter by identity; lives in the store. Deferred.
- **Long-lived / personal workspaces** — coherence of N durable checkouts. Deferred behind ephemeral.
- **Real 3-way merge** — when multiplayer heats up; grow from retained manifests.
- **Case A as a separate store** — the GB-scale read-only binary catalog may want a distinct read-only manifest-over-S3 surface rather than sharing the read-write room store. The seam between "git-/manifest-backed read-write rooms" and "read-only catalogs" may be the real product boundary. Revisit.
- **`versioned-store` published name** — `@agentbe/versioned-store` is a placeholder (`private: true`).
- **Pre-existing `ty` type backlog** (13 diagnostics in `agent-backend` python) — tracked separately from the room work.
- **Partial-checkout-then-commit deletes unchecked files** — `commit` reflects the FULL working-tree state, so committing from a `paths`-scoped checkout would drop everything not materialized. The room app must either full-checkout before commit, or add scoped commits. (Found during integration testing; the e2e test uses full-checkout-before-commit for the read-write path.)

## 8. Out of scope (for now)

Granular ACL, long-lived workspaces, real merge, ingestion beyond text/table, non-S3 stores, POSIX-directly-on-object-storage.
