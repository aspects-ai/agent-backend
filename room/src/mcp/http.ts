import { randomUUID } from "node:crypto";
import http from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { RoomService } from "../room-service.js";
import { createRoomMcpServer } from "./server.js";

export interface RoomHttpOptions {
  /** Port to listen on (0 = ephemeral, useful for tests). Default 0. */
  port?: number;
  host?: string;
  /** MCP endpoint path. Default "/mcp". */
  path?: string;
  /** If set, require `Authorization: Bearer <token>` on every request. */
  authToken?: string;
}

export interface RoomHttpHandle {
  server: http.Server;
  port: number;
  close(): Promise<void>;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

function isInitialize(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { method?: string }).method === "initialize"
  );
}

/**
 * Serve a room over the MCP streamable-HTTP transport (the hosted / shared
 * transport). **Stateful**: each MCP client connection gets its own persistent
 * `McpServer` (and thus its own warm-session registry), keyed by the
 * `Mcp-Session-Id` header — so warm sessions survive across HTTP requests, which
 * a per-request stateless server could not do.
 */
export async function serveRoomHttp(
  service: RoomService,
  room: string,
  options: RoomHttpOptions = {},
): Promise<RoomHttpHandle> {
  const endpoint = options.path ?? "/mcp";
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== endpoint) {
        res.writeHead(404).end();
        return;
      }
      if (options.authToken && req.headers.authorization !== `Bearer ${options.authToken}`) {
        res.writeHead(401).end("unauthorized");
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        const body = req.method === "POST" ? await readJson(req) : undefined;
        await transports.get(sessionId)!.handleRequest(req, res, body);
        return;
      }

      if (req.method === "POST") {
        const body = await readJson(req);
        if (!sessionId && isInitialize(body)) {
          const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => {
              transports.set(id, transport);
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId);
          };
          await createRoomMcpServer(service, room).connect(transport);
          await transport.handleRequest(req, res, body);
          return;
        }
      }

      res.writeHead(400).end("missing or invalid Mcp-Session-Id");
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end((err as Error).message);
    }
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve),
  );
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : (options.port ?? 0);

  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const transport of transports.values()) void transport.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
