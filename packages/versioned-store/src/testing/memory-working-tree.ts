import posix from "node:path/posix";

import type { WorkingTree } from "../working-tree.js";

interface FileNode {
  content: Uint8Array;
  mode: number;
}

const FILE_MODE = 0o100644;
const DIR_MODE = 0o040755;

/**
 * In-memory WorkingTree fake. Directories are implicit (derived from file
 * paths); stat() reports POSIX type bits so walkFiles can distinguish them.
 */
export class InMemoryWorkingTree implements WorkingTree {
  readonly rootDir = "/";
  private readonly files = new Map<string, FileNode>();

  private norm(path: string): string {
    let n = posix.normalize(path);
    if (n.startsWith("./")) n = n.slice(2);
    if (n === ".") n = "";
    return n.replace(/\/+$/, "");
  }

  private toBytes(content: string | Uint8Array): Uint8Array {
    return typeof content === "string" ? new TextEncoder().encode(content) : content.slice();
  }

  async read(path: string, options?: { encoding?: "utf-8" }): Promise<string | Uint8Array> {
    const node = this.files.get(this.norm(path));
    if (!node) throw new Error(`ENOENT: ${path}`);
    return options?.encoding === "utf-8" ? new TextDecoder().decode(node.content) : node.content.slice();
  }

  async write(path: string, content: string | Uint8Array): Promise<void> {
    const norm = this.norm(path);
    const existing = this.files.get(norm);
    this.files.set(norm, { content: this.toBytes(content), mode: existing?.mode ?? FILE_MODE });
  }

  async readdir(path: string): Promise<string[]> {
    const dir = this.norm(path);
    const prefix = dir === "" ? "" : `${dir}/`;
    const children = new Set<string>();
    for (const key of this.files.keys()) {
      if (dir !== "" && !key.startsWith(prefix)) continue;
      const rest = dir === "" ? key : key.slice(prefix.length);
      const seg = rest.split("/")[0];
      if (seg) children.add(seg);
    }
    return [...children];
  }

  async mkdir(): Promise<void> {
    // Directories are implicit; nothing to materialize.
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const norm = this.norm(path);
    if (this.files.delete(norm)) return;
    if (options?.recursive) {
      const prefix = `${norm}/`;
      for (const key of [...this.files.keys()]) {
        if (key.startsWith(prefix)) this.files.delete(key);
      }
      return;
    }
    if (!options?.force) throw new Error(`ENOENT: ${path}`);
  }

  async exists(path: string): Promise<boolean> {
    const norm = this.norm(path);
    if (norm === "" || this.files.has(norm)) return true;
    const prefix = `${norm}/`;
    for (const key of this.files.keys()) if (key.startsWith(prefix)) return true;
    return false;
  }

  async stat(path: string): Promise<{ size: number; mode: number }> {
    const norm = this.norm(path);
    const node = this.files.get(norm);
    if (node) return { size: node.content.byteLength, mode: node.mode };
    if (norm === "") return { size: 0, mode: DIR_MODE };
    const prefix = `${norm}/`;
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return { size: 0, mode: DIR_MODE };
    }
    throw new Error(`ENOENT: ${path}`);
  }
}
