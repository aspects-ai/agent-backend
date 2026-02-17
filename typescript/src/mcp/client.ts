import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export interface AgentBeMCPClientOptions {
  /** MCP server URL (e.g., 'http://backend.example.com:3000') */
  url: string
  /** Authentication token */
  authToken: string
  /** Workspace root directory (for validation that client and server are configured identically) */
  rootDir: string
  /** Optional scope path for scoped backends */
  scopePath?: string
}

/**
 * Create an MCP client connected to a AgentBackend remote instance.
 * The client is scoped to a specific user and workspace.
 *
 * @example
 * ```typescript
 * const mcpClient = await createAgentBeMCPClient({
 *   url: 'http://backend.example.com:3000',
 *   authToken: process.env.MCP_AUTH_TOKEN,
 *   rootDir: '/tmp/agentbe-workspace',
 *   scopePath: 'users/123',
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
 * // Client must be closed to terminate the connection (this should generally be handled by destroying the backend instance)
 * mcpClient.close()
 * ```
 */
/**
 * Create an HTTP transport for connecting to a AgentBackend MCP server.
 * Use this with Vercel AI SDK's createMCPClient.
 *
 * @example
 * ```typescript
 * import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp'
 * import { createAgentBeMCPTransport } from 'agent-backend'
 *
 * const transport = createAgentBeMCPTransport({
 *   url: 'http://your-server:3001',
 *   authToken: 'your-token',
 *   rootDir: '/tmp/agentbe-workspace',
 *   scopePath: 'users/123',
 * })
 *
 * const mcpClient = await createMCPClient({ transport })
 * const tools = await mcpClient.tools()
 * ```
 */
export function createAgentBeMCPTransport(
  options: AgentBeMCPClientOptions
): StreamableHTTPClientTransport {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${options.authToken}`,
    'X-Root-Dir': options.rootDir,
  }
  if (options.scopePath) {
    headers['X-Scope-Path'] = options.scopePath
  }
  return new StreamableHTTPClientTransport(
    new URL('/mcp', options.url),
    {
      requestInit: {
        headers,
      },
    }
  )
}

/** Default timeout for MCP client connection (10 seconds) */
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000

export interface CreateMCPClientOptions extends AgentBeMCPClientOptions {
  /** Connection timeout in milliseconds (default: 10000) */
  connectionTimeoutMs?: number
}

export async function createAgentBeMCPClient(
  options: CreateMCPClientOptions
): Promise<Client> {
  const transport = createAgentBeMCPTransport(options)
  const timeoutMs = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS

  const client = new Client({
    name: 'agentbe-mcp-client',
    version: '1.0.0',
  }, {
    capabilities: {}
  })

  // Create a timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(
        `MCP connection timed out after ${timeoutMs}ms. ` +
        `Check that the server at ${options.url} is running and reachable, ` +
        `and that your configuration (workspaceRoot, authToken) is correct.`
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

    // Check for common HTTP error patterns
    if (message.includes('400') || message.includes('Bad Request')) {
      throw new Error(
        `MCP connection failed: Server rejected request. ` +
        `This usually means missing or invalid headers. ` +
        `Ensure rootDir ('${options.rootDir}'), scopePath ('${options.scopePath}') are correctly configured. ` +
        `Original error: ${message}`
      )
    }

    if (message.includes('401') || message.includes('Unauthorized')) {
      throw new Error(
        `MCP connection failed: Authentication rejected. ` +
        `Check that your authToken is correct. Original error: ${message}`
      )
    }

    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      throw new Error(
        `MCP connection failed: Unable to reach server at ${options.url}. ` +
        `Check that the server is running and the URL is correct. ` +
        `Original error: ${message}`
      )
    }

    // Re-throw with connection context
    throw new Error(
      `MCP connection failed to ${options.url}: ${message}`
    )
  }
}

export type AgentBeMCPClient = Client
