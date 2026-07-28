import { randomUUID } from "node:crypto";
import http from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { RoomService } from "../room-service.js";
import { ANONYMOUS_PRINCIPAL, createRoomMcpServer } from "./server.js";
import type { RoomMcpOptions } from "./server.js";

export interface RoomHttpOptions extends RoomMcpOptions {
  /** Port to listen on (0 = ephemeral, useful for tests). Default 0. */
  port?: number;
  /**
   * Interface to bind. Defaults to `127.0.0.1` (safe for a local demo or behind
   * a reverse proxy on the same host). A containerized deployment must set this
   * to `0.0.0.0`, or the published port will not accept external connections.
   */
  host?: string;
  /** MCP endpoint path. Default "/mcp". */
  path?: string;
  /**
   * A single shared bearer token. Grants access but establishes **no identity** —
   * every commit is attributed to `anonymous` and the token cannot be revoked
   * for one person without rotating it for everyone. Fine for a demo; prefer
   * {@link principals} in production.
   */
  authToken?: string;
  /**
   * Bearer token → principal id (e.g. an email). Gives real per-person
   * attribution and per-person revocation without needing a membership system.
   * Takes precedence over {@link authToken}.
   */
  principals?: Record<string, string>;
  /**
   * Escape hatch for a dynamic (e.g. database- or JWT-backed) lookup. Return the
   * principal id, or `null` to reject. Takes precedence over everything else.
   */
  resolvePrincipal?(token: string | undefined): string | null | Promise<string | null>;
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

/** Pull the bearer token out of an Authorization header, if present. */
function bearerToken(req: http.IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
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
  // Each session remembers who opened it, so a leaked session id can't be
  // driven by a different principal and have the commits land under the first.
  const transports = new Map<string, { transport: StreamableHTTPServerTransport; principal: string }>();

  /**
   * Establish the caller's identity from their credential. Returns null to
   * reject. Attribution is derived here and nowhere else — tools never accept
   * an author argument.
   */
  async function authenticate(req: http.IncomingMessage): Promise<string | null> {
    const token = bearerToken(req);
    if (options.resolvePrincipal) return (await options.resolvePrincipal(token)) ?? null;
    if (options.principals) {
      if (!token) return null;
      return options.principals[token] ?? null;
    }
    if (options.authToken) {
      // Shared secret: authenticates, but identifies nobody.
      return token === options.authToken ? ANONYMOUS_PRINCIPAL : null;
    }
    return ANONYMOUS_PRINCIPAL; // no auth configured — open
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== endpoint) {
        res.writeHead(404).end();
        return;
      }
      const principal = await authenticate(req);
      if (principal === null) {
        res.writeHead(401).end("unauthorized");
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const existing = sessionId ? transports.get(sessionId) : undefined;
      if (existing) {
        // Authenticated, but as someone else — refuse rather than let this
        // request's work be attributed to the session's owner.
        if (existing.principal !== principal) {
          res.writeHead(403).end("session belongs to a different principal");
          return;
        }
        const body = req.method === "POST" ? await readJson(req) : undefined;
        await existing.transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "POST") {
        const body = await readJson(req);
        if (!sessionId && isInitialize(body)) {
          const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => {
              transports.set(id, { transport, principal });
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId);
          };
          await createRoomMcpServer(service, room, {
            sessionIdleMs: options.sessionIdleMs,
            principal,
          }).connect(transport);
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
        for (const { transport } of transports.values()) void transport.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
