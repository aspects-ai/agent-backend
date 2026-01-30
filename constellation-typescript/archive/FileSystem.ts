import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { BackendFactory } from './backends/index.js'
import { ConstellationFS } from './config/Config.js'
import { createConstellationMCPClient, createConstellationMCPTransport } from './mcp/client.js'
import { createLocalConstellationMCPClient, createLocalConstellationMCPTransportOptions } from './mcp/local-client.js'
import type { BackendConfig, FileSystemBackend, LocalBackendConfig, RemoteBackendConfig } from './types.js'
import { getLogger } from './utils/logger.js'
import type { Workspace, WorkspaceConfig } from './workspace/Workspace.js'

/**
 * Type guard to check if input is a FileSystemBackend instance
 */
function isBackendInstance(input: Partial<BackendConfig> | FileSystemBackend): input is FileSystemBackend {
  return (
    typeof input === 'object' &&
    input !== null &&
    'type' in input &&
    'userId' in input &&
    'options' in input &&
    'connected' in input &&
    'getWorkspace' in input &&
    typeof (input as FileSystemBackend).getWorkspace === 'function'
  )
}

/**
 * FileSystem class - Frontend abstraction for backend management
 *
 * This class:
 * - Manages backend configuration and pooling
 * - Provides workspace access via getWorkspace()
 * - Hides backend pool complexity from users
 *
 * FileSystem is 1:1 with a backend (keyed by userId + backend type)
 * Workspaces are obtained from the FileSystem as needed
 *
 * @example
 * ```typescript
 * // Create a filesystem with config (creates backend automatically)
 * const fs = new FileSystem({ userId: 'user123' })
 *
 * // Or provide a custom backend instance
 * const customBackend = new LocalBackend({ userId: 'user123', type: 'local' })
 * const fs = new FileSystem(customBackend)
 *
 * // Get workspaces and use them
 * const ws1 = await fs.getWorkspace('project-a')
 * const ws2 = await fs.getWorkspace('project-b')
 *
 * await ws1.exec('npm install')
 * await ws2.exec('npm test')
 *
 * // Cleanup when done
 * await fs.destroy()
 * ```
 */
export class FileSystem {
  private readonly backend: FileSystemBackend
  private readonly backendConfig: BackendConfig

  /**
   * Create a new FileSystem instance
   * @param input - Backend configuration object or a FileSystemBackend instance
   * @throws {FileSystemError} When configuration is invalid
   */
  constructor(input: Partial<BackendConfig> | FileSystemBackend) {
    // Check if input is a backend instance
    if (isBackendInstance(input)) {
      // Use the provided backend instance
      this.backend = input
      this.backendConfig = input.options
    } else {
      // Normalize config
      if (input.type) {
        // Full backend config - use as-is with defaults for missing fields
        this.backendConfig = input as BackendConfig
      } else {
        getLogger().debug('No backend config provided, assuming local backend: %s', input)
        // Partial config - assume local backend and fill in defaults
        this.backendConfig = {
          type: 'local',
          shell: 'auto',
          validateUtils: false,
          preventDangerous: true,
          ...input,
        } as LocalBackendConfig
      }

      // Create a new backend instance for this FileSystem
      this.backend = BackendFactory.create(this.backendConfig)
    }
  }

  /**
   * Get or create a workspace
   * @param workspaceName - Workspace name identifier (defaults to 'default')
   * @param config - Optional workspace configuration including custom environment variables
   * @returns Promise resolving to Workspace instance
   *
   * @example
   * ```typescript
   * // Create workspace with custom environment variables
   * const workspace = await fs.getWorkspace('my-project', {
   *   env: {
   *     NODE_ENV: 'development',
   *     API_KEY: 'secret-key',
   *     DATABASE_URL: 'postgres://localhost:5432/db'
   *   }
   * })
   *
   * // Environment variables are available in all commands
   * await workspace.exec('echo $NODE_ENV')
   * ```
   */
  async getWorkspace(workspaceName: string, config?: WorkspaceConfig): Promise<Workspace> {
    return this.backend.getWorkspace(workspaceName, config)
  }

  /**
   * List all workspaces for this user
   * @returns Promise resolving to array of workspace names
   */
  async listWorkspaces(): Promise<string[]> {
    return this.backend.listWorkspaces()
  }

  get isRemote(): boolean {
    return this.backendConfig.type === 'remote'
  }

  /**
   * Get the backend configuration
   * @returns Backend configuration object
   */
  get config(): BackendConfig {
    return this.backendConfig
  }

