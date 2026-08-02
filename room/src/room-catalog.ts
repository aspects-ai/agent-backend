import type { QueryHit } from "@agentbe/index-sync";
import type { WorkingTree } from "@agentbe/versioned-store";

/** Which index(es) a search covers. */
export type SearchModality = "text" | "image" | "all";

/** Authenticated caller identity used by policy-aware catalog adapters. */
export interface RoomAccessContext {
  principal: string;
}

export interface ListDocumentsOptions {
  /** Opaque adapter-defined continuation cursor. */
  cursor?: string;
  /** Maximum paths to return. Adapters should impose a defensive upper bound. */
  limit?: number;
}

export interface DocumentPage {
  paths: string[];
  /** Present when another page is available. */
  nextCursor?: string;
}

export interface MaterializeOptions {
  /** Restrict materialization to these paths. Omit for the complete corpus view. */
  paths?: string[];
}

/**
 * Storage/search boundary consumed by {@link RoomService}.
 *
 * A catalog revision is an opaque stable view identifier: a manifest ref for
 * the bundled workspace adapter, or a transaction/change-log watermark for a
 * database-backed catalog. Implementations need not use manifests or S3.
 *
 * `putDocuments`, `commitWorkspace`, and `reindex` are capabilities rather than
 * universal requirements. A large read-only organizational catalog can expose
 * search/read/materialization while ingestion and indexing run through its own
 * asynchronous control plane.
 */
export interface RoomCatalog {
  revision(room: string, context?: RoomAccessContext): Promise<string | null>;
  search(
    room: string,
    query: string,
    k?: number,
    modality?: SearchModality,
    context?: RoomAccessContext,
  ): Promise<QueryHit[]>;
  listDocuments(
    room: string,
    options?: ListDocumentsOptions,
    context?: RoomAccessContext,
  ): Promise<DocumentPage>;
  readDocument(room: string, path: string, context?: RoomAccessContext): Promise<string>;
  materialize(
    room: string,
    revision: string,
    tree: WorkingTree,
    options?: MaterializeOptions,
    context?: RoomAccessContext,
  ): Promise<void>;

  /** Direct ingestion capability. Omit when ingestion is an external job API. */
  putDocuments?(
    room: string,
    files: Record<string, string | Uint8Array>,
    author: string,
  ): Promise<string>;

  /** Writable-workspace capability. Omit for catalog/read-only rooms. */
  commitWorkspace?(
    room: string,
    base: string | null,
    tree: WorkingTree,
    author: string,
  ): Promise<string>;

  /** Rebuild derived indexes when the adapter owns indexing. */
  reindex?(room: string): Promise<void>;
}
