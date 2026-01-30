/**
 * TODO Phase 8: This file will be moved to agentbe-server package
 * Currently kept for backward compatibility with existing CLI
 * Contains old FileSystem/Workspace imports that are archived
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
// @ts-expect-error - Archived files, will be fixed in Phase 8 migration
import { ConstellationFS } from '../config/Config.js'
// @ts-expect-error - Archived files, will be fixed in Phase 8 migration
import { FileSystem } from '../FileSystem.js'
// @ts-expect-error - Archived files, will be fixed in Phase 8 migration
import type { Workspace } from '../workspace/Workspace.js'
import type { Backend } from '../backends/index.js'
import { registerTools } from './tools.js'

// ─────────────────────────────────────────────────────────────────
// ConstellationFS MCP Server (Legacy CLI)
// TODO Phase 8: Move to agentbe-server package
// ─────────────────────────────────────────────────────────────────
//
// This server exposes ConstellationFS tools via the Model Context Protocol (MCP).
// It supports two transport modes with different scoping:
//
// STDIO MODE (Single-session)
// ---------------------------
// - User and workspace are bound at server startup
// - One MCP server process per user/workspace combination
// - Best for: Local development, AI coding assistants (Claude Code, Cursor, etc.)
// - The AI spawns one server per session, so single-session is appropriate
//
// Example:
//   npx constellationfs mcp-server \
//     --workspaceRoot /home/user/.constellationfs \
//     --userId user123 \
//     --workspace default
//
// HTTP MODE (Multi-session)
// -------------------------
// - User and workspace are specified per-request via headers (X-User-ID, X-Workspace)
// - One server handles multiple users/workspaces concurrently
// - Best for: Cloud deployments, shared services, multi-tenant applications
// - Requires auth token to prevent unauthorized access
//
// Example:
//   npx constellationfs mcp-server \
//     --workspaceRoot /data/workspaces \
//     --http \
//     --port 3000 \
//     --authToken secret123
//
// CHOOSING A MODE
// ---------------
// - If each user/session spawns its own MCP server process → use stdio mode
// - If you want a single MCP server handling multiple users → use HTTP mode
//
// Both modes provide identical tool functionality; they differ only in how
// the user/workspace context is established.
//
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// CLI Argument Parsing
// ─────────────────────────────────────────────────────────────────

interface ServerConfig {
  workspaceRoot: string
  // Stdio mode (single workspace)
  userId?: string
  workspace?: string
  // HTTP mode (multi-session)
  http?: boolean
  port?: number
  authToken?: string
}

function parseArgs(args: string[]): ServerConfig {
  const config: Partial<ServerConfig> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]

    switch (arg) {
      case '--workspaceRoot':
        config.workspaceRoot = next
        i++
        break
      case '--userId':
        config.userId = next
        i++
        break
      case '--workspace':
        config.workspace = next
        i++
        break
      case '--http':
        config.http = true
        break
      case '--port':
        config.port = parseInt(next || '3000', 10)
        i++
        break
      case '--authToken':
        config.authToken = next
        i++
        break
    }
  }

  // Validation
  if (!config.workspaceRoot) {
    console.error('--workspaceRoot is required')
    printUsage()
    process.exit(1)
  }

  if (config.http) {
    if (!config.authToken) {
      console.error('--authToken is required in HTTP mode')
      printUsage()
      process.exit(1)
    }
  } else {
    if (!config.userId || !config.workspace) {
      console.error('--userId and --workspace are required in stdio mode')
      printUsage()
      process.exit(1)
    }
  }

  return config as ServerConfig
}

function printUsage(): void {
  console.error(`
Usage:
  Stdio mode (single workspace):
    constellation-fs-mcp --workspaceRoot <path> --userId <userId> --workspace <workspace>

  HTTP mode (multi-session):
    constellation-fs-mcp --workspaceRoot <path> --http --port <port> --authToken <token>
`)
}

// ─────────────────────────────────────────────────────────────────
// Session Management (HTTP mode only)
// ─────────────────────────────────────────────────────────────────

interface SessionContext {
  userId: string
  workspaceName: string
  workspace: Workspace
  fs: FileSystem
}

const sessions = new Map<string, SessionContext>()

/**
 * Validate session headers before creating a session.
 * This is called upfront to give clear error messages before MCP handshake completes.
 */
