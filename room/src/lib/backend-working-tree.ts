import type { WorkingTree } from "@agentbe/versioned-store";

/**
 * The slice of an agent-backend `FileBasedBackend` this adapter consumes.
 * Declared structurally so the store stays decoupled from agent-backend — any
 * object with these methods (a Backend, a scoped Backend) works.
 */
export interface BackendLike {
  readonly rootDir?: string;
  read(path: string, options?: { encoding?: string }): Promise<string | Uint8Array>;
  write(path: string, content: string | Uint8Array): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ size: number; mode: number }>;
}

/**
 * Adapts an agent-backend `Backend` to versioned-store's `WorkingTree`.
 *
 * The one thing that actually needs adapting: agent-backend's `read(path)`
 * defaults to a UTF-8 *string*, but the store content-addresses raw *bytes*.
 * So a byte read here forces `{ encoding: "buffer" }` and normalizes to
 * `Uint8Array`; a text read passes through. `write` coerces to a Buffer, and
 * `stat` narrows agent-backend's fat `fs.Stats` to `{ size, mode }`.
 */
export class BackendWorkingTree implements WorkingTree {
  readonly rootDir: string;

  constructor(private readonly backend: BackendLike) {
    this.rootDir = backend.rootDir ?? "/";
  }

  async read(path: string, options?: { encoding?: "utf-8" }): Promise<string | Uint8Array> {
    if (options?.encoding === "utf-8") {
      const result = await this.backend.read(path, { encoding: "utf8" });
      return typeof result === "string" ? result : new TextDecoder().decode(result);
    }
    const result = await this.backend.read(path, { encoding: "buffer" });
    return typeof result === "string" ? new TextEncoder().encode(result) : new Uint8Array(result);
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    await this.backend.write(path, typeof content === "string" ? content : Buffer.from(content));
  }

  async readdir(path: string): Promise<string[]> {
    return this.backend.readdir(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.backend.mkdir(path, options);
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await this.backend.rm(path, options);
  }

  async exists(path: string): Promise<boolean> {
    return this.backend.exists(path);
  }

  async stat(path: string): Promise<{ size: number; mode: number }> {
    const s = await this.backend.stat(path);
    return { size: s.size, mode: s.mode };
  }
}
