# Room Architecture

The agent document room is a multiplayer, versioned, semantically-searchable,
multimodal document store with a sandbox attached. A corpus of documents (text,
images, later audio/video) lives in a shared **room**; agents discover across
it with semantic search and pull a working subset into a POSIX sandbox to run
code and shell against. To the agent this is one logical corpus plus a shell —
underneath, distinct systems compose to produce it.

Driving use cases:
- **Read-heavy corpus** (contracts, spreadsheets) — semantic search finds
  relevant documents, then code/CLI parses them. No write concerns.
- **Read-write research workspace** — a team's shared transcripts and notes,
  today a Git repo forcing agents to run locally. The room decouples execution
  from the laptop: working tree and shell live server-side, shared.

For environment variables, deployment topology, and operational constraints,
see [room-deployment.md](room-deployment.md). For catalog adapter wiring and
the scalable database-backed shape, see [room-catalogs.md](room-catalogs.md).
For the decision history and open questions, see
[specs/agent-document-room.md](../specs/agent-document-room.md).

## The six seams

The room is an orchestrator composing six concerns, deliberately kept as
separate systems. Nothing but the orchestrator (`RoomService`) knows about all
six — this is what lets each one be swapped (store backend, embedder, sandbox
provider) without the others noticing.

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

- **Store** — content-addressed blobs plus versioned manifests on S3 (or, for
  dev, the filesystem). Durable, dedupe-for-free, and the only place raw media
  lives.
- **Index** — a semantic/lexical index kept in step with manifests, keyed by
  blob hash. Derived and rebuildable; never the source of truth.
- **Ingestion** — per-asset extraction (PDF text today; OCR/transcription
  planned) that turns raw media into a searchable sibling file.
- **Sandbox** — a POSIX working tree with shell access, materialized from a
  checkout. This is where agent code actually runs.
- **Transport** — how an agent reaches the room: an MCP server over stdio or
  streamable HTTP.
- **Identity** — who is acting, derived from the transport credential and
  attached to every commit.

Each seam is a narrow interface. `RoomService` consumes `RoomCatalog` and
`WorkspaceProvider`; the bundled manifest adapter composes `BlobStore`/
`RoomStore`, `EmbeddingProvider`/`VectorStore`, and `PdfExtractionProvider`.
A production swap — a database catalog in place of manifests, S3 in place of
the filesystem, or a Docker container in place of a temp dir — touches an
adapter rather than the service API.

At the service boundary, storage and indexing compose behind a `RoomCatalog`.
There are two intended catalog shapes:

- **Workspace catalog** — the manifest-on-S3 adapter below. It is the
  zero-database default for bounded personal/team rooms and supports full
  checkout and commit-back.
- **Database catalog** — document/document-version rows, paginated listing, a
  change log or outbox for index synchronization, and selective or lazy
  sandbox materialization. It does not require a complete room snapshot and is
  the intended shape for continuously-ingested organization-scale corpora.

Both expose the same room operations (ingest, search, read, materialize, and
optionally commit). A catalog that does not implement workspace commits vends
read-only sessions; agents publish outputs through a separate controlled path.
The authenticated principal is passed into catalog reads, search, listing, and
materialization so a database adapter can apply its Postgres-owned access
policy inside the query rather than filtering unauthorized results afterward.

## Manifest-on-S3 workspace model

For the workspace adapter, each room version is a **manifest**: a snapshot mapping path → content hash,
content-addressed itself (its own hash becomes a commit ref). Raw blobs live
under a content-hash key, shared across paths, rooms, and versions — the same
bytes are stored once no matter how many places reference them.

This is deliberately **not Git**. A room commits per task from many
concurrent, short-lived checkouts; Git's headline value — three-way merge — is
of little use when history is this granular and conflicting edits are
resolved by policy rather than by hand, while Git's binary/file-count
liabilities remain. A manifest snapshot plus **per-file last-writer-wins**
merge keeps the model simple without closing the door on real three-way merge
later (retained manifests make that an additive change, not a rewrite).

Manifests are not required by the room abstraction. A database catalog can use
a transaction/revision as its current version and an event stream for changed
documents. This avoids rewriting an O(total documents) snapshot for every
catalog update while preserving rebuildable search indexes and reproducible
document versions.

