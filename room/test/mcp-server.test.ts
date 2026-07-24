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

async function connectClient(): Promise<Client> {
  const service = makeService();
  await service.putDocuments(
    ROOM,
    {
      "vendors.md": "Acme Corp vendor invoice and payment totals for the year",
      "data.txt": "one\ntwo\nthree\n",
    },
    "seed",
  );
  const server = createRoomMcpServer(service, ROOM);
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
      "list_documents",
      "put_document",
      "read_document",
      "run_command",
      "search",
    ]);
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
