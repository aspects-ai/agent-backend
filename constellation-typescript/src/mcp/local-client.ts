/**
 * TODO Phase 8: This file uses old ConstellationFS config
 * Will be updated or moved to agentbe-server package
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
// @ts-expect-error - Archived file, will be fixed in Phase 8
import { ConstellationFS } from '../config/Config.js'

export interface LocalConstellationMCPClientOptions {
  /** User ID for workspace isolation */
  userId: string
  /** Workspace name to scope operations to */
  workspace: string
  /** Workspace root directory (optional - defaults to ConstellationFS.getWorkspaceRoot()) */
  workspaceRoot?: string
}

/**
 * Stdio transport options for spawning a local ConstellationFS MCP server.
 * Compatible with Vercel AI SDK's StdioMCPTransport.
 */
export interface LocalMCPTransportOptions {
  command: string
  args: string[]
}

/**
 * Get stdio transport options for spawning a local ConstellationFS MCP server.
 * Use this with Vercel AI SDK's StdioMCPTransport.
 *
 * @example
 * ```typescript
 * import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp'
 * import { Experimental_StdioMCPTransport as StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
 * import { createLocalConstellationMCPTransportOptions } from 'constellationfs'
 *
 * const transportOptions = createLocalConstellationMCPTransportOptions({
 *   userId: 'user123',
 *   workspace: 'default',
 * })
 *
 * const transport = new StdioMCPTransport(transportOptions)
 * const mcpClient = await createMCPClient({ transport })
 * const tools = await mcpClient.tools()
 * ```
 */
export function createLocalConstellationMCPTransportOptions(
  options: LocalConstellationMCPClientOptions
): LocalMCPTransportOptions {
  const workspaceRoot = options.workspaceRoot ?? ConstellationFS.getWorkspaceRoot()
  return {
    command: 'npx',
    args: [
      'constellation-fs-mcp',
      '--workspaceRoot', workspaceRoot,
      '--userId', options.userId,
      '--workspace', options.workspace,
    ],
  }
}

/** Default timeout for local MCP client connection (15 seconds - longer since it spawns a process) */
const DEFAULT_LOCAL_CONNECTION_TIMEOUT_MS = 15000

export interface CreateLocalMCPClientOptions extends LocalConstellationMCPClientOptions {
  /** Connection timeout in milliseconds (default: 15000) */
  connectionTimeoutMs?: number
}

/**
 * Create an MCP client that spawns a local ConstellationFS MCP server.
 * Uses stdio transport (server runs as child process).
 *
 * @example
 * ```typescript
 * const mcpClient = await createLocalConstellationMCPClient({
 *   userId: 'user123',
 *   workspace: 'my-project',
 * })
 *
 * // Get tool definitions
 * const { tools } = await mcpClient.listTools()
 *
 * // Call a tool directly
 * const result = await mcpClient.callTool({
 *   name: 'read_text_file',
 *   arguments: { path: 'package.json' }
 * })
 *
 * // When done
 * await mcpClient.close()
 * ```
 */
export async function createLocalConstellationMCPClient(
  options: CreateLocalMCPClientOptions
): Promise<Client> {
  const transportOptions = createLocalConstellationMCPTransportOptions(options)
  const transport = new StdioClientTransport(transportOptions)
  const timeoutMs = options.connectionTimeoutMs ?? DEFAULT_LOCAL_CONNECTION_TIMEOUT_MS
  const workspaceRoot = options.workspaceRoot ?? ConstellationFS.getWorkspaceRoot()

  const client = new Client({
    name: 'constellation-mcp-client-local',
    version: '1.0.0',
  }, {
    capabilities: {}
  })

  // Create a timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(
        `Local MCP connection timed out after ${timeoutMs}ms. ` +
        `The MCP server process may have failed to start. ` +
        `Check that 'npx constellation-fs-mcp' is available and ` +
        `your configuration (workspaceRoot: '${workspaceRoot}', userId: '${options.userId}', workspace: '${options.workspace}') is correct.`
      ))
    }, timeoutMs)
  })

  try {
    // Race between connection and timeout
    await Promise.race([
      client.connect(transport),
      timeoutPromise
    ])
    return client
  } catch (error) {
    // Enhance error message with context
    const message = error instanceof Error ? error.message : String(error)

    // Check for common spawn/process error patterns
    if (message.includes('ENOENT') || message.includes('spawn')) {
      throw new Error(
        `Local MCP connection failed: Could not spawn MCP server process. ` +
        `Ensure 'constellation-fs-mcp' package is installed. ` +
        `Original error: ${message}`
      )
    }

    if (message.includes('workspaceRoot') || message.includes('ConstellationFS.setConfig')) {
      throw new Error(
        `Local MCP connection failed: Configuration error. ` +
        `Ensure ConstellationFS.setConfig({ workspaceRoot: '...' }) was called before creating MCP client. ` +
        `Original error: ${message}`
      )
    }

    // Re-throw with connection context
    throw new Error(
      `Local MCP connection failed: ${message}`
    )
  }
}

export type LocalConstellationMCPClient = Client
