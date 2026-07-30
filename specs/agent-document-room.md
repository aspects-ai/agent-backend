# Agent Document Room — Decisions Log

> **Status:** Decisions log. Records the locked decisions, their rationale,
> and open questions for the agent document room built on `agent-backend`.
> Narrative architecture lives in [docs/room-architecture.md](../docs/room-architecture.md);
> operational/deployment detail lives in [docs/room-deployment.md](../docs/room-deployment.md).
> This doc is where "why we chose X over Y" is preserved once the how moves out.
>
> **Last updated:** 2026-07-28 · **Owner:** danny

## 1. Goal

A multiplayer, versioned, semantically-searchable, multimodal document room
for agents — search a shared corpus, then pull a working subset into a POSIX
sandbox to run code/shell against it. See
[docs/room-architecture.md](../docs/room-architecture.md) for the full
description, driving use cases, and the checkout→exec→commit-back loop.

## 2. Architecture

See [docs/room-architecture.md](../docs/room-architecture.md) — the six seams
(store / index / ingestion / sandbox / transport / identity), the
manifest-on-S3 version model, and the isolation model (room-is-the-tenant,
per-session sandbox, principal-derived attribution).

## 3. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Store | **Corpus-dependent:** S3 content-addressed blobs for workspace rooms; a database catalog + object storage for catalog rooms | Writable workspaces and continuously-ingested organizational catalogs have different scaling and consistency needs |
| Version model | **Manifest snapshots are the workspace adapter, not the universal room model.** Catalog rooms use document/version rows plus a monotonic revision or change log | Full path→hash snapshots are useful for bounded collaborative workspaces but scale with total file count on every version; catalog revisions scale with the changed documents |
| Sandbox | **Checkout model** (materialize subset → agent-backend) | POSIX-on-object-storage not yet mature enough; Git-style working tree is the proven primitive |
| Workspace CAS primitive | **S3 + small DB** (Dynamo/Postgres) holds HEAD + manifest history; S3 conditional-write is the DB-free fallback | Atomic HEAD advance without a lock service for manifest-backed workspaces |
| Workspace lifetime | **Ephemeral per task** now; long-lived later | Minimizes conflict window; commit-back is the only way state becomes real |
| Commits | **Per task** | Each manifest is a revert target |
| Merge | **Per-file last-writer-wins** now; grow into 3-way merge later from retained manifests | Multiplayer isn't hot yet; not a one-way door |
| Access control | **The room is the tenant.** Principals are granted membership *to a room*; granular per-doc ACL deferred | Rooms may span organizations (two parties in a deal), so org is never a data-plane partition — see §7. Room-level membership is also what keeps the write path coherent: every member sees the whole room, so every member can commit |
| Derived text | **Committed as real files** (raw media stays a blob; embeddings are index-side only) | The shell must be able to `grep`/parse extracted text |
| Language | agent-backend keeps Python + TS; **everything new is TS-only** | — |
| Delivery format | **Headless MCP server** (stdio + streamable-HTTP), not Next.js/Hono | On-brand with agent-backend (itself an MCP server); a UI portal is a separate client, not the core |
| Sandbox broker | **`WorkspaceProvider` seam**, production = Docker/k8s/agent-sandbox | Keeps `room` deployment-agnostic; the room depends only on the interface |
| k8s orchestration | **[kubernetes-sigs/agent-sandbox](https://github.com/kubernetes-sigs/agent-sandbox)**, no separate scheduler package | It already *is* the scheduler (CRDs for on-demand pods, warm pools, pause/resume); duplicating it would be redundant. Kept out of `agent-backend` core — agent-sandbox *deploys* agent-backend, so depending the other way would invert the stack |
| k8s client | **No Kubernetes client library** — talk to the API server over `node:https` with the projected token | Keeps the dependency-light rule (§4) intact; avoids a `@kubernetes/client-node` dependency for a thin CRUD surface |

## 4. Monorepo layout & firewall

Package-first (apps at root, libs under `packages/`). `agent-backend` is a
library, so it sits as a peer under `packages/`, not special.

```
packages/
  agent-backend/     typescript/ python/ opensdd/    # substrate lib (dual-language)
  versioned-store/   src/ ...                         # TS-only, the linchpin
  index-sync/        src/ ...                          # TS-only (interface + HashingEmbeddingProvider)
  embeddings/        # pluggable EmbeddingProvider adapters (local/OpenAI/Ollama) + CLIP images
  ingestion/         # PdfExtractionProvider (unpdf text-layer); image/OCR TODO
  vector-pg/         # PgVectorStore (pgvector) — persistent, ANN vector index
agentbe-daemon/      # deploy peer: Docker + deploy-tool, bundles agent-backend
room/                # the app — a headless MCP server (NOT Next.js), root peer
docs/  specs/  Makefile ...
```

**Firewall rules (load-bearing):**
- `agent-backend` keeps its own README/pitch/release and a **dependency-light graph** — no S3/vector/model SDKs leak in. Those live only in the new packages.
- `opensdd/` governs **only** agent-backend and stays scoped inside its package. The room and other new packages are spec-lite (this doc), no OpenSDD.
- Consumption model, not licensing: ship a Papermark-style deployable `room` app **and** importable libs from one monorepo.

## 5. Package status

Implementation is substantially complete. Current state, package by package:

- **`packages/agent-backend`** — the execution/sandbox substrate (`FileBasedBackend`, daemon over MCP/SSH). Stable dependency; no room-driven changes.
- **`packages/versioned-store`** — the linchpin: content-addressed store + checkout/commit-back, `InMemory`/`Fs`/`S3` backends behind a shared conformance suite, per-file LWW + CAS retry. Open: blob chunking threshold, manifest size limits for huge rooms, blob GC (§9.2, §10).
- **`packages/index-sync`** — sync/syncDiff/query, hash-keyed dedup, pluggable `EmbeddingProvider`/`VectorStore`. Real embedders (`@agentbe/embeddings`: local MiniLM/CLIP, OpenAI, Ollama) and a persistent vector store (`@agentbe/vector-pg`) are implemented.
- **`packages/ingestion`** — PDF text extraction (`UnpdfExtractionProvider`) and CLIP image embedding are done. OCR (scanned PDFs), transcription, and table extraction are open (§8).
- **`room`** — service core (`RoomService`/`RoomSession`), MCP server (stdio + streamable-HTTP), warm sessions with idle reaping, principal-derived attribution, and sandboxed execution (`Docker`/`K8s`/`AgentSandbox` workspace providers) are all implemented. See [docs/room-architecture.md](../docs/room-architecture.md) for how these compose and [docs/room-deployment.md](../docs/room-deployment.md) for how to run one. Open: room membership/roles beyond per-principal tokens, a UI portal example (§7, §9.5).

### Notable "why" decisions recorded during implementation

- **Env injection and warm pools are mutually exclusive (agent-sandbox).**
  Setting `SandboxClaim.spec.env` requires `envVarsInjectionPolicy: Allowed`
  (default `Disallowed`) — but setting it makes the controller log *"Bypassing
  warm pool adoption because custom configuration is provided"* and build a
  **fresh** pod instead of adopting a warm one, defeating the point of
  pooling. Fix: never set claim-level env; each pooled pod mints its own
  bearer token at startup and serves it on a loopback port, which the room
  fetches once the claim binds. Needs no agent-backend change.

- **Sessions outlive their MCP connection, deliberately.** Sessions were
  originally held in a `Map` inside each `McpServer` (per connection) and
  released on connection close — correct for per-task sessions, wrong for
  agent work sessions that run 10–60 minutes, where a network blip or client
  restart would destroy a live sandbox and its uncommitted working tree. Fix:
  `SessionRegistry` is process-wide, keyed by an unguessable id, and
  authorized **by principal** rather than by connection — a reconnecting
  client re-attaches to its live sandbox by id, and the idle reaper (not
  connection close) is the sole reclaimer. Caveat: under a shared `authToken`
  every caller is `anonymous`, so that mode gives weaker session isolation
  than per-principal tokens. Consequence: the in-process registry is why
  `replicas: 1` is load-bearing (§9.2).

- **Org multi-tenancy was rejected in favor of room-as-tenant (2026-07-27).**
  Org is not a data-plane partition; the room is. Every `RoomService` method
  is room-parameterized, and the store/index are already room-scoped. A room
  may legitimately span organizations (two parties in a deal, per-individual
  access), so org-partitioned identity would *block* the motivating case
  rather than serve it — cross-org rooms need globally-addressable principals
  (OIDC subject / email), not org-namespaced user ids. Org survives only in a
  control plane above the room: billing/ownership, SSO federation, admin and
  audit queries. The enterprise "we need tenant isolation" ask is answered by
  **deployment** (a dedicated instance / self-host), not by org rows in a
  schema — customers making that ask usually want physical isolation anyway.

- **Manifests are a workspace backend, not the room abstraction (2026-07-29).**
  The first implementation made every room version a complete `path → hash`
  snapshot. That remains a good zero-database model for bounded personal/team
  workspaces that need checkout, commit, and rollback. It is not the right
  source of truth for an organization-scale, continuously-ingested catalog:
  adding one document must not require reconstructing or rewriting the entire
  corpus. `RoomService` therefore depends on a catalog seam. The manifest
  implementation is one adapter; a database-backed adapter can use document
  and document-version rows, paginated enumeration, a change log/outbox for
  indexing, and lazy materialization into sandboxes. Search, retrieval, and
  sandbox vending remain one logical room product in both modes.

- **Granular per-document ACL is coupled to scoped commits — one project, not
  two.** An ACL-filtered checkout is a partial checkout, and `commit` reflects
  the *full* working tree — so `openSession` already forces any `paths`-scoped
  session read-only to avoid silently deleting unchecked files. Under
  granular ACL, any principal who can't see every document would become
  read-only until scoped commits exist, so the two features must land
  together. It also breaks a symmetry the merge model leans on: room-level
  membership means every member's manifest view is identical, which is why
  per-file LWW works without per-viewer state. If ever needed, scope it
  read-only-first (filtered search/read; sandbox and commit still gated on
  full-room membership) — see §7 for the full tradeoff.

- **Manifest refs now include the room (fixed 2026-07-28).** `hashManifest`
  previously hashed `(parent, createdBy, entries)` — not the room — so two
  rooms committing identical content produced the *same* ref. Safe only while
  every lookup stayed room-qualified; a ref keyed into a cache, dedupe layer,
  or cross-room lookup would have conflated two rooms' histories (the same
  confused-deputy shape flagged for blobs in §7). `room` is now the first hash
  input. Not a migration — refs are opaque keys computed only at commit, never
  recomputed on read — so existing stores keep working; blob dedupe is
  unaffected (blobs stay content-addressed and not room-namespaced).