HEAD is advanced by **compare-and-swap**: a commit reads the current HEAD,
computes a new manifest against that base, and writes it back conditionally
(S3 conditional PUT, or a small DB for stores that can't do that atomically).
A CAS conflict — someone else committed first — triggers a bounded
merge-and-retry: touched paths from the losing commit are reapplied over the
new HEAD, non-overlapping changes survive untouched, and only a genuine
same-path conflict surfaces as an error.

Manifest refs are **global identifiers**: the room is hashed as part of the
ref, so two rooms committing identical content never collide, and a ref
sitting in a cache or cross-room lookup can't conflate two rooms' histories.
Blob addresses stay un-namespaced — a blob shared by two rooms is one copy
either way — but reads are always mediated by a room's own manifest, so a
hash is never a valid cross-room read path.

## The checkout → exec → commit-back loop

This is the agent loop the room exists to support:

1. **Query** the index for paths/hashes relevant to the task. The index is a
   service call, not something inside the sandbox.
2. **Checkout** — materialize those paths (or the whole room) into a fresh
   sandbox working tree, diffed against the current manifest.
3. **Exec** — run shell or code against the working set inside the sandbox.
4. **Commit-back** — diff the working tree against the base manifest, upload
   any new/changed blobs, write a new manifest, CAS-advance HEAD.
5. **Reindex** — sync only the changed paths (hash-keyed, so unchanged blobs
   are never re-embedded).

Two checkout shapes fall out of this, and they have different write
semantics:

- **Full checkout** (no `paths`) — read-write. A commit reflects the *entire*
  working tree, so a session that saw everything can safely commit.
- **Partial checkout** (`paths` given, e.g. search hits) — **read-only**. If a
  scoped checkout could commit, the missing paths would look deleted in the
  new manifest. `openSession` enforces this by refusing to commit a
  paths-scoped session — the caller must open a full session to write.

Sessions are **warm**: a session persists across multiple `exec`/`write_file`
calls against the same live sandbox, rather than provisioning fresh state per
command. This matters because an agent work session runs for tens of
minutes — provisioning a sandbox per shell command would be both slow and
unable to hold intermediate state (an unstaged file, a running process).

## Isolation model

Three principles compose to make the room safe to multi-tenant:

**The room is the tenant, not the organization.** Every `RoomService` method
is room-scoped (the store lays out `rooms/<room>/HEAD` and
`rooms/<room>/manifests/`; the index is room-scoped). A room may legitimately
span organizations — two counterparties in a deal — so organization is never
a data-plane partition; it survives only in a control plane above the room
(billing, SSO federation, admin/audit). Physical isolation between customers
is a deployment decision (one room, one process, one token set), not a schema
column. See [specs/agent-document-room.md §7](../specs/agent-document-room.md)
for why granular per-document ACL and org multi-tenancy were both rejected as
data-plane features.

**Per-session sandbox isolation.** Each session gets its own sandbox instance
(container or pod) rather than a shared daemon scoped by request path — scoping
only changes a working directory, it does not contain `exec`. Concurrent
sessions therefore cannot see each other's filesystem or processes, and
closing a session tears down its instance entirely. A sandbox holds no store
credentials: the room streams checkout/commit bytes to it over the daemon
connection, so a compromised sandbox has no path to the canonical store.

**Principal-derived attribution.** The identity attached to a commit
(`manifest.createdBy`) is derived from the transport credential and fixed for
the life of a connection — it is never a caller-suppliable tool argument, so
it cannot be forged. A session additionally records the principal that opened
it; a request authenticated as someone else is rejected (403) rather than
silently attributed to the session's owner. Sessions are process-wide and
keyed by an unguessable id rather than by connection, so a reconnecting
client can re-attach to its own live sandbox — but this makes the principal
check the *actual* isolation boundary in place of connection scoping, which is
why it's enforced on every session operation, not just at open time.

Together these mean: process/token separation is what isolates one customer's
room from another; container/pod separation is what isolates one agent's
in-flight work from another's within a room; and principal binding is what
keeps a session's identity and its audit trail honest.
