# Agent Document Room — Working Spec

> **Status:** Working spec (temporary). Living document tracking the build-out of the agent document room on top of `agent-backend`. Not an OpenSDD behavioral contract — the room is deliberately spec-lite. Supersede/delete once the plan is stable and the durable pieces graduate to `docs/`.
>
> **Last updated:** 2026-07-27 · **Owner:** danny

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
| Access control | **The room is the tenant.** Principals are granted membership *to a room*; granular per-doc ACL deferred | Rooms may span organizations (two parties in a deal), so org is never a data-plane partition — see §7. Room-level membership is also what keeps the write path coherent: every member sees the whole room, so every member can commit |
| Derived text | **Committed as real files** (raw media stays a blob; embeddings are index-side only) | The shell must be able to `grep`/parse extracted text |
| Language | agent-backend keeps Python + TS; **everything new is TS-only** | — |

## 4. Monorepo layout & firewall

Package-first (apps at root, libs under `packages/`; convention from `aspects-apps`). `agent-backend` is a library, so it is a peer under `packages/`, not special.

```
packages/
  agent-backend/     typescript/ python/ opensdd/    # substrate lib (dual-language)
  versioned-store/   src/ ...                         # TS-only, the linchpin
  index-sync/        src/ ...                          # TS-only (interface + HashingEmbeddingProvider)
  embeddings/        # pluggable EmbeddingProvider adapters (local/OpenAI/Ollama) + CLIP images
  ingestion/         # PdfExtractionProvider (unpdf text-layer); image/OCR TODO
  vector-pg/         # PgVectorStore (pgvector) — persistent, ANN vector index
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

**Fs store + conformance (added):** **`FsBlobStore`/`FsRoomStore`** — content-addressed blobs + manifests on the local filesystem (dev + single-node self-host; no external deps). **Storage tiers: InMemory (tests) → Fs (dev / single-node) → S3 (scale).** A **shared conformance suite** (`test/support/conformance.ts`) runs the *same* behavioral contract (round-trip, dedup, partial checkout, LWW, sequential CAS, manifest JSON round-trip) against **all three backends** — so a fake can't silently drift from a real store (the failure mode behind the earlier CAS-atomicity and byte-read bugs). Green: in-memory (6) + fs (6) unit, s3 (6) integration.

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

**Real embedders (✅ `@agentbe/embeddings`):** pluggable `EmbeddingProvider` adapters behind the existing interface — **`LocalEmbeddingProvider`** (Transformers.js, default **all-MiniLM-L6-v2** 384-dim q8; offline, no key, private — the out-of-box default), **`OpenAIEmbeddingProvider`**, **`OllamaEmbeddingProvider`**, and a `createEmbeddingProvider({kind})` selector (`AGENTBE_EMBEDDER=local|openai|ollama|hash`). `@huggingface/transformers` is an optional peer (lazy dynamic import). Verified: unit (5) + a real semantic test (churn ranks above baking) + a real-bin e2e (churn query ranks interview notes above the CSV through the live MCP server). `HashingEmbeddingProvider` stays in index-sync core as the zero-dep fallback (tests). **`buildRoomService` defaults to hash** (fast tests); **the bin defaults to local** (real semantic search).

**Vector stores:** `InMemoryVectorStore` (index-sync core; brute-force cosine, rebuilt on boot) **+ `PgVectorStore`** (`@agentbe/vector-pg`) — pgvector-backed, persistent, HNSW ANN. Adapter is dep-light (structural `PgQueryable`; consumer passes a `pg.Pool`), fixed-dim per namespace (text vs image). A **shared VectorStore conformance suite** runs against in-memory (6) + pgvector (6). Room: `buildRoomService({vectors, imageVectors})`; bin `AGENTBE_VECTOR=pg` (+ `AGENTBE_PG_URL`) selects it and **skips reindex-on-boot** (persistent index survives). Verified: unit (fake client) + pgvector conformance (real container) + room-over-pgvector e2e.

**TODO / next:** media derived-text ingestion (see 5.4); a Qdrant adapter if wanted. Note: the index is model-specific — switching embedders requires reindex (auto for the in-memory index; a pg deployment needs an explicit reindex on embedder change).

### 5.4 `packages/ingestion` — extraction adapters (PDF text ✅; images/OCR TODO)
Per-asset preprocessing turning raw media into searchable form. Swappable providers; the raw asset stays a content-addressed blob, **derived text is committed as a sibling file**, and the existing text index picks it up (no index-sync change).

**Done — PDF text extraction (Phase A):**
- ✅ Self-contained **`PdfExtractionProvider`** interface + **`UnpdfExtractionProvider`** default (unpdf text-layer; no native deps). Scanned/OCR left to a user-supplied provider (no lightweight local OCR — needs page rasterization + an OCR engine).
- ✅ Room integration: `putDocuments` runs the extractor on `.pdf` uploads → commits `<path>.pdf.txt` → searchable; raw PDF preserved. `buildRoomService` wires it by default. Verified: extractor unit test + room e2e (upload PDF → derived `.txt` committed + found by search).

**Done — image embedding (Phase B):**
- ✅ **`ImageEmbeddingProvider`** interface (index-sync) + **`ClipImageEmbeddingProvider`** (`@agentbe/embeddings`, CLIP via Transformers.js, `clip-vit-base-patch32`, image + text in one 512-dim space; offline, no key). Verified with the real model (the Python-logo fixture scores higher on "python logo" than "fluffy kitten").
- ✅ **`ImageIndexSync`** (index-sync) — a **separate** image index (CLIP space) keyed by blob hash; `query()` embeds the text query via `embedText` for text→image retrieval.
- ✅ Room: image index wired in; **`search(room, query, k, modality)`** with `modality = text | image | all` (default all, results merged by score) — the MCP `search` tool exposes `modality`, giving **combined and per-modality** search. Bin defaults to local CLIP (`AGENTBE_IMAGE_EMBEDDER=none` disables). Verified: `ImageIndexSync` unit + room image-search unit (image-only / text-only / combined / no-embedder).

**TODO:**
- ☐ OCR provider (Tesseract.js / AI-OCR) for scanned PDFs; transcription (audio/video); table extraction.

### 5.5 `room` — the app (root `room/`; service core ✓, MCP server ✓)

**Delivery format (decided):** the room's **primary surface is a headless MCP server** — the canonical way an agent consumes a data room, and on-brand with agent-backend (itself an MCP server, one layer down). This dissolved the earlier "Next.js vs Hono" question: transport is **MCP** (stdio ✓, streamable-HTTP next), mirroring agent-backend's dual-transport daemon. `RoomService` stays the transport-agnostic core; the MCP server is one adapter. A **UI portal is a separate example app** (a client), not the core. Session lifecycle maps to the MCP **connection** (per-call exec now; per-connection persistent workspace is the natural upgrade).

**Done — service core (`RoomService` / `RoomSession`), unit + S3-integration tested (6 unit + 1 integration green):**
- ✅ `putDocuments(room, files, author)` — full-checkout-of-HEAD then write then commit (never drops existing docs), auto-reindex.
- ✅ `search(room, query, k)` — semantic search over the room.
- ✅ `openSession(room, {paths?})` — provisions an ephemeral agent-backend workspace, checks out HEAD (full = read-write, `paths`-scoped = **read-only**, which enforces the partial-commit guard from §7), exposes `exec` + working tree + `commit(author)` (reindexes, chains base) + `close()`.
- ✅ **`WorkspaceProvider`** seam + **`LocalWorkspaceProvider`** (temp-dir `LocalFilesystemBackend`); a Docker/daemon provider is the production swap.
- ✅ The `BackendWorkingTree` adapter (agent-backend `Backend` → `WorkingTree`, byte-read fix) lives here.

**Done — MCP server (primary delivery), `@modelcontextprotocol/sdk`, in-process-client tested (5 green; 16 room tests total):**
- ✅ `createRoomMcpServer(service, room)` + `serveRoomStdio(...)` (stdio transport).
- ✅ Retrieval tools: **`search`**, **`list_documents`**, **`read_document`** (all sandbox-free).
- ✅ Execution: one-shot **`run_command`** (read-only checkout of `paths`) + **warm sessions** — **`open_session`** (full = read-write, `paths` = read-only) → repeated **`run_command`/`write_file`** against the *same live sandbox* (state persists across commands) → **`commit_session`** (versioned write-back + reindex) → **`close_session`**. Plus one-shot **`put_document`**. This IS the agent-loop wiring (`search → checkout → exec → commit`).
- ✅ Tested via an in-process MCP `Client` over a linked transport — every tool end-to-end, incl. warm-session state persistence (`echo > f` then `cat f` in the same session) and the read-only-session commit guard.

**Done — transports + runnable server:**
- ✅ **Streamable-HTTP transport** (`serveRoomHttp`) — **stateful** (one `McpServer` + warm-session registry per client connection, keyed by `Mcp-Session-Id`), so warm sessions survive across HTTP requests (a per-request stateless server couldn't). Optional **bearer auth**. Node `http` (no framework dep). Tested in-process (tools/search over HTTP, warm session across separate requests, auth enforcement).
- ✅ **Runnable bin** (`room/src/bin.ts` → `dist/bin.js`): stdio by default, **HTTP when `AGENTBE_HTTP_PORT` set**; persistent `Fs` store (`AGENTBE_STORE_DIR`, default `room/.room-data`), seed-if-empty / reindex-on-boot; wired into Claude Code via repo-root `.mcp.json` (HTTP, `:8848/mcp`).

**Done — demo server + idle reaping (2026-07-27):**
- ✅ **Demo room** (`room/examples/demo-room/`) — the single way to run a room by hand, on the **real** embedders (MiniLM + CLIP) and the shared `room/testdata` corpus. `make demo` serves HTTP `:8848`; `make demo-test` drives it over a **real streamable-HTTP MCP connection** (its own port 8849 + store, so it can't clobber a live demo) asserting semantic ranking, cross-modal text→image, PDF-derived text, sandboxed exec, and warm-session state across separate HTTP requests. Verified green end to end.
- ✅ **Idle-TTL session reaping** — warm sandboxes are released after `sessionIdleMs` (default 15 min, `AGENTBE_SESSION_IDLE_MS`, `0` disables). Closes the hosted-HTTP leak where a client vanishes without `close_session` (invisible over stdio, where process death cleans up). Reaping skips sessions with **work in flight**, so a command outliving the window can't have its sandbox pulled out from under it. Threaded through `createRoomMcpServer` / `serveRoomStdio` / `serveRoomHttp` / bin. 2 tests (reap-when-idle, don't-reap-in-flight); the in-flight guard was verified non-vacuous by breaking it.

**TODO:**
- ✅ **Warm sessions** (open/run/write/commit/close via a session registry; state persists across commands; cleaned up on connection close **and by an idle reaper**). TODO within this: session-scoped `WorkspaceProvider` reuse.
- ◑ **Room-level auth** — bearer-token check on the HTTP transport ✅; membership/multi-token + granular ACL still TODO.
**Done — principal attribution (2026-07-28):**
- ✅ **`author` is no longer a tool argument.** It was caller-supplied on `commit_session` / `put_document` (defaulting to `"mcp-agent"`), so attribution was self-asserted and forgeable. The identity is now **derived from the credential** by the transport and fixed for the life of the connection (`RoomMcpOptions.principal`).
- ✅ **Per-principal bearer tokens** — `RoomHttpOptions.principals` maps token → principal id (e.g. an email); `AGENTBE_PRINCIPALS` is the JSON env form. This buys a real audit trail **and per-person revocation** (delete one entry instead of rotating a shared secret across the org) without needing a membership system. `resolvePrincipal` is the escape hatch for a DB/JWT lookup. The older single `authToken` still works but authenticates without identifying — commits land as `anonymous`, and the bin says so at startup.
- ✅ **Sessions are bound to their opener.** A warm session records its principal; a request authenticated as someone else gets **403** rather than having its work attributed to the session's owner. (Verified non-vacuously — removing the check fails the test.)
- ✅ 7 attribution tests asserting against `manifest.createdBy` in the store, not the tool response — including a forged-`author` attempt and the shared-token `anonymous` fallback.

**TODO:**
- ☐ **Room membership + roles** (*not* org multi-tenancy — see §7). Deployment today is **one process per room**, so room isolation comes from process + token separation, which is sound for a modest number of orgs. Still needed for scale: `(principal, room, role)` grants; room bound at connect via `/rooms/:room/mcp` and authorized once per connection (keeps every tool signature unchanged — no `room` argument); roles from the §5.6 plane split — **reader** = retrieval only, never gets a sandbox; **member** = sandbox + commit. Token provisioning is manual, which is fine at ten orgs and painful at a hundred.
- ☐ **Production `WorkspaceProvider`** — only `LocalWorkspaceProvider` exists, which runs agent code **unsandboxed on the host**. This is the blocker to vending; see 5.6.
- ☐ **UI portal** as a separate example app (a client of the room).
- ✅ Real embedding provider + vector-store adapter (MiniLM/CLIP via `@agentbe/embeddings`; `PgVectorStore` via `@agentbe/vector-pg`).

### 5.6 Deployment & orchestration (decided; k8s path deferred)

**Two planes.** The per-op ephemeral sandbox was a category error — retrieval/ingestion and code-execution have opposite resource profiles. Split them:
- **Control / retrieval plane** — the long-lived service: **store + index + sandbox broker**. Ingest/search/read need **no sandbox** (pure store+index). Stateless-scalable; the broker is control-plane (it *manages* external sandboxes, doesn't run them), so it's fine to bundle with retrieval.
- **Execution plane** — per-**session** agent-backend sandboxes (external instances), **warm across commands**, idle-reaped. Not per-op. Only code execution needs these.

**The service vends sandboxes on request.** Read-only clients (contract-QA) use retrieval and never get a sandbox; interactive agents request one. A vended sandbox is wired to the room: checkout/commit against S3 directly + search via the service.

**`WorkspaceProvider` is the broker seam** (already built). Production = a k8s/Docker/E2B provider, wired at the composition root — **`room` depends only on the interface**, staying deployment-agnostic.

**Done — `DockerWorkspaceProvider` (2026-07-28), sandboxed by default:**
- ✅ **One `agentbe-daemon` container per session**, reached via `RemoteFilesystemBackend`. Container-per-session is the isolation boundary — *not* one shared daemon with per-request scope paths, since `ScopedFilesystemBackend.exec` only sets `cwd` and does not contain `exec`. Drives the `docker` CLI, so **zero new dependencies** (§4 firewall intact); lives in `room` beside `workspace-local.ts`.
- ✅ **`AutoWorkspaceProvider` is now the `buildRoomService` default**: Docker when reachable, otherwise `LocalWorkspaceProvider` **with a loud UNSANDBOXED warning**. Detection is lazy (keeps `buildRoomService` sync) with `preflight()` for boot-time reporting; the bin prints `[agentbe-room] sandbox: docker|local`. Override with `AGENTBE_SANDBOX=docker|local`.
- ✅ **Hardened by default**: per-container auth token, `--memory`/`--cpus`/`--pids-limit` caps, loopback-only published port, and **no store credentials inside the sandbox** — the room streams checkout/commit bytes over the daemon connection, so the sandbox never talks to S3 and needs no egress. `AGENTBE_SANDBOX_NETWORK` attaches an egress-restricted network. (`--network none` is *not* usable: it also drops the published port the room connects through.)
- ✅ Verified against real containers: full loop (checkout → exec → commit-back), OS identity confirming it isn't the host, and idempotent teardown. Gated behind `AGENTBE_DOCKER_TESTS=1` in the integration suite; unit tests pass `LocalWorkspaceProvider` explicitly so they stay hermetic and fast.
- ⚠️ **The published image `ghcr.io/aspects-ai/agentbe-daemon:latest` is amd64-only** — no arm64 manifest, so it fails outright on Apple Silicon. Worked around via `--platform` (`AGENTBE_SANDBOX_PLATFORM`, auto-set by the demo's `run.sh` on arm64) which costs emulation overhead. **Publishing a multi-arch image is the real fix** and is worth doing before this ships to anyone on Apple Silicon.
- Note: inside the container the daemon logs `bwrap not detected, using software isolation (validation only)` — expected, and fine here because the **container** is the boundary, not bwrap. Installing bubblewrap in the image would add defense-in-depth.

**Done — `K8sWorkspaceProvider` + a room image and manifests (2026-07-28).** Rooms now deploy on Kubernetes with **sandbox-per-session pods**, verified end to end on a local `kind` cluster.
- **Why it had to come with the k8s deploy, not after.** A room pod has no Docker socket (and k8s runtimes are containerd), so `AutoWorkspaceProvider` would fall back to `LocalWorkspaceProvider` — every session in a room sharing one filesystem. Deploying rooms on k8s *without* this would have been a **regression** against the cross-session isolation already proven under Docker. `isInCluster()` is therefore checked **before** Docker in the selector, and the manifests pin `AGENTBE_SANDBOX=k8s` so a misconfiguration fails loudly instead of silently degrading.
- **No Kubernetes client library.** Talks to the API server over `node:https` with the projected service-account token — §4's dependency-light rule holds, and the separate `@agentbe/k8s-workspaces` package §5.6 anticipated is unnecessary (its rationale was isolating `@kubernetes/client-node`). Lives in `room` beside the Docker provider.
- **`room/Dockerfile`** (multi-stage, pnpm workspace, non-root, binds `0.0.0.0`) and **`room/examples/k8s/rooms.yaml`** (Namespace, ServiceAccount + minimal Role, per-room Secret/Deployment/Service). RBAC is `create`/`get`/`delete` on pods only — no list, watch, exec, or secrets — and sandbox pods set `automountServiceAccountToken: false` so untrusted code never gets an API token.
- **Verified** (`room/examples/k8s/check.mjs`): rooms reachable and credential-isolated, no content crossing, two sessions → **two distinct sandbox pods**, session 1 cannot read session 2's file, different hostnames, commit-back from inside a sandbox pod, and **pods deleted on close (2 → 0)**.
- **Two bugs found by running it, both invisible to unit tests:** (1) setting `NODE_EXTRA_CA_CERTS` at runtime does nothing — Node reads it only at process start — so the cluster CA is now passed directly to `https.request`, else TLS fails with *"unable to verify the first certificate"*; (2) sandbox pods had no readinessProbe, so pod-Ready meant "container started" and the room connected before the daemon listened (`ECONNREFUSED`) — Ready is now gated on `/health`.
- **The amd64-only daemon image became a hard blocker here**, as predicted but for a different reason: a `kind` node on Apple Silicon is arm64, and pods simply won't start. Worked around by building the daemon locally; **a multi-arch published image is the real fix** and is now the top remaining item.
- **Not production-ready:** storage is `emptyDir` (set `AGENTBE_S3_BUCKET` for durable, reschedulable rooms); **no NetworkPolicy**, so sandbox pods can currently reach the cluster network and the API server — a default-deny egress policy on `agentbe.room/sandbox=true` is the next hardening step, and cheap since the sandbox needs no egress at all; no warm pool, so every session pays full pod startup.

**Fixed — `seedRoomFromDir` walked into hidden directories (2026-07-28).** Every seeded document appeared **three times** in a k8s deploy: a ConfigMap volume is a symlink farm (`..data` → a timestamped `..2026_..._123/` directory holding the real files), and the recursive walk descended into both. The same bug would ingest an entire `.git` when seeding from a repo directory. Now skips dot-entries, with a test that reproduces the ConfigMap layout and fails without the fix. Found only by querying a deployed room — no unit test covered a seed directory containing hidden dirs.

**Done — session lifetime decoupled from connection lifetime (2026-07-28).** Sessions were held in a `Map` inside each `McpServer`, i.e. **per MCP connection**, and released on connection close. That was built for per-task sessions; it breaks for agent work sessions of 10–60 minutes, where a network blip or client restart destroyed a live sandbox and its uncommitted working tree.
- **`SessionRegistry`** (`room/src/session-registry.ts`) is now process-wide, keyed by an unguessable server-generated id and **authorized by principal** — the principal check replaces connection scoping as the isolation boundary. `serveRoomHttp` creates exactly one and shares it across connections, so a reconnecting client re-attaches to its live sandbox by id. Connection close deliberately releases nothing; the **idle reaper is the sole reclaimer**. Caveat: under a shared `authToken` every caller is `anonymous`, so that mode gives weaker session isolation than per-principal tokens.
- **Orphan sweep.** The registry is in-memory, so a room restart forgot every session while its sandbox kept running — a stray container locally, a pod holding node capacity in k8s, with no owner left to delete it. Providers gained an optional `reclaimOrphans()`, scoped by an **owner label** (rooms share a host/namespace, so an unscoped sweep would delete a sibling room's live work). The bin runs it at startup. Needed adding `list` on pods to the room's Role — still no watch, exec, or secrets.
- **Verified on the cluster, deterministically:** two stranded sandbox pods labelled for different rooms; restarting `room-acme` logged `reclaimed 1 orphaned sandbox(es)`, deleted **only** `orphan-acme`, and left `orphan-globex` running. The reconnect behaviour has a unit test proven non-vacuous (it fails when the registry is per-connection again), plus one asserting a second principal cannot attach to another's session.
- **`replicas: 1` is now load-bearing and documented as such** in the manifests: the registry is in-process, so a second replica would serve requests for sessions it does not hold. Scaling needs sticky routing or an externalized registry first (§5.6).

**Correction (2026-07-28): `RemoteFilesystemBackend` already implements reconnect.** An earlier note here called for building it. It exists — `ReconnectionConfig` (enabled by default, exponential backoff, capped retries), triggered on connection close. Transient drops (network blip, daemon hiccup at the same address) are already covered; nothing to build.
The real gap is narrower: reconnect targets `config.host`, fixed at construction, so a sandbox that resumes **at a different address** cannot be reached again. That matters only for hibernation, and the fix is not an agent-backend change — agent-sandbox gives each `Sandbox` a **stable network identity**, so pointing the backend at that name instead of a raw pod IP makes the existing reconnect logic cover resume for free. Fast-follow item is therefore "address sandboxes by stable name", bundled with the agent-sandbox work, not a change to the OpenSDD-governed daemon package.

**k8s orchestration → [kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox)** (SIG Apps CRD controller: `Sandbox` / `SandboxTemplate` / `SandboxWarmPool` / `SandboxClaim` — on-demand isolated pods, warm pools, pause/resume, reaping, built *for* untrusted agent code). It **is** the scheduler — so **no separate scheduler package** (would duplicate it). A thin **`K8sWorkspaceProvider`** claims a sandbox (pod running `agentbe-daemon` via a `SandboxTemplate`) → returns a `RemoteFilesystemBackend`.
- **Do NOT add agent-sandbox to agent-backend core.** Layering: agent-sandbox *deploys* agent-backend (schedules pods that run the daemon) — depending on it would invert the stack and break agent-backend's portable/lightweight identity. agent-backend stays daemon + connect-client; its "K8s coming soon" roadmap is largely subsumed by agent-sandbox.
- The k8s provider lives in its **own opt-in package** (`@agentbe/k8s-workspaces`) — reason is **dependency isolation** (`@kubernetes/client-node`; agent-sandbox ships only Go/Python SDKs so we drive CRs via the k8s API), NOT code size. Keeps `@kubernetes/client-node` out of `room`'s deployment-agnostic core.
- **Build it only when the k8s path is tackled** (YAGNI). The seam means zero `room` changes when added. `LocalWorkspaceProvider` covers dev/MVP.

**Session state caveat:** the broker holds session→sandbox mapping; for horizontal scale, use session affinity or externalize it. Ignore for single-node MVP.

## 6. Build sequence

Dependency-first. Land each, verify, then proceed.
1. ✅ Monorepo restructure (done — commit `a1797f3`).
2. ✅ **`versioned-store`** — core + in-memory + unit tests, **and** S3 adapters verified end-to-end against LocalStack. The substrate is real.
3. ✅ **`index-sync`** (5.3) — sync/syncDiff/query + BYO embedder/vector-store, hash-keyed dedup, unit-tested (4 green).
3.5. ✅ **Integration hardening** (`packages/integration`) — `BackendWorkingTree` adapter (agent-backend `Backend` → `WorkingTree`) + full-loop e2e test: **search → checkout → exec → commit-back → reindex** over S3 + a real `LocalFilesystemBackend`, using real fixtures (CSV `wc -l` = use case A; PNG byte-fidelity). **Surfaced & fixed a real seam:** agent-backend `read()` defaults to a UTF-8 *string*, which would corrupt binaries in checkout/commit — the adapter forces byte reads. 2 integration + 3 unit tests green. Adapter kept out of agent-backend (no breaking spec change) and out of versioned-store (structural, no dependency).
4. ✅ **`room` app** (5.5) — **service core** (`RoomService`/`RoomSession` + `LocalWorkspaceProvider`) + **MCP server** over **stdio and streamable-HTTP**, warm sessions with idle reaping, bearer auth, a runnable bin, and a demo server verified end to end over real HTTP. ☐ Remaining: principal identity + room membership, UI example app.
5. ✅ **`ingestion`** (5.4) — PDF text + CLIP image embedding landed; OCR/transcription/tables still open.
6. ✅ **Sandboxed execution** — `DockerWorkspaceProvider`, container-per-session, now the default with a warned fallback (see 5.6).
7. ✅ **Principal attribution** — per-principal tokens, derived (unforgeable) commit authorship, session-principal binding (see 5.5).
8. **← next.** Remaining for vending: **(a) a multi-arch daemon image** (amd64-only today — blocks Apple Silicon developers), **(b) HEAD CAS → DynamoDB** before real multiplayer (§7), **(c) room membership + roles** when manual per-room token provisioning stops scaling (see 5.5), **(d) `K8sWorkspaceProvider`** when the hosted/multi-node path is tackled.

**Verified locally (2026-07-28).** Docker sandboxing and the multi-room deploy shape are both exercised end to end:
- **Cross-session isolation** — two concurrent sessions get separate containers (distinct hostnames) and cannot read each other's files. This is the claim container-per-session exists to make; a shared daemon with per-request scope paths would fail it.
- **The idle reaper destroys containers**, asserted against `docker ps` rather than our own bookkeeping — the reaper was originally built and tested against temp dirs, where a missed reap is free; under Docker it is a running, billing container.
- **`room/examples/multi-room/`** (`make rooms` / `make rooms-test`) boots N rooms one-process-each and asserts 15 checks: cross-room credential rejection (401, not an empty result), no content crossing (including a `notes.md` present in *both* rooms with different contents), unforgeable per-principal attribution, and per-room sandbox contents. Teardown verified clean — no leaked ports or containers.

**Done — S3 wired into the deployable server (2026-07-28).** The S3 adapters were built and tested but **unreachable from `buildRoomService` / the bin**, which only ever constructed `Fs*` stores from `storeDir` — so every deployed room was pinned to one node's local disk despite S3 being the §3 locked decision. Now: `BuildRoomServiceOptions.blobs`/`.rooms` accept any store, `createS3Stores({bucket, prefix, region, endpoint, credentials})` builds the S3 pair with the AWS SDK **lazily imported** (the `pg` pattern — stays off the default path), and the bin selects it via `AGENTBE_S3_BUCKET` + friends, logging the active store at boot. Credentials fall back to the default AWS provider chain. `@aws-sdk/client-s3` moved from room's devDependencies to dependencies — it arrives transitively via `versioned-store` regardless, and the dynamic import is otherwise illegal under pnpm's strict linking. Verified: 5 S3 integration tests (round-trip, durability across a fresh service, prefix isolation, principal in the manifest, cross-room blob sharing) plus the full 15-check multi-room harness on the S3 tier (`make rooms-test S3=1`).

**✅ Manifest refs are global identifiers (fixed 2026-07-28).** `hashManifest` previously hashed `(parent, createdBy, entries)` — **not the room** — so two rooms committing identical content produced the *same* ref. That was safe only while every lookup stayed room-qualified, and it left two traps: a ref keyed into a cache, dedupe layer, or cross-room lookup would conflate two rooms' histories (the confused-deputy shape flagged for blobs in §7), and the stored manifest's `room` field wasn't covered by its own hash, so integrity couldn't be checked by re-hashing. `room` is now the first hash input, taken before any production data existed.
- **Not a migration.** Refs are opaque keys — computed only at commit, never recomputed or verified on read — so existing stores keep working. Verified by booting against a store written *before* the change: old HEAD loaded, index rebuilt, all 9 documents readable, and a new commit chained correctly onto the old-style parent ref.
- Guarded by two tests in `versioned-store` (different rooms → different refs; still idempotent for identical room+parent+author+entries) and the room-level S3 test. Note blob dedupe is **unaffected** — blobs stay content-addressed and *not* room-namespaced, so overlapping rooms still cost one copy; only manifests are room-qualified.
- Gotcha worth remembering: `versioned-store`'s own tests import from `src`, but `room` resolves the built `dist`. A change here needs `make build-typescript` before room's suite will see it — the first re-run passed in one package and failed in the other for exactly this reason.

**Deploying rooms in production (one process per room, 2026-07-28).** Each org gets its own room, process, and token set — room isolation comes from process + credential separation, which the room-is-the-tenant model (§7) makes sound. Operational notes: bind with **`AGENTBE_HTTP_HOST=0.0.0.0`** in a container (the default is loopback, and a published port would otherwise accept nothing); set **`AGENTBE_PRINCIPALS`** so commits are attributable and revocable per person; prefer **`AGENTBE_VECTOR=pg`** so the index persists instead of re-embedding the whole corpus on every boot (`bin.ts` skips reindex only for a persistent store). TLS is **not** handled by the room — terminate it at a reverse proxy or load balancer.

## 7. Open questions / deferred

- **Org multi-tenancy — decided against (2026-07-27).** Org is *not* a data-plane partition; the **room is the tenant**, and the code already assumes it (every `RoomService` method is room-parameterized; the store is `rooms/<room>/HEAD` + `rooms/<room>/manifests/`; the index is room-scoped). A room may legitimately span organizations — two parties in a deal, per-individual access — so org-partitioned identity would *block* the motivating case rather than serve it; cross-org rooms require globally-addressable principals (OIDC subject / email), not org-namespaced user ids. Org survives only in the control plane: billing/ownership, SSO federation, admin and audit queries. The enterprise "we need tenant isolation" ask is answered by **deployment** (a dedicated instance / self-host — already the consumption model in §4), not by org rows in a schema, since customers making that ask want physical isolation anyway.

- **Granular (per-document) ACL** — deferred, and the cost is larger than "the index filters by identity":
  - **It forces scoped commits.** An ACL-filtered checkout *is* a partial checkout, and `commit` reflects the FULL working tree (see the footgun below). Today `openSession` therefore forces any `paths`-scoped session read-only (`canCommit: false`). So under granular ACL, *any* principal who can't see every document becomes read-only until scoped commits exist. **Granular ACL and scoped commits are one project, not two.**
  - It also breaks the symmetry the merge model leans on: room-level membership means every member's manifest view is identical, which is why per-file LWW works.
  - **Rooms substitute for it only up to a point.** Blobs are content-addressed and *not* room-namespaced (`${prefix}blobs/<hash>`), so a second room with overlapping contents is nearly free in **storage** — the standard VDR pattern (a room per audience) is cheap. But dedupe does not extend to **maintenance**: rooms have independent manifests and HEADs, so a document in N rooms is one blob but N manifests, and updating it is N commits with N chances to conflict. Rooms handle **cohort-shaped** permissions (a few stable audiences); they do *not* handle per-individual exclusions shifting over time inside one shared working set.
  - If it does become required, scope it **read-only-first**: filtered search/read for restricted principals, with sandbox and commit still gated on full-room membership. That serves the common ask ("this analyst may look, but not at everything") without touching the write path.
  - Keep blob reads **mediated by the room manifest** — never expose a hash-addressed read across rooms, or the shared blob namespace becomes a confused deputy. Relatedly, cross-room blob sharing makes GC refcount-based and complicates "prove our data is deleted" when a counterparty's room shares the blob.
- **Long-lived / personal workspaces** — coherence of N durable checkouts. Deferred behind ephemeral.
- **Real 3-way merge** — when multiplayer heats up; grow from retained manifests.
- **Case A as a separate store** — the GB-scale read-only binary catalog may want a distinct read-only manifest-over-S3 surface rather than sharing the read-write room store. The seam between "git-/manifest-backed read-write rooms" and "read-only catalogs" may be the real product boundary. Revisit.
- **`versioned-store` published name** — `@agentbe/versioned-store` is a placeholder (`private: true`).
- **Pre-existing `ty` type backlog** (13 diagnostics in `agent-backend` python) — tracked separately from the room work.
- **HEAD CAS atomicity → DynamoDB before real multiplayer/prod.** Verified (2026-07): our `S3RoomStore` CAS is correct only if the backend's conditional writes are atomic. Real AWS S3 guarantees this; **LocalStack does not** (probe: two concurrent `casHead` on the same expected ref both win → lost updates; 6 concurrent commits dropped 3 files). Single-writer paths are unaffected. Decision: **defer** — correct on real AWS today; before shipping real multiplayer or supporting non-atomic S3-compatible stores, move HEAD ref + `casHead` to **DynamoDB** conditional updates (atomic, and faithfully emulated by LocalStack → concurrency becomes locally verifiable). Manifests/blobs stay in S3. The skipped test in `packages/versioned-store/test/concurrency.integration.test.ts` re-enables against real AWS S3 or DynamoDB.
- **Partial-checkout-then-commit deletes unchecked files** — `commit` reflects the FULL working-tree state, so committing from a `paths`-scoped checkout would drop everything not materialized. The room app must either full-checkout before commit, or add scoped commits. (Found during integration testing; the e2e test uses full-checkout-before-commit for the read-write path.)

## 8. Out of scope (for now)

Granular ACL, long-lived workspaces, real merge, ingestion beyond text/table, non-S3 stores, POSIX-directly-on-object-storage.
