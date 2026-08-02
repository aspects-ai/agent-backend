# Room Catalog Adapters

`RoomService` always operates through a `RoomCatalog`. Manifests are not a
special code path inside the service: `ManifestRoomCatalog` is the bundled
catalog adapter and the backwards-compatible default.

This distinction lets the same agent-facing room API serve two different
storage shapes:

- bounded, writable personal/team workspaces backed by manifests; and
- continuously-ingested organization-scale catalogs backed by a database,
  object storage, and a derived search index.

The public interface is in
[`room/src/room-catalog.ts`](../room/src/room-catalog.ts). The bundled adapter
is in
[`room/src/manifest-room-catalog.ts`](../room/src/manifest-room-catalog.ts).

## Catalog selection

After construction, `RoomService` has exactly one catalog and delegates all
revision, ingestion, search, listing, reading, and materialization operations
to it.

### Implicit manifest catalog

The existing constructor shape remains supported:

```ts
const service = new RoomService({
  blobs,
  rooms,
  embedder,
  vectors,
  workspaces,
});
```

Because no `catalog` property is present, `RoomService` wraps those
dependencies in `ManifestRoomCatalog`. `buildRoomService()` and the bundled
`agentbe-room-mcp` executable use this path, so the local demo and current
deployment examples remain manifest-backed.

### Explicit manifest catalog

The equivalent explicit wiring is:

```ts
const catalog = new ManifestRoomCatalog({
  blobs,
  rooms,
  embedder,
  vectors,
  pdfExtractor,
  imageEmbedder,
  imageVectors,
});

const service = new RoomService({ catalog, workspaces });
```

Use the explicit form when application composition should name the selected
catalog mode directly. The implicit form exists for compatibility and local
convenience; it does not bypass the catalog abstraction.

### Database catalog

A scalable deployment supplies another implementation:

```ts
const catalog = new PostgresRoomCatalog({
  db,
  objectStore,
  searchIndex,
  materializer,
});

const service = new RoomService({ catalog, workspaces });
```

`PostgresRoomCatalog` is an intended adapter shape, not a class currently
included in this repository. Its schema, migrations, ingestion workers, and
authorization queries still need to be implemented for the consuming
platform.

## `RoomCatalog` contract

| Method | Required | Expected database-backed behavior |
|---|---:|---|
| `revision` | yes | Return an opaque stable view identifier, such as a transaction or catalog-event watermark. |
| `search` | yes | Search active document versions or chunks with room and authorization filters applied inside the query. |
| `listDocuments` | yes | Return a bounded cursor-paginated page; do not enumerate the complete corpus internally. |
| `readDocument` | yes | Authorize the principal, resolve a document version, and fetch its bytes from object storage. |
| `materialize` | yes | Resolve the authorized documents at the supplied revision and make them available in the sandbox. |
| `putDocuments` | no | Provide direct ingestion only when the adapter can honor the synchronous contract; otherwise use an external asynchronous ingestion API. |
| `commitWorkspace` | no | Implement only for catalogs that support promoting a sandbox working tree. Its absence makes sessions read-only. |
| `reindex` | no | Rebuild derived indexes when indexing is owned by the adapter. |

Optional methods are capabilities. `RoomService` does not infer them:

- without `putDocuments`, `put_document` reports that direct ingestion is not
  supported;
- without `commitWorkspace`, even a full sandbox session has
  `canCommit: false`; and
- a paths-scoped session is always read-only.

`listDocuments()` remains as a compatibility helper that follows every page.
Catalog-scale callers and the MCP tool use `listDocumentPage()` instead.

## Identity and access control

The transport-derived principal is passed to catalog reads through
`RoomAccessContext`:

```ts
interface RoomAccessContext {
  principal: string;
}
```

The MCP server supplies this context to `revision`, `search`, document
listing, `readDocument`, and sandbox materialization. A database adapter should
resolve the principal's organization/room/document grants in Postgres and
apply them before returning paths, search hits, bytes, or a filesystem view.
Filtering results after retrieval is not sufficient because paths, scores,
and mounted files can themselves disclose unauthorized data.

The manifest adapter ignores `RoomAccessContext`; its standalone isolation is
still provided by the current one-process/credential-set-per-room deployment.

## Expected scalable data model

Exact schema design belongs to the platform, but the adapter is expected to
compose records resembling:

```text
rooms
  id, owner_org_id, current_revision

documents
  id, owner_org_id, path, current_version_id, metadata, status

document_versions
  id, document_id, revision, blob_key, content_hash, content_type

room_documents
  room_id, document_id, added_revision, removed_revision

catalog_events / outbox
  sequence, room_id, document_id, version_id, operation

document_chunks / search records
  document_version_id, ordinal, modality, extracted_text,
  embedding_model, pipeline_version, embedding
```

An ingestion transaction should create or update document/version records,
advance the room revision, and append an outbox event atomically. Workers can
then extract multimodal content and update the derived search index without
requiring complete `path -> hash` snapshots.

The search index is not the authority for ownership or access. It either joins
to authoritative relational records or carries denormalized filter fields
whose lifecycle is driven from the same Postgres transaction/outbox.

## Revision and session behavior

The `revision` string generalizes manifest `HEAD`. A database adapter can use a
monotonic catalog sequence, transaction-derived token, or another stable
watermark. `materialize(room, revision, ...)` should resolve document versions
consistently with that view so a session does not silently mix unrelated
catalog states.

A read-only catalog normally omits `commitWorkspace`. Agents can still modify
their private sandbox, but durable publication should happen through a
separate validated output API or into a manifest-backed workspace room.

## Selective download and lazy mounts

The current `materialize` contract receives a `WorkingTree`, which directly
supports selective downloading:

```ts
async materialize(room, revision, tree, options, context) {
  const documents = await resolveAuthorizedDocuments({
    room,
    revision,
    paths: options?.paths,
    principal: context?.principal,
  });

  for (const document of documents) {
    await tree.write(document.path, await objectStore.get(document.blobKey));
  }
}
```

A FUSE/Archil-style lazy mount needs an additional workspace or materializer
capability because `WorkingTree` does not currently expose `mount()`. The
authorization responsibility remains the same: the mounted namespace must
already be restricted to everything the principal may discover. Canonical
source data should normally be mounted read-only, with a separate private
writable workspace for session artifacts.

## Migration guidance

To adapt a manifest deployment without changing the agent tool surface:

1. Implement `RoomCatalog` over Postgres, object storage, and the chosen search
   service.
2. Make every required read principal-aware and enforce access inside the
   underlying query.
3. Use document/version rows and a monotonic revision rather than serializing
   the complete room membership on every change.
4. Move ingestion and indexing to transactional outbox-driven workers; omit
   `putDocuments` until its desired asynchronous API is defined.
5. Implement selective `materialize` first. Add a mount-capable workspace seam
   before introducing lazy whole-corpus mounts.
6. Omit `commitWorkspace` for the organizational catalog and publish agent
   outputs through a controlled path.
7. Construct `RoomService({ catalog, workspaces })`. Search, retrieval, MCP,
   session identity, and sandbox lifecycle remain unchanged above the adapter.