function validateSessionHeaders(headers: Record<string, string>): void {
  const clientWorkspaceRoot = headers['x-workspace-root']
  const userId = headers['x-user-id']
  const workspaceName = headers['x-workspace']

  if (!userId || !workspaceName) {
    throw new Error('Missing required headers: X-User-ID and X-Workspace')
  }

  if (!clientWorkspaceRoot) {
    throw new Error('Missing required header: X-Workspace-Root')
  }

  const serverWorkspaceRoot = ConstellationFS.getWorkspaceRoot()
  if (clientWorkspaceRoot !== serverWorkspaceRoot) {
    throw new Error(
      `Workspace root mismatch: client sent '${clientWorkspaceRoot}' but server is configured for '${serverWorkspaceRoot}'`
    )
  }
}

async function initializeSession(
  sessionId: string,
  headers: Record<string, string>,
): Promise<SessionContext> {
  // Headers are already validated by validateSessionHeaders, but extract values
  const userId = headers['x-user-id']!
  const workspaceName = headers['x-workspace']!

  const fs = new FileSystem({ userId, type: 'local' })
  const workspace = await fs.getWorkspace(workspaceName)

  const context: SessionContext = { userId, workspaceName, workspace, fs }
  sessions.set(sessionId, context)
  return context
}

function getSessionContext(sessionId: string): SessionContext {
  const context = sessions.get(sessionId)
  if (!context) {
    throw new Error(`Session not found: ${sessionId}`)
  }
  return context
}

async function destroySession(sessionId: string): Promise<void> {
  const context = sessions.get(sessionId)
  if (context) {
    await context.fs.destroy()
    sessions.delete(sessionId)
  }
}

// ─────────────────────────────────────────────────────────────────
// Programmatic API for Backend Interface
// ─────────────────────────────────────────────────────────────────

export interface MCPServerOptions {
  name?: string
  version?: string
}

/**
 * Start an MCP server with a backend factory
 * Simplified API for use with the new Backend interface
 *
 * @example
 * ```typescript
 * import { startMCPServer } from './mcp/server.js'
 * import { LocalFilesystemBackend, BackendPoolManager } from './index.js'
 *
 * // Simple usage with direct backend
 * const server = await startMCPServer(async (sessionId) => {
 *   return new LocalFilesystemBackend({ rootDir: `/sessions/${sessionId}` })
 * })
 *
 * // Or with connection pooling
 * const pool = new BackendPoolManager({
 *   backendClass: RemoteFilesystemBackend,
 *   defaultConfig: { ... }
 * })
 *
 * const server = await startMCPServer(async (sessionId) => {
 *   const { backend } = await pool.acquireBackend({ key: sessionId })
 *   return backend
 * })
 * ```
 */
export async function startMCPServer(
  getBackend: (sessionId: string) => Promise<Backend> | Backend,
  options?: MCPServerOptions
): Promise<McpServer> {
  const server = new McpServer({
    name: options?.name ?? 'constellationfs',
    version: options?.version ?? '1.0.0',
  })

  // Register tools with backend factory
  registerTools(server, getBackend)

  return server
}

// ─────────────────────────────────────────────────────────────────
// Main Entry Point (CLI)
// ─────────────────────────────────────────────────────────────────

