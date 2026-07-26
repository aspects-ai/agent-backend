import { afterEach, describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { buildRoomService, serveRoomHttp } from "../src/index.js";
import type { RoomHttpHandle } from "../src/index.js";

const ROOM = "room";

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((c) => c.text ?? "").join("");
}

async function startServer(authToken?: string): Promise<RoomHttpHandle> {
  const service = buildRoomService();
  await service.putDocuments(
    ROOM,
    { "vendors.md": "Acme vendor invoice payment terms", "data.txt": "one\ntwo\nthree\n" },
    "seed",
  );
  return serveRoomHttp(service, ROOM, { authToken });
}

async function connect(port: number, authToken?: string): Promise<Client> {
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const transport = new StreamableHTTPClientTransport(
    url,
    authToken ? { requestInit: { headers: { Authorization: `Bearer ${authToken}` } } } : undefined,
  );
  const client = new Client({ name: "http-e2e", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("room MCP over streamable HTTP", () => {
  let handle: RoomHttpHandle | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close().catch(() => {});
    await handle?.close().catch(() => {});
    client = undefined;
    handle = undefined;
  });

  it("serves tools and search over HTTP", async () => {
    handle = await startServer();
    client = await connect(handle.port);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("search");
    const res = await client.callTool({
      name: "search",
      arguments: { query: "vendor invoice payment" },
    });
    expect(textOf(res)).toContain("vendors.md");
  });

  it("keeps a warm session across separate HTTP requests (stateful)", async () => {
    handle = await startServer();
    client = await connect(handle.port);
    const opened = await client.callTool({ name: "open_session", arguments: {} });
    const { session } = JSON.parse(textOf(opened)) as { session: string };

    // Two separate HTTP requests, same server-side session/sandbox.
    await client.callTool({
      name: "run_command",
      arguments: { session, command: "echo http-warm > s.txt" },
    });
    const cat = await client.callTool({
      name: "run_command",
      arguments: { session, command: "cat s.txt" },
    });
    expect(textOf(cat)).toContain("http-warm");
    await client.callTool({ name: "close_session", arguments: { session } });
  });

  it("enforces bearer auth when configured", async () => {
    handle = await startServer("secret-token");
    await expect(connect(handle.port)).rejects.toBeDefined(); // no token
    client = await connect(handle.port, "secret-token"); // correct token
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});
