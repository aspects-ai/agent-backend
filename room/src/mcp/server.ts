import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { RoomService } from "../room-service.js";

/**
 * Build an MCP server that exposes a single data room to an agent: semantic
 * search, document reads, sandboxed command execution over search-selected
 * documents, and versioned write-back. This is the room's primary delivery
 * surface — a headless server any MCP client can drive.
 */
export function createRoomMcpServer(service: RoomService, room: string): McpServer {
  const server = new McpServer({ name: `agentbe-room:${room}`, version: "0.0.0" });

  server.registerTool(
    "search",
    {
      description:
        "Semantic search over the room's documents. Returns ranked file paths — read them or run commands over them.",
      inputSchema: {
        query: z.string().describe("Natural-language query."),
        limit: z.number().int().positive().optional().describe("Max results (default 5)."),
      },
    },
    async ({ query, limit }) => {
      const hits = await service.search(room, query, limit ?? 5);
      const text = hits.length
        ? hits.map((h) => `${h.path}\t(score ${h.score.toFixed(3)})`).join("\n")
        : "(no matches)";
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "list_documents",
    {
      description: "List all document paths currently in the room.",
      inputSchema: {},
    },
    async () => {
      const docs = await service.listDocuments(room);
      return { content: [{ type: "text", text: docs.length ? docs.join("\n") : "(empty room)" }] };
    },
  );

  server.registerTool(
    "read_document",
    {
      description: "Read a document's text contents by path.",
      inputSchema: { path: z.string().describe("Document path within the room.") },
    },
    async ({ path }) => {
      const text = await service.readDocument(room, path);
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "run_command",
    {
      description:
        "Check out documents into a sandbox and run a shell command over them (e.g. parse a CSV). Read-only — does not modify the room. Optionally restrict the checkout to specific paths (e.g. search hits).",
      inputSchema: {
        command: z.string().describe("Shell command to run in the workspace."),
        paths: z
          .array(z.string())
          .optional()
          .describe("Restrict the checkout to these paths (e.g. search hits)."),
      },
    },
    async ({ command, paths }) => {
      const output = await service.runCommand(room, command, paths);
      return { content: [{ type: "text", text: output }] };
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
      return { content: [{ type: "text", text: `committed ${ref}` }] };
    },
  );

  return server;
}

/** Serve a room over stdio (the local / single-agent transport). */
export async function serveRoomStdio(service: RoomService, room: string): Promise<void> {
  const server = createRoomMcpServer(service, room);
  await server.connect(new StdioServerTransport());
}
