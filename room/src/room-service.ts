import {
  DefaultVersionedStore,
  InMemoryWorkingTree,
  type BlobStore,
  type RoomStore,
} from "@agentbe/versioned-store";
import {
  IndexSync,
  type EmbeddingProvider,
  type QueryHit,
  type VectorStore,
} from "@agentbe/index-sync";

import { BackendWorkingTree, type BackendLike } from "./lib/backend-working-tree.js";

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
}

export interface RoomServiceDeps {
  blobs: BlobStore;
  rooms: RoomStore;
  embedder: EmbeddingProvider;
  vectors: VectorStore;
  /** Provisions sandboxes for `openSession`/`runCommand`. Optional — a
   * retrieval/ingestion-only room needs no sandbox at all. */
  workspaces?: WorkspaceProvider;
}

export interface OpenSessionOptions {
  /** Materialize only these paths (e.g. semantic-search hits). A paths-scoped
   * session is READ-ONLY — committing it would delete unchecked files. */
  paths?: string[];
}

/**
 * The room engine. Composes the versioned store, the search index, and an
 * ephemeral-workspace provider into the high-level operations an API or agent
 * loop needs: add documents, search, and open a sandbox session to run code and
 * optionally commit changes back. Each version is reindexed automatically.
 */
export class RoomService {
  private readonly store: DefaultVersionedStore;
  private readonly index: IndexSync;

  constructor(private readonly deps: RoomServiceDeps) {
    this.store = new DefaultVersionedStore(deps.blobs, deps.rooms);
    this.index = new IndexSync(deps.blobs, deps.rooms, deps.embedder, deps.vectors);
  }

  head(room: string): Promise<string | null> {
    return this.deps.rooms.head(room);
  }

  /**
   * Add or update documents, producing a new room version. Existing documents
   * are preserved (a full checkout of HEAD precedes the writes), so this never
   * accidentally drops files.
   */
  async putDocuments(
    room: string,
    files: Record<string, string | Uint8Array>,
    author: string,
  ): Promise<string> {
    // Ingestion needs no sandbox — just write + commit against an in-memory tree.
    const tree = new InMemoryWorkingTree();
    const base = await this.deps.rooms.head(room);
    if (base) await this.store.checkout(room, base, tree);
    for (const [path, content] of Object.entries(files)) await tree.write(path, content);
    const result = await this.store.commit(room, base, tree, author);
    if (result.status !== "committed") throw new Error(`commit failed: ${result.status}`);
    await this.reindex(room, base, result.ref);
    return result.ref;
  }

  /** Semantic search over a room; returns paths/hashes to open in a session. */
  search(room: string, query: string, k = 5): Promise<QueryHit[]> {
    return this.index.query(room, query, k);
  }

  /** All document paths in the room's current version (empty if the room is new). */
  async listDocuments(room: string): Promise<string[]> {
    const head = await this.deps.rooms.head(room);
    if (!head) return [];
    const manifest = await this.deps.rooms.getManifest(room, head);
    return Object.keys(manifest.entries).sort();
  }

  /** Read a single document's text contents. Needs no sandbox. */
  async readDocument(room: string, path: string): Promise<string> {
    const base = await this.deps.rooms.head(room);
    if (!base) throw new Error(`document not found: ${path}`);
    const tree = new InMemoryWorkingTree();
    await this.store.checkout(room, base, tree, { paths: [path] });
    return (await tree.read(path, { encoding: "utf-8" })) as string;
  }

  /** Run a shell command over a checkout of the room (one-shot, read-only — no
   * commit). Restrict the checkout with `paths` (e.g. search hits). */
  async runCommand(room: string, command: string, paths?: string[]): Promise<string> {
    const session = await this.openSession(room, paths ? { paths } : {});
    try {
      const output = await session.exec(command);
      return typeof output === "string" ? output : new TextDecoder().decode(output);
    } finally {
      await session.close();
    }
  }

  /**
   * Open an ephemeral sandbox session over a room's current HEAD. With `paths`
   * it materializes only that subset and the session is read-only; without,
   * it's a full checkout that can commit changes back.
   */
  async openSession(room: string, options: OpenSessionOptions = {}): Promise<RoomSession> {
    if (!this.deps.workspaces) {
      throw new Error(
        "no WorkspaceProvider configured — sessions and run_command require a sandbox provider",
      );
    }
    const provisioned = await this.deps.workspaces.create();
    const tree = new BackendWorkingTree(provisioned.backend);
    const base = await this.deps.rooms.head(room);
    const partial = Array.isArray(options.paths);
    if (base) {
      await this.store.checkout(room, base, tree, partial ? { paths: options.paths } : undefined);
    }
    return new RoomSession({
      store: this.store,
      reindex: (from, to) => this.reindex(room, from, to),
      room,
      base,
      provisioned,
      tree,
      commitAllowed: !partial,
    });
  }

  private async reindex(room: string, from: string | null, to: string): Promise<void> {
    if (from) await this.index.syncDiff(room, from, to);
    else await this.index.sync(room, to);
  }
}

interface RoomSessionInit {
  store: DefaultVersionedStore;
  reindex: (from: string | null, to: string) => Promise<void>;
  room: string;
  base: string | null;
  provisioned: ProvisionedBackend;
  tree: BackendWorkingTree;
  commitAllowed: boolean;
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

  /** Whether this session may commit (false for paths-scoped read-only sessions). */
  get canCommit(): boolean {
    return this.init.commitAllowed;
  }

  /** Run a shell command in the workspace. */
  async exec(command: string): Promise<string | Uint8Array> {
    this.assertOpen();
    return this.init.provisioned.backend.exec(command);
  }

  /** Commit the working tree as a new room version and reindex. Returns the ref. */
  async commit(author: string): Promise<string> {
    this.assertOpen();
    if (!this.init.commitAllowed) {
      throw new Error(
        "cannot commit a paths-scoped session: it would delete unchecked files. " +
          "Open a full session (no `paths`) for read-write work.",
      );
    }
    const result = await this.init.store.commit(this.init.room, this.base, this.init.tree, author);
    if (result.status !== "committed") throw new Error(`commit failed: ${result.status}`);
    await this.init.reindex(this.base, result.ref);
    this.base = result.ref;
    return result.ref;
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
