/**
 * Vercel AI SDK Adapter
 *
 * Provides easy integration with Vercel AI SDK's MCP client.
 * Wraps a backend and returns an MCP client ready for use with streamText/generateText.
 *
 * @example
 * ```typescript
 * import { LocalFilesystemBackend, VercelAIAdapter } from 'agent-backend'
 *
 * const backend = new LocalFilesystemBackend({ rootDir: '/tmp/agentbe-workspace' })
 * const adapter = new VercelAIAdapter(backend)
 *
 * const mcpClient = await adapter.getMCPClient()
 * const tools = await mcpClient.tools()
 *
 * // Use with streamText
 * const result = await streamText({
 *   model: openai('gpt-4'),
 *   tools,
 *   messages,
 * })
 *
 * // Remember to close when done
 * await backend.destroy()
 * ```
 */

import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp'
import type { Backend } from '../backends/types.js'
import { BackendType } from '../backends/types.js'

/** Default timeout for MCP client connection (15 seconds) */
const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000

/**
 * Type for Vercel AI SDK's MCP client
 */
type VercelMCPClient = Awaited<ReturnType<typeof createMCPClient>>

/**
 * Options for VercelAIAdapter
 */
export interface VercelAIAdapterOptions {
  /** Connection timeout in milliseconds (default: 15000) */
  connectionTimeoutMs?: number
}

/**
 * Adapter for creating Vercel AI SDK MCP clients from agent-backend backends.
 *
 * This adapter wraps a backend and provides a simple interface to get
 * a Vercel AI SDK MCP client with tools ready for use.
 */
export class VercelAIAdapter {
  private readonly backend: Backend
  private readonly connectionTimeoutMs: number

  constructor(backend: Backend, options?: VercelAIAdapterOptions) {
    this.backend = backend
    this.connectionTimeoutMs = options?.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS
  }

  /**
   * Get a Vercel AI SDK MCP client.
   * The client has tools already in AI SDK format, ready for use with streamText/generateText.
   *
   * @returns Vercel AI SDK MCP client with tools() method
   * @throws Error if connection times out or fails
   */
  async getMCPClient(): Promise<VercelMCPClient> {
    const transport = await this.backend.getMCPTransport()

    // Create timeout promise for connection
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        const backendType = this.backend.type
        const isRemote = backendType === BackendType.REMOTE_FILESYSTEM

        if (isRemote) {
          reject(new Error(
            `MCP client connection timed out after ${this.connectionTimeoutMs}ms. ` +
            'For remote backends, ensure the MCP server is running on the remote host. ' +
            'Start the server with: agent-backend daemon --rootDir <path> --port <port>'
          ))
        } else {
          reject(new Error(
            `MCP client connection timed out after ${this.connectionTimeoutMs}ms. ` +
            'Check that agent-backend CLI is available in PATH.'
          ))
        }
      }, this.connectionTimeoutMs)
    })

    // Race between connection and timeout
    try {
      const client = await Promise.race([
        createMCPClient({ transport }),
        timeoutPromise
      ])
      this.backend.trackCloseable(client)
      return client
    } catch (error) {
      // Enhance error message for common issues
      const message = error instanceof Error ? error.message : String(error)

      if (message.includes('ECONNREFUSED')) {
        throw new Error(
          `MCP connection refused. The MCP server is not running or not reachable. ` +
          `Original error: ${message}`
        )
      }

      throw error
    }
  }
}
