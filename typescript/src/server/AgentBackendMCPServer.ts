import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Backend } from '../types.js'
import { isFileBasedBackend } from '../typing.js'
import { registerExecTool, registerFilesystemTools } from './tools.js'

/**
 * Adaptive MCP Server that works with any Backend type.
 *
 * Automatically detects backend capabilities and registers appropriate tools:
 * - Always registers filesystem tools (read, write, directory operations, etc.)
 * - Conditionally registers exec tool based on duck typing (backend.exec existence)
 *
 * Replaces LocalFilesystemMCPServer, RemoteFilesystemMCPServer, and MemoryMCPServer.
 *
 * @example
 * ```typescript
 * // Works with LocalFilesystemBackend
 * const backend = new LocalFilesystemBackend({ workspaceRoot: '/path' })
 * await backend.connect()
 * const server = new AgentBackendMCPServer(backend)
 * // → filesystem tools + exec tool registered
 *
 * // Works with RemoteFilesystemBackend
 * const backend = new RemoteFilesystemBackend({ host: 'example.com', ... })
 * await backend.connect()
 * const server = new AgentBackendMCPServer(backend)
 * // → filesystem tools + exec tool registered
 *
 * // Works with MemoryBackend
 * const backend = new MemoryBackend()
 * await backend.connect()
 * const server = new AgentBackendMCPServer(backend)
 * // → filesystem tools only (no exec)
 *
 * // Works with ScopedBackend (any wrapper)
 * const scoped = backend.scope('subdir')
 * const server = new AgentBackendMCPServer(scoped)
 * // → automatically adapts to wrapped backend capabilities
 * ```
 */
export class AgentBackendMCPServer {
  public server: McpServer
  private backend: Backend
  private tools: Map<string, any> = new Map()

  constructor(backend: Backend) {
    this.backend = backend

    // Generate server name from backend type (e.g., 'local-filesystem', 'remote-filesystem', 'memory')
    const serverName = this.getServerName(backend)

    const baseServer = new McpServer({
      name: serverName,
      version: '1.0.0'
    })

    // Wrap the server to track tool registrations
    // This enables getTools() method for compatibility with clients that need tool metadata
    const originalRegisterTool = baseServer.registerTool.bind(baseServer)
    baseServer.registerTool = ((name: string, config: any, handler: any) => {
      // Ensure inputSchema has type field for JSON Schema compatibility
      const inputSchema = config.inputSchema
        ? { type: 'object', ...config.inputSchema }
        : undefined

      this.tools.set(name, {
        name,
        description: config.description,
        inputSchema,
        handler
      })
      return originalRegisterTool(name, config, handler)
    })

    // Add getTools method and preserve name/version
    this.server = Object.assign(baseServer, {
      name: serverName,
      version: '1.0.0',
      getTools: () => Object.fromEntries(this.tools)
    }) as any

    // Always register filesystem tools (read, write, directory operations, etc.)
    registerFilesystemTools(this.server, async () => this.backend)

    // Conditionally register exec tool based on duck typing
    // If the backend has an exec method, it supports command execution
    if (isFileBasedBackend(backend)) {
      registerExecTool(this.server, async () => this.backend)
    }
  }

  /**
   * Generate server name from backend type.
   * Converts backend.type (e.g., 'LocalFilesystem', 'RemoteFilesystem', 'Memory')
   * to kebab-case server name (e.g., 'local-filesystem', 'remote-filesystem', 'memory').
   */
  private getServerName(backend: Backend): string {
    // Get backend type (e.g., 'LocalFilesystem', 'RemoteFilesystem', 'Memory', 'ScopedFilesystem')
    const backendType = backend.type

    // Convert to kebab-case
    // 'LocalFilesystem' → 'local-filesystem'
    // 'RemoteFilesystem' → 'remote-filesystem'
    // 'Memory' → 'memory'
    // 'ScopedFilesystem' → 'scoped-filesystem'
    const kebabCase = backendType
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase()

    return kebabCase
  }

  /**
   * Get the underlying MCP server instance.
   * Use this to connect transports or access server methods.
   */
  getServer(): McpServer {
    return this.server
  }

  /**
   * Get the backend instance this server is wrapping.
   */
  getBackend(): Backend {
    return this.backend
  }
}
