import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { HashingEmbeddingProvider, InMemoryVectorStore } from "@agentbe/index-sync";
import { InMemoryBlobStore, InMemoryRoomStore } from "@agentbe/versioned-store";
import { afterEach, describe, expect, it } from "vitest";

import { LocalWorkspaceProvider, RoomService, serveRoomHttp } from "../src/index.js";
import type { RoomHttpHandle } from "../src/index.js";

const ROOM = "room";

const ALICE_TOKEN = "tok-alice";
const BOB_TOKEN = "tok-bob";
const PRINCIPALS = { [ALICE_TOKEN]: "alice@example.com", [BOB_TOKEN]: "bob@example.com" };

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((c) => c.text ?? "").join("");
}

/** Read back who the store actually recorded — the tool response is not proof. */
async function committedBy(rooms: InMemoryRoomStore, ref: string): Promise<string> {
  const manifest = await rooms.getManifest(ROOM, ref);
  return manifest.createdBy;
}

describe("commit attribution", () => {
  let handle: RoomHttpHandle | undefined;
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => c.close().catch(() => {})));
    clients.length = 0;
    await handle?.close().catch(() => {});
    handle = undefined;
  });

  async function start(options: Parameters<typeof serveRoomHttp>[2] = {}) {
    const rooms = new InMemoryRoomStore();
    const service = new RoomService({
      blobs: new InMemoryBlobStore(),
      rooms,
      embedder: new HashingEmbeddingProvider(),
      vectors: new InMemoryVectorStore(),
      workspaces: new LocalWorkspaceProvider(),
    });
    await service.putDocuments(ROOM, { "seed.md": "seed" }, "seed");
    handle = await serveRoomHttp(service, ROOM, options);
    return { rooms, service };
  }

  async function connect(token?: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${handle!.port}/mcp`),
      token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined,
    );
    const client = new Client({ name: "attribution-test", version: "0.0.0" });
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  it("attributes a commit to the authenticated principal", async () => {
    const { rooms } = await start({ principals: PRINCIPALS });
    const client = await connect(ALICE_TOKEN);
    const res = await client.callTool({
      name: "put_document",
      arguments: { path: "a.md", content: "alice was here" },
    });
    const ref = textOf(res).replace("committed ", "").trim();
    expect(await committedBy(rooms, ref)).toBe("alice@example.com");
  });

  it("distinguishes principals sharing one room", async () => {
    const { rooms } = await start({ principals: PRINCIPALS });
    const alice = await connect(ALICE_TOKEN);
    const bob = await connect(BOB_TOKEN);

    const aRef = textOf(
      await alice.callTool({ name: "put_document", arguments: { path: "a.md", content: "a" } }),
    )
      .replace("committed ", "")
      .trim();
    const bRef = textOf(
      await bob.callTool({ name: "put_document", arguments: { path: "b.md", content: "b" } }),
    )
      .replace("committed ", "")
      .trim();

    expect(await committedBy(rooms, aRef)).toBe("alice@example.com");
    expect(await committedBy(rooms, bRef)).toBe("bob@example.com");
  });

  it("ignores a caller-supplied author — attribution cannot be forged", async () => {
    const { rooms } = await start({ principals: PRINCIPALS });
    const client = await connect(BOB_TOKEN);
    const res = await client.callTool({
      name: "put_document",
      // Bob claims to be Alice. The schema no longer accepts `author`, and even
      // if it slipped through it must not reach the commit.
      arguments: { path: "spoof.md", content: "x", author: "alice@example.com" },
    });
    const ref = textOf(res).replace("committed ", "").trim();
    expect(await committedBy(rooms, ref)).toBe("bob@example.com");
  });

  it("attributes a warm-session commit to the session's principal", async () => {
    const { rooms } = await start({ principals: PRINCIPALS });
    const client = await connect(ALICE_TOKEN);
    const opened = await client.callTool({ name: "open_session", arguments: {} });
    const { session } = JSON.parse(textOf(opened)) as { session: string };
    await client.callTool({
      name: "run_command",
      arguments: { session, command: "echo hi > from-session.txt" },
    });
    const ref = textOf(await client.callTool({ name: "commit_session", arguments: { session } }))
      .replace("committed ", "")
      .trim();
    expect(await committedBy(rooms, ref)).toBe("alice@example.com");
    await client.callTool({ name: "close_session", arguments: { session } });
  });

  it("refuses to let another principal drive a session it did not open", async () => {
    await start({ principals: PRINCIPALS });
    const aliceTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${handle!.port}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${ALICE_TOKEN}` } } },
    );
    const alice = new Client({ name: "alice", version: "0.0.0" });
    await alice.connect(aliceTransport);
    clients.push(alice);
    const sessionId = aliceTransport.sessionId;
    expect(sessionId).toBeTruthy();

    // Bob is perfectly well authenticated — but as Bob. If this were allowed,
    // his commits would be recorded against Alice.
    const stolen = await fetch(`http://127.0.0.1:${handle!.port}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${BOB_TOKEN}`,
        "Mcp-Session-Id": sessionId!,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(stolen.status).toBe(403);
  });

  it("rejects an unknown token", async () => {
    await start({ principals: PRINCIPALS });
    await expect(connect("tok-nobody")).rejects.toBeDefined();
    await expect(connect(undefined)).rejects.toBeDefined();
  });

  it("falls back to anonymous under a shared token", async () => {
    const { rooms } = await start({ authToken: "shared" });
    const client = await connect("shared");
    const ref = textOf(
      await client.callTool({ name: "put_document", arguments: { path: "s.md", content: "s" } }),
    )
      .replace("committed ", "")
      .trim();
    // A shared secret authenticates but identifies nobody — this is exactly the
    // audit gap that per-principal tokens close.
    expect(await committedBy(rooms, ref)).toBe("anonymous");
  });
});
