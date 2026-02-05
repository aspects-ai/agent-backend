/**
 * Centralized MCP transport creation for backends.
 *
 * This module provides the core logic for creating MCP transports
 * based on backend type. Used by backends to implement getMCPTransport().
 */

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
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
import { createAgentBeMCPTransport } from './client.js'
import { createLocalMCPTransportOptions, createMemoryMCPTransportOptions } from './local-transport.js'

/**
 * Union type for MCP transports
 */
export type MCPTransport = StdioClientTransport | StreamableHTTPClientTransport

/**
 * Create an MCP transport for a backend.
 *
 * This is the centralized implementation used by all backends.
 * Transport type depends on backend type:
 * - LocalFilesystemBackend → StdioClientTransport (spawns subprocess)
 * - RemoteFilesystemBackend → StreamableHTTPClientTransport (HTTP)
 * - MemoryBackend → StdioClientTransport (spawns subprocess)
 *
 * @param backend - The backend to create a transport for
 * @param scopePath - Optional scope path to override rootDir
 * @returns MCP transport configured for the backend type
 */
export async function createBackendMCPTransport(
  backend: Backend,
  scopePath?: string
): Promise<MCPTransport> {
  const rootBackend = getRootBackend(backend)
  const backendType = rootBackend.type

  switch (backendType) {
    case BackendType.LOCAL_FILESYSTEM:
      return createLocalTransport(backend, rootBackend, scopePath)

    case BackendType.REMOTE_FILESYSTEM:
      return createRemoteTransport(backend, rootBackend, scopePath)

    case BackendType.MEMORY:
      return createMemoryTransport(backend, scopePath)

    default:
      throw new BackendError(
        `Unsupported backend type: ${backendType}. getMCPTransport supports LOCAL_FILESYSTEM, REMOTE_FILESYSTEM, and MEMORY backends.`,
        ERROR_CODES.INVALID_CONFIGURATION,
        'unsupported-backend-type'
      )
  }
}

/**
 * Create Stdio transport for local filesystem backend
 */
async function createLocalTransport(
  backend: Backend,
  rootBackend: Backend,
  scopePath?: string
): Promise<StdioClientTransport> {
  const defaultRootDir = isFileBasedBackend(backend) ? backend.rootDir : '/'
  const rootDir = scopePath || defaultRootDir
  const isolation = getProperty<string>(rootBackend, 'isolation') ||
                    getProperty<string>(rootBackend, 'actualIsolation')
  const shell = getProperty<string>(rootBackend, 'shell')

  const options = createLocalMCPTransportOptions({
    rootDir,
    isolation: isolation as 'auto' | 'bwrap' | 'software' | 'none' | undefined,
    shell,
  })

  return new StdioClientTransport(options)
}

/**
 * Create HTTP transport for remote filesystem backend
 */
async function createRemoteTransport(
  backend: Backend,
  rootBackend: Backend,
  scopePath?: string
): Promise<StreamableHTTPClientTransport> {
  if (!hasRemoteConfig(rootBackend)) {
    throw new BackendError(
      'RemoteFilesystemBackend requires host to be configured. ' +
      'The MCP server must run on the remote host and be accessible via HTTP.',
      ERROR_CODES.INVALID_CONFIGURATION,
      'host'
    )
  }

  const { config } = rootBackend
  const mcpHost = config.mcpServerHostOverride || config.host
  const mcpPort = config.mcpPort || 3001
  const defaultRootDir = isFileBasedBackend(backend) ? backend.rootDir : '/'

  return createAgentBeMCPTransport({
    url: `http://${mcpHost}:${mcpPort}`,
    authToken: config.mcpAuth?.token || '',
    workspaceRoot: scopePath || defaultRootDir,
    userId: '',
    workspace: '',
  })
}

/**
 * Create Stdio transport for memory backend
 */
async function createMemoryTransport(
  backend: Backend,
  scopePath?: string
): Promise<StdioClientTransport> {
  const defaultRootDir = isFileBasedBackend(backend) ? backend.rootDir : '/'
  const rootDir = scopePath || defaultRootDir
  const options = createMemoryMCPTransportOptions({ rootDir })

  return new StdioClientTransport(options)
}