  /**
   * Get the user ID this filesystem is associated with
   * @returns User identifier
   */
  get userId(): string {
    return this.backendConfig.userId
  }

  /**
   * Get an MCP client for this filesystem.
   *
   * For local backends: Spawns a local MCP server process via stdio transport.
   * For remote backends: Connects to the remote MCP server via HTTP (requires mcpAuth).
   *
   * @param workspace - Workspace name to scope MCP operations to
   * @returns Promise resolving to an MCP Client instance
   * @throws {Error} When using remote backend without mcpAuth configured
   *
   * @example
   * ```typescript
   * // Local backend - spawns MCP server as child process
   * const localFs = new FileSystem({ userId: 'user123' })
   * const localMcp = await localFs.getMCPClient('my-project')
   *
   * // Remote backend - connects to remote MCP server
   * const remoteFs = new FileSystem({
   *   type: 'remote',
   *   host: 'server.com',
   *   userId: 'user123',
   *   sshAuth: { type: 'key', credentials: { username: 'user', privateKey: '...' } },
   *   mcpAuth: { token: 'my-mcp-token' },
   * })
   * const remoteMcp = await remoteFs.getMCPClient('my-project')
   *
   * // Use MCP tools (same API for both)
   * const { tools } = await localMcp.listTools()
   * await localMcp.callTool({ name: 'read_text_file', arguments: { path: 'package.json' } })
   *
   * // When done
   * await localMcp.close()
   * ```
   */
  async getMCPClient(workspace: string): Promise<Client> {
    try {
      if (this.backendConfig.type === 'local') {
        return await createLocalConstellationMCPClient({
          userId: this.userId,
          workspace,
        })
      }

      // Remote backend
      const remoteConfig = this.backendConfig as RemoteBackendConfig
      if (!remoteConfig.mcpAuth?.token) {
        throw new Error('mcpAuth.token is required to use getMCPClient with remote backend')
      }

      const mcpPort = remoteConfig.mcpPort ?? 3001

      return await createConstellationMCPClient({
        url: `http://${remoteConfig.host}:${mcpPort}`,
        authToken: remoteConfig.mcpAuth.token,
        workspaceRoot: ConstellationFS.getWorkspaceRoot(),
        userId: this.userId,
        workspace,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const backendType = this.backendConfig.type === 'local' ? 'local' : 'remote'
      throw new Error(
        `Failed to create MCP client for ${backendType} backend (userId: '${this.userId}', workspace: '${workspace}'): ${message}`
      )
    }
  }

  /**
   * Get an MCP transport for this filesystem.
   * Use this with Vercel AI SDK's createMCPClient or similar.
   *
   * For local backends: Returns StdioClientTransport (spawns MCP server as child process).
   * For remote backends: Returns StreamableHTTPClientTransport (connects via HTTP).
   *
   * @param workspace - Workspace name to scope MCP operations to
   * @returns MCP Transport instance compatible with @modelcontextprotocol/sdk
   * @throws {Error} When using remote backend without mcpAuth configured
   *
   * @example
   * ```typescript
   * import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp'
   *
   * const fs = new FileSystem({ userId: 'user123' })
   * const transport = fs.getMCPTransport('my-project')
   * const mcpClient = await createMCPClient({ transport })
   * const tools = await mcpClient.tools()
   *
   * // Use tools with Vercel AI SDK
   * const result = await generateText({
   *   model: openai('gpt-4'),
   *   tools,
   *   prompt: 'List the files in the current directory',
   * })
   *
   * await mcpClient.close()
   * ```
   */
  getMCPTransport(workspace: string): StdioClientTransport | StreamableHTTPClientTransport {
    if (this.backendConfig.type === 'local') {
      const options = createLocalConstellationMCPTransportOptions({
        userId: this.userId,
        workspace,
      })
      return new StdioClientTransport(options)
    }

    // Remote backend
    const remoteConfig = this.backendConfig as RemoteBackendConfig
    if (!remoteConfig.mcpAuth?.token) {
      throw new Error('mcpAuth.token is required to use getMCPTransport with remote backend')
    }

    const mcpPort = remoteConfig.mcpPort ?? 3001

    return createConstellationMCPTransport({
      url: `http://${remoteConfig.host}:${mcpPort}`,
      authToken: remoteConfig.mcpAuth.token,
      workspaceRoot: ConstellationFS.getWorkspaceRoot(),
      userId: this.userId,
      workspace,
    })
  }

  /**
   * Clean up resources
   * Destroys the backend instance
   */
  async destroy(): Promise<void> {
    await this.backend.destroy()
  }
}