## 6. Build sequence

Dependency-first; each stage landed and verified before the next. In order:
monorepo restructure → `versioned-store` (core + S3 adapters) → `index-sync`
→ integration hardening (`BackendWorkingTree` adapter, full-loop e2e) →
`room` app (service core, MCP server, transports) → `ingestion` (PDF text,
CLIP images) → sandboxed execution (`DockerWorkspaceProvider`) → principal
attribution. **Next:** see §9.1 (multi-arch daemon image, image registry,
durable k8s storage, TLS, persistent vector index) and §9.2–9.5 for the rest
of the production gap.

## 7. Open questions / deferred

- **Org multi-tenancy — decided against (2026-07-27).** See rationale above.

- **Granular (per-document) ACL** — deferred; coupled to scoped commits (see
  above). Additional cost:
  - It breaks the symmetry the merge model leans on (every member's manifest
    view is identical, which is why per-file LWW works).
  - **Rooms substitute for it only up to a point.** Blobs are content-addressed
    and not room-namespaced, so a second room with overlapping contents is
    nearly free in storage (the standard VDR pattern — a room per audience).
    But dedupe doesn't extend to maintenance: a document in N rooms is one
    blob but N manifests, so updating it is N commits with N chances to
    conflict. Rooms handle cohort-shaped permissions; they don't handle
    per-individual exclusions shifting over time inside one shared working set.
  - Keep blob reads mediated by the room manifest — never expose a
    hash-addressed read across rooms, or the shared blob namespace becomes a
    confused deputy. Cross-room blob sharing also makes GC refcount-based and
    complicates "prove our data is deleted" when a counterparty's room shares
    the blob.
