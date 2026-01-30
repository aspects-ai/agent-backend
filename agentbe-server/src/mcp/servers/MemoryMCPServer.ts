import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { MemoryBackend } from 'constellationfs'
import { registerFilesystemTools } from '../base/tools.js'
// Note: Do NOT import registerExecTool - MemoryBackend does not support exec

/**
 * MCP Server for MemoryBackend.
 * Provides filesystem tools only - NO exec tool.
 * MemoryBackend is a key/value store and does not support command execution.
 */
export class MemoryMCPServer {
  private server: McpServer
  private backend: MemoryBackend

  constructor(backend: MemoryBackend) {
    this.backend = backend
    this.server = new McpServer({
      name: 'memory',
      version: '1.0.0'
    })

    // Register filesystem tools only (read, write, directory operations)
    registerFilesystemTools(this.server, async () => this.backend)

    // DO NOT register exec tool - MemoryBackend.exec() throws NotImplementedError
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
  getBackend(): MemoryBackend {
    return this.backend
  }
}
