import { describe, expect, it } from "vitest";

import { BackendWorkingTree, type BackendLike } from "../src/index.js";

/** Fake that mimics agent-backend's read contract: default → UTF-8 string,
 * `{ encoding: "buffer" }` → bytes. */
class FakeBackend implements BackendLike {
  readonly rootDir = "/fake";
  private readonly files = new Map<string, Uint8Array>();

  async read(path: string, options?: { encoding?: string }): Promise<string | Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`ENOENT: ${path}`);
    return options?.encoding === "buffer" ? bytes : new TextDecoder().decode(bytes);
  }
  async write(path: string, content: string | Uint8Array): Promise<void> {
    this.files.set(
      path,
      typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content),
    );
  }
  async readdir(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async mkdir(): Promise<void> {}
  async rm(path: string): Promise<void> {
    this.files.delete(path);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async stat(path: string): Promise<{ size: number; mode: number }> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`ENOENT: ${path}`);
    return { size: bytes.byteLength, mode: 0o100644 };
  }
}

describe("BackendWorkingTree", () => {
  it("reads bytes by default even though the backend defaults to a string", async () => {
    const backend = new FakeBackend();
    const tree = new BackendWorkingTree(backend);
    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x1a]);
    await backend.write("x.png", binary);

    const out = await tree.read("x.png");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(out as Uint8Array).equals(Buffer.from(binary))).toBe(true);
  });

  it("reads text when asked", async () => {
    const tree = new BackendWorkingTree(new FakeBackend());
    await tree.write("note.md", "hello world");
    expect(await tree.read("note.md", { encoding: "utf-8" })).toBe("hello world");
  });
});