- **Long-lived / personal workspaces** — coherence of N durable checkouts. Deferred behind ephemeral.
- **Real 3-way merge** — when multiplayer heats up; grow from retained manifests.
- **Catalog adapter implementation** — the service seam now permits a database-backed catalog without manifests. The production Postgres schema, change-log/outbox worker, authorization filters, and lazy filesystem mount remain deployment-specific work. Manifest-backed rooms remain the local/workspace default.
- **`versioned-store` published name** — `@agentbe/versioned-store` is a placeholder (`private: true`).
- **Pre-existing `ty` type backlog** (13 diagnostics in `agent-backend` python) — tracked separately from the room work.
- **HEAD CAS atomicity → DynamoDB before real multiplayer/prod.** Our `S3RoomStore` CAS is correct only if the backend's conditional writes are atomic. Real AWS S3 guarantees this; **LocalStack does not** (two concurrent `casHead` on the same expected ref both won in testing — lost updates). Single-writer paths are unaffected. Decision: **defer** — correct on real AWS today; before real multiplayer or non-atomic S3-compatible stores, move HEAD ref + `casHead` to DynamoDB conditional updates. The skipped test in `packages/versioned-store/test/concurrency.integration.test.ts` re-enables against real AWS S3 or DynamoDB.
- **Partial-checkout-then-commit deletes unchecked files** — `commit` reflects the FULL working-tree state, so committing from a `paths`-scoped checkout would drop everything not materialized. The room app handles this today by forcing `paths`-scoped sessions read-only (see §5's ACL note); a future scoped-commit feature is the real fix.

## 8. Out of scope (for now)

Granular ACL, long-lived workspaces, real merge, ingestion beyond text/table, non-S3 stores, POSIX-directly-on-object-storage.

## 9. Production readiness — what's left

Everything below is verified working locally (demo, multi-room on fs and S3
tiers, k8s on kind+Calico) but not yet production-deployed. Gaps, roughly in
dependency order:

### 9.1 Blocking

1. **Multi-arch daemon image.** `ghcr.io/aspects-ai/agentbe-daemon:latest` is amd64-only — blocks arm64 nodes (Graviton) outright and forces an emulation workaround on Apple Silicon dev machines. Cheapest item here and it unblocks two others.
2. **Real image registry + versioned tags.** The k8s manifests hardcode dev tags with `imagePullPolicy: IfNotPresent`, working only via `kind load` side-loading. Needs a published, tagged room image and a real pull policy.
3. **Durable storage in the k8s path.** The example manifests mount `emptyDir`, so a room's documents die with its pod. S3 is wired and tested (`AGENTBE_S3_BUCKET`, see [docs/room-deployment.md](../docs/room-deployment.md)), just not used in the example — plus real credentials via IRSA / workload identity rather than static keys.
4. **TLS.** The room serves plain HTTP; terminate at an Ingress or load balancer. Nothing in the code needs to change, but nothing currently documents it as mandatory either (now documented in [docs/room-deployment.md](../docs/room-deployment.md)).
5. **Persistent vector index.** Without `AGENTBE_VECTOR=pg`, every restart re-embeds the entire corpus. Tolerable for a small demo; not for a GB-scale corpus.

### 9.2 Correctness and scale

6. **`replicas: 1` is load-bearing.** The session registry is in-process (see §5's "sessions outlive connections" note). Horizontal scale needs sticky routing or an externalized registry.
7. **HEAD CAS atomicity.** Correct on real AWS S3; LocalStack does not faithfully emulate conditional-write atomicity, so the concurrency test is skipped and real multiplayer is unproven (see §7).
8. **Secrets handling.** Principal tokens sit in plaintext `stringData` in a committed example manifest. Production needs an external secret store, rotation, and tokens that never enter git.

### 9.3 Operability

9. **Observability.** No metrics, tracing, or structured logs. The room's readiness probe is a bare `tcpSocket` — it reports "port open", not "room healthy".
10. **Resource limits on room pods.** Sandbox pods have CPU/memory limits; the room containers have none, so a runaway room can starve its node.
11. **Warm pool sizing.** The example pool size is a guess. Needs sizing against real concurrency, and ideally autoscaling.
12. **Blob GC and backup.** Unreferenced blobs are never collected, and there is no backup story beyond whatever S3 versioning provides.

### 9.4 Security hardening

13. **`runtimeClassName`** (gVisor / Kata) on sandbox pods — a one-line change, but it depends on node-level infrastructure (GKE Sandbox node pools or equivalent).
14. **Sandbox egress policy.** Current policy allows the public internet while denying all private ranges. The sandbox needs *no* egress today — the room streams checkout/commit bytes to it — so denying outright is available and stronger. Revisit if a direct-to-S3 sandbox ever lands.
15. **Audit logging.** Commits carry an authenticated principal, but nothing durably records session activity.

### 9.5 Product gaps (deliberately deferred)

16. **Room membership + roles** — when manual per-room token provisioning stops scaling. Deployment today is one process per room, so room isolation comes from process + token separation — sound for a modest number of orgs but manual provisioning is painful past ~ten. Planned shape: `(principal, room, role)` grants, room bound at connect via `/rooms/:room/mcp`, roles of **reader** (retrieval only, no sandbox) and **member** (sandbox + commit).
17. **Reconnect by stable address, then pause/resume** — `RemoteFilesystemBackend` already reconnects on transient drops (network blip, daemon hiccup at the same address); what's missing is reconnecting after a sandbox *resumes at a different address*, which needs agent-sandbox's stable per-sandbox network identity (`service: true` on the `SandboxTemplate`). Not an agent-backend change.
18. **Granular per-document ACL** — coupled to scoped commits; one project, not two (§7).

## 10. Cleanup backlog — in-between states

Accumulated while building; none of it breaks anything, all of it will confuse someone later.

- **Four ways to seed a room.** `room/testdata` (shared corpus), demo-room's `run.sh`, multi-room's generated per-room seeds, and k8s ConfigMaps. Should converge on one mechanism.
- **Three near-identical check harnesses.** `demo-room/smoke.mjs`, `multi-room/check.mjs`, `k8s/check.mjs` duplicate connect/retry/assert logic. Worth extracting a shared helper.
- **Two sandbox-provider labelling schemes.** Docker uses `agentbe.room.owner`; k8s uses `agentbe.room/owner`. Harmless but gratuitously different.
- **Two k8s providers on purpose** (`k8s` raw pods, `agent-sandbox` warm pool). Intentional — one is zero-install, the other needs CRDs — see [docs/room-deployment.md](../docs/room-deployment.md) for how to choose.
- **`AGENTBE_SANDBOX_PLATFORM` arm64 workaround** in demo-room/multi-room `run.sh`. Delete once the multi-arch image ships (9.1.1).
- **`@agentbe/versioned-store` is still a placeholder name**, `private: true` (§7).
- **Pre-existing Python `ty` backlog: 13 diagnostics** in `agent-backend/python`, unrelated to the room and untouched throughout.
- **`.mcp.json` points only at the demo** (`localhost:8848`); the k8s rooms live in user-local config, so the repo doesn't describe how to reach them.
- **`CONTRIBUTING.md` links to a `CODE_OF_CONDUCT.md` that does not exist** — pre-existing, unrelated to the room work, but it's a broken link on the contributor on-ramp.
- **`CHANGELOG.md` records none of this work.**
