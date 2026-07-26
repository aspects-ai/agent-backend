import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Spawns the *built* bin as a real subprocess and drives it over real stdio —
// the same path Claude Code uses. Requires `pnpm --filter @agentbe/room build`.
const binPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "bin.js");

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((c) => c.text ?? "").join("");
}

function envWith(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") base[k] = v;
  return { ...base, ...extra };
}

async function connect(storeDir: string, embedder = "hash"): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [binPath],
    env: envWith({
      AGENTBE_STORE_DIR: storeDir,
      AGENTBE_EMBEDDER: embedder,
      AGENTBE_IMAGE_EMBEDDER: "none",
    }),
  });
  const client = new Client({ name: "e2e", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

function scoreOf(searchText: string, path: string): number {
  const line = searchText.split("\n").find((l) => l.startsWith(path));
  const match = line?.match(/score (-?\d+\.\d+)/);
  return match ? parseFloat(match[1]!) : Number.NEGATIVE_INFINITY;
}

describe("runnable stdio MCP server (real subprocess)", () => {
  let dir: string;
  let client: Client;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "room-bin-"));
    client = await connect(dir);
  });
  afterAll(async () => {
    await client?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("boots, seeds, and exposes tools over real stdio", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("search");
    expect(tools.map((t) => t.name)).toContain("run_command");
  });

  it("search finds the seeded contract corpus", async () => {
    const res = await client.callTool({
      name: "search",
      arguments: { query: "vendor payment terms net-30 invoice" },
    });
    expect(textOf(res)).toMatch(/contracts\//);
  });

  it("run_command analyzes the seeded CSV in a real sandbox", async () => {
    const res = await client.callTool({
      name: "run_command",
      arguments: { command: "wc -l < data/ag_exports.csv", paths: ["data/ag_exports.csv"] },
    });
    expect(parseInt(textOf(res).trim(), 10)).toBeGreaterThan(0);
  });
});

describe("semantic search via the local embedder (real model, real bin)", () => {
  it("ranks a topically-related doc above an unrelated one despite few shared words", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "room-semantic-"));
    try {
      const client = await connect(dir, "local");
      const res = await client.callTool({
        name: "search",
        arguments: { query: "why do customers churn and cancel their subscription" },
      });
      const text = textOf(res);
      // The interview notes (churn/renewal/onboarding) must out-score the
      // unrelated agricultural-exports CSV — semantic, not keyword, matching.
      expect(scoreOf(text, "research/customer-interviews-q1.md")).toBeGreaterThan(
        scoreOf(text, "data/ag_exports.csv"),
      );
      await client.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("persistence across restarts (fs store)", () => {
  it("keeps committed documents after a restart and reindexes them", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "room-persist-"));
    try {
      // Boot 1: commit a document, then disconnect (subprocess exits).
      const first = await connect(dir);
      await first.callTool({
        name: "put_document",
        arguments: { path: "persisted.md", content: "this document survives a restart" },
      });
      await first.close();

      // Boot 2: same store dir → document is still present and searchable.
      const second = await connect(dir);
      const list = await second.callTool({ name: "list_documents", arguments: {} });
      expect(textOf(list)).toContain("persisted.md");
      const search = await second.callTool({
        name: "search",
        arguments: { query: "document survives a restart" },
      });
      expect(textOf(search)).toContain("persisted.md");
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
