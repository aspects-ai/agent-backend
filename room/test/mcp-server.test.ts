import { describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InMemoryBlobStore, InMemoryRoomStore } from "@agentbe/versioned-store";
import { HashingEmbeddingProvider, InMemoryVectorStore } from "@agentbe/index-sync";

import { LocalWorkspaceProvider, RoomService, createRoomMcpServer } from "../src/index.js";

const ROOM = "room";

function makeService(): RoomService {
  return new RoomService({
    blobs: new InMemoryBlobStore(),
    rooms: new InMemoryRoomStore(),
    embedder: new HashingEmbeddingProvider(),
    vectors: new InMemoryVectorStore(),
    workspaces: new LocalWorkspaceProvider(),
  });
}

async function connectClient(options?: { sessionIdleMs?: number }): Promise<Client> {
  const service = makeService();
  await service.putDocuments(
    ROOM,
    {
      "vendors.md": "Acme Corp vendor invoice and payment totals for the year",
      "data.txt": "one\ntwo\nthree\n",
    },
    "seed",
  );
  const server = createRoomMcpServer(service, ROOM, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((c) => c.text ?? "").join("");
}

describe("room MCP server", () => {
  it("exposes the room's tools", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "close_session",
      "commit_session",
      "list_documents",
      "open_session",
      "put_document",
      "read_document",
      "run_command",
      "search",
      "write_file",
    ]);
  });

  it("warm session persists state across commands, then commits", async () => {
    const client = await connectClient();
    const opened = await client.callTool({ name: "open_session", arguments: {} });
    const { session, canCommit } = JSON.parse(textOf(opened)) as {
      session: string;
      canCommit: boolean;
    };
    expect(canCommit).toBe(true);

    // Write a file with one command, read it back with another — same warm sandbox.
    await client.callTool({
      name: "run_command",
      arguments: { session, command: "echo hello-warm > scratch.txt" },
    });
    const cat = await client.callTool({
      name: "run_command",
      arguments: { session, command: "cat scratch.txt" },
    });
    expect(textOf(cat)).toContain("hello-warm"); // state survived across commands

    const committed = await client.callTool({ name: "commit_session", arguments: { session } });
    expect(textOf(committed)).toContain("committed");
    await client.callTool({ name: "close_session", arguments: { session } });

    // The committed artifact is now part of the room.
    const list = await client.callTool({ name: "list_documents", arguments: {} });
    expect(textOf(list)).toContain("scratch.txt");
  });

  it("a paths-scoped session is read-only and cannot commit", async () => {
    const client = await connectClient();
    const opened = await client.callTool({
      name: "open_session",
      arguments: { paths: ["vendors.md"] },
    });
    const { session, canCommit } = JSON.parse(textOf(opened)) as {
      session: string;
      canCommit: boolean;
    };
    expect(canCommit).toBe(false);
    const res = await client.callTool({ name: "commit_session", arguments: { session } });
    // MCP surfaces the tool error as an error result.
    expect(JSON.stringify(res)).toMatch(/paths-scoped|error/i);
    await client.callTool({ name: "close_session", arguments: { session } });
  });

  it("search returns relevant documents", async () => {
    const client = await connectClient();
    const res = await client.callTool({ name: "search", arguments: { query: "vendor invoice payment" } });
    expect(textOf(res)).toContain("vendors.md");
  });

  it("read_document returns contents", async () => {
    const client = await connectClient();
    const res = await client.callTool({ name: "read_document", arguments: { path: "vendors.md" } });
    expect(textOf(res)).toContain("Acme Corp");
  });

  it("run_command executes shell over a sandbox checkout", async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: "run_command",
      arguments: { command: "wc -l < data.txt", paths: ["data.txt"] },
    });
    expect(parseInt(textOf(res).trim(), 10)).toBe(3);
  });

  it("reaps a warm session left idle past the TTL", async () => {
    const client = await connectClient({ sessionIdleMs: 60 });
    const opened = await client.callTool({ name: "open_session", arguments: {} });
    const { session } = JSON.parse(textOf(opened)) as { session: string };

    // Still fresh: the session works.
    const before = await client.callTool({
      name: "run_command",
      arguments: { session, command: "echo alive" },
    });
    expect(textOf(before)).toContain("alive");

    // Go quiet past the idle window — the reaper should release the sandbox
    // even though the client never called close_session.
    await new Promise((r) => setTimeout(r, 250));

    const after = await client.callTool({
      name: "run_command",
      arguments: { session, command: "echo alive" },
    });
    expect(JSON.stringify(after)).toMatch(/unknown or closed session/);
  });

  it("does not reap a session while a command is still running", async () => {
    const client = await connectClient({ sessionIdleMs: 60 });
    const opened = await client.callTool({ name: "open_session", arguments: {} });
    const { session } = JSON.parse(textOf(opened)) as { session: string };

    // A command that outlives the idle window must not have its sandbox pulled
    // out from under it — the in-flight guard, not the timestamp, protects this.
    const slow = await client.callTool({
      name: "run_command",
      arguments: { session, command: "sleep 0.3 && echo survived" },
    });
    expect(textOf(slow)).toContain("survived");

    // And it stays usable afterwards: completing a command refreshes the clock.
    const next = await client.callTool({
      name: "run_command",
      arguments: { session, command: "echo still-here" },
    });
    expect(textOf(next)).toContain("still-here");
    await client.callTool({ name: "close_session", arguments: { session } });
  });

  it("put_document adds a version discoverable by search and listing", async () => {
    const client = await connectClient();
    const put = await client.callTool({
      name: "put_document",
      arguments: { path: "notes.md", content: "quarterly budget planning notes" },
    });
    expect(textOf(put)).toContain("committed");

    const search = await client.callTool({
      name: "search",
      arguments: { query: "quarterly budget planning" },
    });
    expect(textOf(search)).toContain("notes.md");

    const list = await client.callTool({ name: "list_documents", arguments: {} });
    expect(textOf(list)).toContain("notes.md");
  });
});
