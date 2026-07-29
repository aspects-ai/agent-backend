import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { RoomService, RoomSession } from "../room-service.js";
import { SessionRegistry } from "../session-registry.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function decode(output: string | Uint8Array): string {
  return typeof output === "string" ? output : new TextDecoder().decode(output);
}

/** Attribution used when no principal could be established. */
export const ANONYMOUS_PRINCIPAL = "anonymous";

export interface RoomMcpOptions {
  /**
   * Release a warm session's sandbox after this many milliseconds with no tool
   * activity. `0` disables reaping. Matters for the hosted HTTP transport: a
   * client that disconnects without calling `close_session` would otherwise leak
   * its sandbox for the life of the process (over stdio the process death
   * cleans up, so the leak is invisible there).
   */
  sessionIdleMs?: number;
  /**
   * Shared warm-session registry. Pass one so sessions **outlive this
   * connection** — an agent work session runs for tens of minutes, and a
   * reconnect must be able to re-attach to its live sandbox. Omit and each
   * server gets its own private registry (fine for stdio and tests).
   */
  sessions?: SessionRegistry;
  /**
   * Who this connection acts as — the identity recorded on every commit. It is
   * **derived from the credential** by the transport, never accepted as a tool
   * argument, so attribution cannot be forged by the caller.
   *
   * Defaults to {@link ANONYMOUS_PRINCIPAL}, which is what an unauthenticated
   * (or shared-token) deployment gets. A shared token means the commit log
   * cannot distinguish people — configure per-principal tokens to get a real
   * audit trail.
   */
  principal?: string;
}


/**
 * Build an MCP server exposing a single data room to an agent: semantic search,
 * document reads, and sandboxed execution. Execution comes in two flavors — a
 * one-shot `run_command`, and **warm sessions** (`open_session` → repeated
 * `run_command`/`write_file` against the *same* live sandbox → `commit_session`)
 * so state persists across commands. This is the room's primary delivery surface.
 */
export function createRoomMcpServer(
  service: RoomService,
  room: string,
  options: RoomMcpOptions = {},
): McpServer {
  const server = new McpServer({ name: `agentbe-room:${room}`, version: "0.0.0" });
  // Fixed for the life of the connection, established from the credential.
  const principal = options.principal ?? ANONYMOUS_PRINCIPAL;
  // Shared when the transport supplies one, so sessions survive reconnects.
  const sessions =
    options.sessions ?? new SessionRegistry({ idleMs: options.sessionIdleMs });
  const withSession = <T>(id: string, fn: (session: RoomSession) => Promise<T>): Promise<T> =>
    sessions.withSession(id, principal, fn);

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
      if (session) {
        return withSession(session, async (s) => textResult(decode(await s.exec(command))));
      }
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
      const id = sessions.open(room, principal, session);
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
    async ({ session, path, content }) =>
      withSession(session, async (s) => {
        await s.tree.write(path, content);
        return textResult(`wrote ${path}`);
      }),
  );

  server.registerTool(
    "commit_session",
    {
      description:
        "Commit a warm session's working tree as a new room version (and reindex). Read-only sessions cannot commit. Attribution comes from the authenticated identity.",
      inputSchema: {
        session: z.string().describe("Warm session id."),
      },
    },
    async ({ session }) =>
      withSession(session, async (s) => {
        const ref = await s.commit(principal);
        return textResult(`committed ${ref}`);
      }),
  );

  server.registerTool(
    "close_session",
    {
      description: "Close a warm session and release its sandbox.",
      inputSchema: { session: z.string().describe("Warm session id.") },
    },
    async ({ session }) => {
      await sessions.close(session, principal);
      return textResult("closed");
    },
  );

  server.registerTool(
    "put_document",
    {
      description:
        "Add or update a document, creating a new version of the room. Returns the new version ref. Attribution comes from the authenticated identity.",
      inputSchema: {
        path: z.string().describe("Document path within the room."),
        content: z.string().describe("Text contents to write."),
      },
    },
    async ({ path, content }) => {
      const ref = await service.putDocuments(room, { [path]: content }, principal);
      return textResult(`committed ${ref}`);
    },
  );

  // NOTE: connection close deliberately does NOT release sessions. An agent work
  // session runs for tens of minutes; a network blip or client restart must not
  // destroy a live sandbox and its uncommitted working tree. The idle reaper in
  // SessionRegistry is the sole reclaimer, so a reconnecting client can
  // re-attach to its sandbox by id (authorized by principal).

  return server;
}

/** Serve a room over stdio (the local / single-agent transport). */
export async function serveRoomStdio(
  service: RoomService,
  room: string,
  options: RoomMcpOptions = {},
): Promise<void> {
  const server = createRoomMcpServer(service, room, options);
  await server.connect(new StdioServerTransport());
}
