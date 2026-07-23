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

### 5.3 `packages/index-sync` — search (thin lib)
Keep a semantic + lexical index in step with manifests; **derived and rebuildable**, keyed by blob hash so unchanged blobs are never re-embedded.

**Scope:**
- `sync(room, ref)` / incremental `syncDiff(room, fromRef, toRef)` — embed added/changed blobs (via their derived text for media), remove deleted.
- **Embedding-provider abstraction** (BYO model) + **BYO vector store** (interface, not a bundled DB).
- Query is a service, **room-scoped** (no per-doc ACL yet), returns paths/hashes the agent then checks out.
- Runs **outside** the sandbox.

### 5.4 `packages/ingestion` — extraction adapters (later; optional plugins)
Per-asset pipeline turning raw media into searchable + shell-analyzable form. **Not core** — a set of swappable adapters.
- Adapters: OCR (images/PDF), transcription (audio/video), table extraction (Excel/CSV normalization).
- Output contract: raw asset stays a content-addressed blob; **derived text committed as a sibling file**; embedding handed to `index-sync`. Derived artifacts are rebuildable — history tracks the raw asset as canonical.

### 5.5 `room` — the app (last)
The orchestrator + product surface. Papermark-like deployable (Next.js), self-hostable.
- **API**: room CRUD, upload/ingest, search, checkout-a-workspace, run/exec, commit.
- **Membership + room-level auth** (granular ACL deferred).
- **Workspace provisioning**: spin up an ephemeral agent-backend workspace scoped to a room, wire the agent loop (search tool + shell), tear down after task.
- **Agent loop wiring**: expose `search → checkout → exec → commit-back` as tools to the agent.
- Batteries-included: `clone → configure S3 + vector store + model key → run`; libs remain independently importable.

## 6. Build sequence

Dependency-first. Land each, verify, then proceed.
1. ✅ Monorepo restructure (done — commit `a1797f3`).
2. ✅ **`versioned-store`** — core + in-memory + unit tests, **and** S3 adapters verified end-to-end against LocalStack. The substrate is real.
3. **`index-sync`** (5.3) — enables discovery. **← next.**
4. **`room` app** MVP (5.5) — wire store + index + agent-backend into the loop; read-write with LWW; room-level auth.
5. **`ingestion`** (5.4) — multimodal, added as the corpus demands it.

## 7. Open questions / deferred

- **Granular (per-document) ACL** — needs the index to filter by identity; lives in the store. Deferred.
- **Long-lived / personal workspaces** — coherence of N durable checkouts. Deferred behind ephemeral.
- **Real 3-way merge** — when multiplayer heats up; grow from retained manifests.
- **Case A as a separate store** — the GB-scale read-only binary catalog may want a distinct read-only manifest-over-S3 surface rather than sharing the read-write room store. The seam between "git-/manifest-backed read-write rooms" and "read-only catalogs" may be the real product boundary. Revisit.
- **`versioned-store` published name** — `@agentbe/versioned-store` is a placeholder (`private: true`).
- **Pre-existing `ty` type backlog** (13 diagnostics in `agent-backend` python) — tracked separately from the room work.

## 8. Out of scope (for now)

Granular ACL, long-lived workspaces, real merge, ingestion beyond text/table, non-S3 stores, POSIX-directly-on-object-storage.