export async function main(args: string[]) {
  const config = parseArgs(args)

  // Initialize ConstellationFS configuration
  ConstellationFS.setConfig({
    workspaceRoot: config.workspaceRoot,
  })

  // Create MCP server
  const mcpServer = new McpServer({
    name: 'constellation-fs',
    version: '1.0.0',
  })

  if (config.http) {
    // ─────────────────────────────────────────────────────────────
    // HTTP Mode: Multi-session, workspace from headers
    // ─────────────────────────────────────────────────────────────

    // @ts-expect-error - Old CLI uses Workspace API, will be removed in Phase 6
    registerTools(mcpServer, (sessionId) => {
      if (!sessionId) throw new Error('Session ID required')
      return getSessionContext(sessionId).workspace
    })

    const transports: Record<string, StreamableHTTPServerTransport> = {}
    const app = express()
    app.use(express.json())

    // Auth middleware
    const authToken = config.authToken!
    app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
      const auth = req.headers.authorization
      if (!auth?.startsWith('Bearer ') || auth.slice(7) !== authToken) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      next()
    })

    // MCP endpoint
    app.post('/mcp', async (req: Request, res: Response) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      console.log(`[MCP] POST /mcp - sessionId: ${sessionId}, method: ${req.body?.method}`)

      if (sessionId && transports[sessionId]) {
        // Pass req.body as parsedBody since express.json() already consumed the stream
        await transports[sessionId].handleRequest(req, res, req.body)
        return
      }

      if (req.body?.method !== 'initialize') {
        console.log(`[MCP] Session not found - no sessionId or method not 'initialize'. Body:`, JSON.stringify(req.body).slice(0, 200))
        res.status(400).json({ error: 'Session not found' })
        return
      }

      // Validate headers upfront before creating the session
      // This gives a clear error message if workspace root doesn't match
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v
      }

      try {
        validateSessionHeaders(headers)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid session headers'
        console.error('[MCP] Header validation failed:', message)
        res.status(400).json({ error: message })
        return
      }

      const newSessionId = randomUUID()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: async (sid: string) => {
          try {
            await initializeSession(sid, headers)
            transports[sid] = transport
          } catch (err) {
            // This shouldn't happen since we validated headers above,
            // but log just in case
            console.error('Session init failed:', err)
          }
        },
        onsessionclosed: async (sid: string) => {
          await destroySession(sid)
          delete transports[sid]
        },
      })

      await mcpServer.connect(transport)
      // Pass req.body as parsedBody since express.json() already consumed the stream
      await transport.handleRequest(req, res, req.body)
    })

    app.get('/health', (_: Request, res: Response) => {
      res.json({ status: 'ok', sessions: Object.keys(transports).length })
    })

    const port = config.port || 3000
    app.listen(port, '0.0.0.0', () => {
      console.log(`ConstellationFS MCP server (HTTP) listening on port ${port}`)
    })

  } else {
    // ─────────────────────────────────────────────────────────────
    // Stdio Mode: Single workspace, bound at startup
    // ─────────────────────────────────────────────────────────────

    // Log to stderr so it doesn't interfere with JSON-RPC over stdout
    console.error('[constellation-fs-mcp] Starting stdio server...')
    console.error(`[constellation-fs-mcp] workspaceRoot=${ConstellationFS.getWorkspaceRoot()}`)
    console.error(`[constellation-fs-mcp] userId=${config.userId}, workspace=${config.workspace}`)

    const fs = new FileSystem({ userId: config.userId!, type: 'local' })
    const workspace = await fs.getWorkspace(config.workspace!)

    console.error(`[constellation-fs-mcp] Workspace initialized: ${workspace.workspacePath}`)

    // @ts-expect-error - Old CLI uses Workspace API, will be removed in Phase 6
    registerTools(mcpServer, () => workspace)

    const transport = new StdioServerTransport()
    await mcpServer.connect(transport)

    console.error('[constellation-fs-mcp] MCP server connected and ready')

    process.on('SIGINT', async () => {
      console.error('[constellation-fs-mcp] Shutting down...')
      await fs.destroy()
      process.exit(0)
    })
  }
}

// Note: Auto-run logic is now in cli/mcp-server.js which calls main() after importing this module.
// This ensures the server only starts once when invoked via the CLI.
