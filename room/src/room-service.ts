import type { QueryHit } from "@agentbe/index-sync";

import { BackendWorkingTree, type BackendLike } from "./lib/backend-working-tree.js";
import {
  ManifestRoomCatalog,
  type ManifestRoomCatalogDeps,
} from "./manifest-room-catalog.js";
import type {
  DocumentPage,
  ListDocumentsOptions,
  RoomAccessContext,
  RoomCatalog,
  SearchModality,
} from "./room-catalog.js";

/** An agent-backend backend with shell execution — what a room workspace is. */
export interface RoomBackend extends BackendLike {
  exec(command: string): Promise<string | Uint8Array>;
}

/** An ephemeral workspace handed out by a {@link WorkspaceProvider}. */
export interface ProvisionedBackend {
  backend: RoomBackend;
  dispose(): Promise<void>;
}

/** Provisions ephemeral sandbox workspaces for a room. Swap the local (temp-dir)
 * implementation for a Docker/daemon one in production. */
export interface WorkspaceProvider {
  create(): Promise<ProvisionedBackend>;
  /**
   * Delete sandboxes this room owns but no longer tracks — call at startup.
   * The session registry is in-memory, so a restart forgets every live session
   * while its sandbox keeps running: a stray container locally, a pod holding
   * node capacity in k8s. Optional; providers with nothing to reclaim omit it.
   */
  reclaimOrphans?(): Promise<number>;
}

/** Backwards-compatible dependencies for the bundled manifest workspace adapter. */
export interface ManifestRoomServiceDeps extends ManifestRoomCatalogDeps {
  /** Provisions sandboxes for `openSession`/`runCommand`. Optional — a
   * retrieval/ingestion-only room needs no sandbox at all. */
  workspaces?: WorkspaceProvider;
}

/** Dependencies for a manifest-independent catalog room. */
export interface CatalogRoomServiceDeps {
  catalog: RoomCatalog;
  workspaces?: WorkspaceProvider;
}

export type RoomServiceDeps = ManifestRoomServiceDeps | CatalogRoomServiceDeps;

export interface OpenSessionOptions {
  /** Materialize only these paths (e.g. semantic-search hits). A paths-scoped
   * session is READ-ONLY. Full sessions are writable only when the selected
   * catalog implements workspace commits. */
  paths?: string[];
}

/**
 * The room engine. Composes a catalog and an ephemeral-workspace provider into
 * the operations an API or agent loop needs: ingest, search, read, materialize,
 * execute, and optionally commit. Storage, revision, and indexing mechanics
 * belong to the selected catalog adapter.
 */
export class RoomService {
  private readonly catalog: RoomCatalog;
  private readonly workspaces?: WorkspaceProvider;

  constructor(deps: RoomServiceDeps) {
    this.catalog = "catalog" in deps ? deps.catalog : new ManifestRoomCatalog(deps);
    this.workspaces = deps.workspaces;
  }

  head(room: string, context?: RoomAccessContext): Promise<string | null> {
    return this.catalog.revision(room, context);
  }

  /** Add or update documents when the catalog supports direct ingestion. */
  async putDocuments(
    room: string,
    files: Record<string, string | Uint8Array>,
    author: string,
  ): Promise<string> {
    if (!this.catalog.putDocuments) {
      throw new Error("catalog does not support direct ingestion");
    }
    return this.catalog.putDocuments(room, files, author);
  }

  /** Semantic search over a room, delegated to the selected catalog. */
  async search(
    room: string,
    query: string,
    k = 5,
    modality: SearchModality = "all",
    context?: RoomAccessContext,
  ): Promise<QueryHit[]> {
    return this.catalog.search(room, query, k, modality, context);
  }

  /** One bounded page of document paths. Prefer this for catalog-scale rooms. */
  listDocumentPage(
    room: string,
    options: ListDocumentsOptions = {},
    context?: RoomAccessContext,
  ): Promise<DocumentPage> {
    return this.catalog.listDocuments(room, options, context);
  }

