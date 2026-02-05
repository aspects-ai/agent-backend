import { VercelAIAdapter } from 'agent-backend/adapters'
import { backendManager } from './backend'

// MCP client type from VercelAIAdapter
type MCPClient = Awaited<ReturnType<VercelAIAdapter['getMCPClient']>>

// MCP client cache - stores AI SDK MCP clients per session
const mcpClientCache = new Map<string, MCPClient>()

/**
 * Clear all cached MCP clients (call when backend config changes)
 */
export async function clearMCPClients() {
  console.log('[mcp-client] Clearing', mcpClientCache.size, 'cached clients')
  // Close all clients before clearing
  for (const [, client] of mcpClientCache) {
    try {
      await client.close()
    } catch (e) {
      console.warn('[mcp-client] Error closing client:', e)
    }
  }
  mcpClientCache.clear()
}

/**
 * Get or create an MCP client for a session.
 * Returns an AI SDK MCP client with tools already in AI SDK format.
 */
export async function getMCPClientForSession(sessionId: string) {
  if (mcpClientCache.has(sessionId)) {
    return mcpClientCache.get(sessionId)!
  }

  const client = await createMCPClient()
  mcpClientCache.set(sessionId, client)
  return client
}

/**
 * Create an AI SDK MCP client using the configured backend.
 *
 * Uses VercelAIAdapter which automatically selects the right transport:
 * - LocalFilesystemBackend → StdioClientTransport (spawns subprocess)
 * - RemoteFilesystemBackend → StreamableHTTPClientTransport (HTTP)
 * - MemoryBackend → StdioClientTransport (spawns subprocess)
 */
async function createMCPClient() {
  const backend = await backendManager.getBackend()
  console.log('[mcp-client] Creating AI SDK MCP client for backend type:', backend.type)

  const adapter = new VercelAIAdapter(backend)
  const client = await adapter.getMCPClient()

  console.log('[mcp-client] AI SDK MCP client created')
  return client
}
