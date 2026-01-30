import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { LocalFilesystemBackend } from 'constellationfs'
import { registerFilesystemTools, registerExecTool } from '../base/tools.js'

/**
 * MCP Server for LocalFilesystemBackend.
 * Provides all filesystem tools plus exec tool for local command execution.
 */
export class LocalFilesystemMCPServer {
  private server: McpServer
  private backend: LocalFilesystemBackend

  constructor(backend: LocalFilesystemBackend) {
    this.backend = backend
    this.server = new McpServer({
      name: 'local-filesystem',
      version: '1.0.0'
    })

    // Register all filesystem tools (read, write, directory operations, etc.)
    registerFilesystemTools(this.server, async () => this.backend)

    // Register exec tool (supported for filesystem backends)
    registerExecTool(this.server, async () => this.backend)
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
  getBackend(): LocalFilesystemBackend {
    return this.backend
  }
}