  /**
   * All document paths in the room. Retained for backwards compatibility;
   * catalog-scale callers should use {@link listDocumentPage}.
   */
  async listDocuments(room: string, context?: RoomAccessContext): Promise<string[]> {
    const paths: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.catalog.listDocuments(room, { cursor, limit: 1_000 }, context);
      paths.push(...page.paths);
      if (page.nextCursor !== undefined && page.nextCursor === cursor) {
        throw new Error("catalog returned a non-advancing pagination cursor");
      }
      cursor = page.nextCursor;
    } while (cursor);
    return paths;
  }

  /** Read a single document's text contents. Needs no sandbox. */
  async readDocument(
    room: string,
    path: string,
    context?: RoomAccessContext,
  ): Promise<string> {
    return this.catalog.readDocument(room, path, context);
  }

  /** Run a shell command over a checkout of the room (one-shot, read-only — no
   * commit). Restrict the checkout with `paths` (e.g. search hits). */
  async runCommand(
    room: string,
    command: string,
    paths?: string[],
    context?: RoomAccessContext,
  ): Promise<string> {
    const session = await this.openSession(room, paths ? { paths } : {}, context);
    try {
      const output = await session.exec(command);
      return typeof output === "string" ? output : new TextDecoder().decode(output);
    } finally {
      await session.close();
    }
  }

  /**
   * Open an ephemeral sandbox over a stable catalog revision. A paths-scoped
   * session is read-only; a full session is writable only when the catalog
   * implements workspace commits.
   */
  async openSession(
    room: string,
    options: OpenSessionOptions = {},
    context?: RoomAccessContext,
  ): Promise<RoomSession> {
    if (!this.workspaces) {
      throw new Error(
        "no WorkspaceProvider configured — sessions and run_command require a sandbox provider",
      );
    }
    const provisioned = await this.workspaces.create();
    const tree = new BackendWorkingTree(provisioned.backend);
    const base = await this.catalog.revision(room, context);
    const partial = Array.isArray(options.paths);
    try {
      if (base) {
        await this.catalog.materialize(
          room,
          base,
          tree,
          partial ? { paths: options.paths } : undefined,
          context,
        );
      }
    } catch (error) {
      await provisioned.dispose().catch(() => undefined);
      throw error;
    }
    return new RoomSession({
      catalog: this.catalog,
      room,
      base,
      provisioned,
      tree,
      commitDeniedReason: partial
        ? "paths-scoped"
        : this.catalog.commitWorkspace
          ? undefined
          : "catalog-read-only",
    });
  }

  /** Ask a catalog that owns indexing to rebuild its derived index. */
  async reindexHead(room: string): Promise<void> {
    await this.catalog.reindex?.(room);
  }
}

interface RoomSessionInit {
  catalog: RoomCatalog;
  room: string;
  base: string | null;
  provisioned: ProvisionedBackend;
  tree: BackendWorkingTree;
  commitDeniedReason?: "paths-scoped" | "catalog-read-only";
}

/** A live sandbox over a room: run shell commands, read/write the working tree,
 * and (for full sessions) commit changes back. Always `close()` when done. */
export class RoomSession {
  private base: string | null;
  private closed = false;

  constructor(private readonly init: RoomSessionInit) {
    this.base = init.base;
  }

  /** The materialized working tree (agent-backend workspace via the adapter). */
  get tree(): BackendWorkingTree {
    return this.init.tree;
  }

  /** Whether this session may commit through its catalog. */
  get canCommit(): boolean {
    return this.init.commitDeniedReason === undefined;
  }

  /** Run a shell command in the workspace. */
  async exec(command: string): Promise<string | Uint8Array> {
    this.assertOpen();
    return this.init.provisioned.backend.exec(command);
  }

  /** Commit the working tree as a new room version and reindex. Returns the ref. */
  async commit(author: string): Promise<string> {
    this.assertOpen();
    if (this.init.commitDeniedReason === "paths-scoped") {
      throw new Error(
        "cannot commit a paths-scoped session: it would delete unchecked files. " +
          "Open a full session (no `paths`) for read-write work.",
      );
    }
    if (!this.init.catalog.commitWorkspace) {
      throw new Error(
        "cannot commit this session: the catalog is read-only and does not support workspace commits",
      );
    }
    const ref = await this.init.catalog.commitWorkspace(
      this.init.room,
      this.base,
      this.init.tree,
      author,
    );
    this.base = ref;
    return ref;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.init.provisioned.dispose();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("session is closed");
  }
}
