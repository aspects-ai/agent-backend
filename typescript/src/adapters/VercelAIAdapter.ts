/**
 * Vercel AI SDK Adapter
 *
 * Provides MCP transports for use with Vercel AI SDK's createMCPClient
 * or any other MCP-compatible client.
 *
 * Transport type depends on backend:
 * - LocalFilesystemBackend → StdioClientTransport (spawns subprocess)
 * - RemoteFilesystemBackend → StreamableHTTPClientTransport (HTTP)
 * - MemoryBackend → StdioClientTransport (spawns subprocess)
 */

import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Backend } from '../backends/types.js'
import { BackendType } from '../backends/types.js'
import { ERROR_CODES } from '../constants.js'
import { BackendError } from '../types.js'
import {
  getProperty,
  getRootBackend,
  hasRemoteConfig,
  isFileBasedBackend,
} from '../typing.js'

/**
 * Union type for MCP transports
 */
export type MCPTransport = StdioClientTransport | StreamableHTTPClientTransport

/**
 * Adapter for creating MCP transports compatible with Vercel AI SDK
 *
 * @example
 * ```typescript
 * import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp'
 * import { LocalFilesystemBackend, VercelAIAdapter } from 'agent-backend'
 *
 * const backend = new LocalFilesystemBackend({ rootDir: '/tmp/workspace' })
 * const adapter = new VercelAIAdapter(backend)
 *
 * const transport = await adapter.getTransport()
 * const mcpClient = await createMCPClient({ transport })
 * const tools = await mcpClient.tools()
 * ```
 */
export class VercelAIAdapter {
  private readonly backend: Backend

  constructor(backend: Backend) {
    this.backend = backend
  }

  /**
   * Get MCP transport for use with any MCP-compatible client.
   * Works with Vercel AI SDK's createMCPClient or raw MCP SDK.
   *
   * Transport type depends on backend:
   * - LocalFilesystemBackend → StdioClientTransport (spawns subprocess)
   * - RemoteFilesystemBackend → StreamableHTTPClientTransport (HTTP)
   * - MemoryBackend → StdioClientTransport (spawns subprocess)
   *
   * @returns MCP transport configured for the backend type
   */
  async getTransport(): Promise<MCPTransport> {
    const rootBackend = getRootBackend(this.backend)
    const backendType = rootBackend.type
    const effectiveRootDir = this.getEffectiveRootDir()

    switch (backendType) {
      case BackendType.LOCAL_FILESYSTEM:
        return this.createStdioTransport(rootBackend, effectiveRootDir)

      case BackendType.REMOTE_FILESYSTEM:
        return this.createHttpTransport(rootBackend)

      case BackendType.MEMORY:
        return this.createMemoryTransport(effectiveRootDir)

      default:
        throw new BackendError(
          `Unsupported backend type: ${backendType}. VercelAIAdapter supports LOCAL_FILESYSTEM, REMOTE_FILESYSTEM, and MEMORY backends.`,
          ERROR_CODES.INVALID_CONFIGURATION,
          'unsupported-backend-type'
        )
    }
  }

  /**
   * Get the effective rootDir, considering scoped backends
   */
  private getEffectiveRootDir(): string {
    if (isFileBasedBackend(this.backend)) {
      return this.backend.rootDir
    }
    return '/'
  }

  /**
   * Create Stdio transport for local filesystem backend
   */
  private async createStdioTransport(
    backend: Backend,
    rootDir: string
  ): Promise<StdioClientTransport> {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

    const args = [
      'daemon',
      '--rootDir', rootDir,
      '--local-only',
    ]

    // Access isolation through duck typing
    const isolation = getProperty<string>(backend, 'isolation') ||
                      getProperty<string>(backend, 'actualIsolation')
    if (isolation && isolation !== 'auto') {
      args.push('--isolation', isolation)
    }

    // Access shell through duck typing
    const shell = getProperty<string>(backend, 'shell')
    if (shell && shell !== 'auto') {
      args.push('--shell', shell)
    }

    return new StdioClientTransport({
      command: 'agent-backend',
      args,
    })
  }

  /**
   * Create HTTP transport for remote filesystem backend
   */
  private async createHttpTransport(
    backend: Backend
  ): Promise<StreamableHTTPClientTransport> {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')

    if (!hasRemoteConfig(backend)) {
      throw new BackendError(
        'RemoteFilesystemBackend requires host to be configured. ' +
        'The MCP server must run on the remote host and be accessible via HTTP.',
        ERROR_CODES.INVALID_CONFIGURATION,
        'host'
      )
    }

    const { config } = backend
    const mcpHost = config.mcpServerHostOverride || config.host
    const mcpPort = config.mcpPort || 3001
    const mcpServerUrl = `http://${mcpHost}:${mcpPort}`

    return new StreamableHTTPClientTransport(
      new URL('/mcp', mcpServerUrl),
      {
        requestInit: {
          headers: {
            ...(config.mcpAuth?.token && {
              'Authorization': `Bearer ${config.mcpAuth.token}`,
            }),
          },
        },
      }
    )
  }

  /**
   * Create Stdio transport for memory backend
   */
  private async createMemoryTransport(rootDir: string): Promise<StdioClientTransport> {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

    const args = [
      '--backend', 'memory',
      '--rootDir', rootDir,
    ]

    return new StdioClientTransport({
      command: 'agent-backend',
      args,
    })
  }
}
