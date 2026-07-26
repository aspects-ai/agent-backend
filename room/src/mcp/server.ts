import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { RoomService, RoomSession } from "../room-service.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function decode(output: string | Uint8Array): string {
  return typeof output === "string" ? output : new TextDecoder().decode(output);
}

/**
 * Build an MCP server exposing a single data room to an agent: semantic search,
 * document reads, and sandboxed execution. Execution comes in two flavors — a
 * one-shot `run_command`, and **warm sessions** (`open_session` → repeated
 * `run_command`/`write_file` against the *same* live sandbox → `commit_session`)
 * so state persists across commands. This is the room's primary delivery surface.
 */
export function createRoomMcpServer(service: RoomService, room: string): McpServer {
  const server = new McpServer({ name: `agentbe-room:${room}`, version: "0.0.0" });

  // Warm sessions held for the life of this connection (or until close_session).
  const sessions = new Map<string, RoomSession>();
  const requireSession = (id: string): RoomSession => {
    const session = sessions.get(id);
    if (!session) throw new Error(`unknown or closed session: ${id}`);
    return session;
  };

  server.registerTool(
    "search",
    {
      description:
        "Semantic search over the room. `modality` selects documents (text), images, or both (default) — text queries match images via CLIP. Returns ranked file paths.",
      inputSchema: {
        query: z.string().describe("Natural-language query."),
        limit: z.number().int().positive().optional().describe("Max results (default 5)."),
        modality: z
          .enum(["text", "image", "all"])
          .optional()
          .describe("Search text docs, images, or both (default all)."),
      },
    },
    async ({ query, limit, modality }) => {
      const hits = await service.search(room, query, limit ?? 5, modality ?? "all");
      return textResult(
        hits.length
          ? hits.map((h) => `${h.path}\t(score ${h.score.toFixed(3)})`).join("\n")
          : "(no matches)",
      );
    },
  );

  server.registerTool(
    "list_documents",
    { description: "List all document paths currently in the room.", inputSchema: {} },
    async () => {
      const docs = await service.listDocuments(room);
      return textResult(docs.length ? docs.join("\n") : "(empty room)");
    },
  );

  server.registerTool(
    "read_document",
    {
      description: "Read a document's text contents by path.",
      inputSchema: { path: z.string().describe("Document path within the room.") },
    },
    async ({ path }) => textResult(await service.readDocument(room, path)),
  );

  server.registerTool(
    "run_command",
    {
      description:
        "Run a shell command over a sandbox checkout of the room. With `session`, runs in that warm session (state persists across commands). Without, it's a one-shot read-only checkout (optionally restricted to `paths`, e.g. search hits).",
      inputSchema: {
        command: z.string().describe("Shell command to run in the workspace."),
        session: z.string().optional().describe("Warm session id from open_session."),
        paths: z
          .array(z.string())
          .optional()
          .describe("One-shot only: restrict the checkout to these paths."),
      },
    },
    async ({ command, session, paths }) => {
      if (session) return textResult(decode(await requireSession(session).exec(command)));
      return textResult(await service.runCommand(room, command, paths));
    },
  );

  server.registerTool(
    "open_session",
    {
      description:
        "Open a warm sandbox session over the room. Without `paths` it's a full read-write checkout that can commit; with `paths` it's a read-only scoped checkout. Returns a session id; close it with close_session.",
      inputSchema: {
        paths: z
          .array(z.string())
          .optional()
          .describe("Restrict to these paths (makes the session read-only)."),
      },
    },
    async ({ paths }) => {
      const session = await service.openSession(room, paths ? { paths } : {});
      const id = randomUUID();
      sessions.set(id, session);
      return textResult(JSON.stringify({ session: id, canCommit: session.canCommit }));
    },
  );

  server.registerTool(
    "write_file",
    {
      description: "Write a file in a warm session's workspace (stage it before committing).",
      inputSchema: {
        session: z.string().describe("Warm session id."),
        path: z.string().describe("Path within the workspace."),
        content: z.string().describe("Text contents."),
      },
    },
    async ({ session, path, content }) => {
      await requireSession(session).tree.write(path, content);
      return textResult(`wrote ${path}`);
    },
  );

  server.registerTool(
    "commit_session",
    {
      description:
        "Commit a warm session's working tree as a new room version (and reindex). Read-only sessions cannot commit.",
      inputSchema: {
        session: z.string().describe("Warm session id."),
        author: z.string().optional().describe("Commit attribution."),
      },
    },
    async ({ session, author }) => {
      const ref = await requireSession(session).commit(author ?? "mcp-agent");
      return textResult(`committed ${ref}`);
    },
  );

  server.registerTool(
    "close_session",
    {
      description: "Close a warm session and release its sandbox.",
      inputSchema: { session: z.string().describe("Warm session id.") },
    },
    async ({ session }) => {
      const held = sessions.get(session);
      if (held) {
        await held.close();
        sessions.delete(session);
      }
      return textResult("closed");
    },
  );

  server.registerTool(
    "put_document",
    {
      description:
        "Add or update a document, creating a new version of the room. Returns the new version ref.",
      inputSchema: {
        path: z.string().describe("Document path within the room."),
        content: z.string().describe("Text contents to write."),
        author: z.string().optional().describe("Attribution for the commit."),
      },
    },
    async ({ path, content, author }) => {
      const ref = await service.putDocuments(room, { [path]: content }, author ?? "mcp-agent");
      return textResult(`committed ${ref}`);
    },
  );

  // Best-effort cleanup: release any warm sandboxes when the connection closes.
  const priorOnClose = server.server.onclose?.bind(server.server);
  server.server.onclose = () => {
    for (const session of sessions.values()) void session.close();
    sessions.clear();
    priorOnClose?.();
  };

  return server;
}

/** Serve a room over stdio (the local / single-agent transport). */
export async function serveRoomStdio(service: RoomService, room: string): Promise<void> {
  const server = createRoomMcpServer(service, room);
  await server.connect(new StdioServerTransport());
}
