import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp'
import { VercelAIAdapter } from 'agent-backend'
import { backendManager } from './backend'

// MCP client cache - stores AI SDK MCP clients per session
const mcpClientCache = new Map<string, Awaited<ReturnType<typeof createMCPClient>>>()

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

  const client = await createAIMCPClient()
  mcpClientCache.set(sessionId, client)
  return client
}

/**
 * Create an AI SDK MCP client using the configured backend.
 *
 * Uses VercelAIAdapter to get the appropriate transport:
 * - LocalFilesystemBackend → StdioClientTransport (spawns subprocess)
 * - RemoteFilesystemBackend → StreamableHTTPClientTransport (HTTP)
 * - MemoryBackend → StdioClientTransport (spawns subprocess)
 *
 * The returned client has tools already in AI SDK format.
 */
async function createAIMCPClient() {
  const backend = await backendManager.getBackend()
  console.log('[mcp-client] Creating AI SDK MCP client for backend type:', backend.type)

  // Use VercelAIAdapter to get the transport
  const adapter = new VercelAIAdapter(backend)
  const transport = await adapter.getTransport()

  // Create AI SDK MCP client with the transport
  const client = await createMCPClient({ transport })

  console.log('[mcp-client] AI SDK MCP client created')
  return client
}
