/**
 * The thin coupling surface between the versioned store and a sandbox.
 *
 * `checkout` materializes selected entries into a WorkingTree; `commit` reads a
 * mutated WorkingTree back out. This is the ENTIRE interface the store needs
 * from agent-backend — keeping it this small is what keeps the two libraries
 * independently useful.
 *
 * agent-backend's `FileBasedBackend` structurally satisfies this interface, so
 * a caller passes a (scoped) Backend directly with no adapter. Defined
 * structurally here to avoid a hard build dependency on agent-backend's exact
 * exports while the interface is still settling.
 */
export interface WorkingTree {
  readonly rootDir: string;
  read(path: string, options?: { encoding?: "utf-8" }): Promise<string | Uint8Array>;
  write(path: string, content: string | Uint8Array): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ size: number; mode: number }>;
}
