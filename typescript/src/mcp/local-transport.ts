import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'

export interface LocalMCPTransportOptions {
  /** Root directory for the MCP server */
  rootDir: string
  /** Isolation mode (optional) */
  isolation?: 'auto' | 'bwrap' | 'software' | 'none'
  /** Shell to use (optional) */
  shell?: string
}

/**
 * Create options for a local MCP stdio transport.
 * Use this with StdioClientTransport from @modelcontextprotocol/sdk.
 *
 * @example
 * ```typescript
 * import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
 * import { createLocalMCPTransportOptions } from 'agent-backend'
 *
 * const options = createLocalMCPTransportOptions({
 *   rootDir: '/tmp/workspace',
 *   isolation: 'software',
 * })
 * const transport = new StdioClientTransport(options)
 * ```
 */
export function createLocalMCPTransportOptions(
  options: LocalMCPTransportOptions
): StdioServerParameters {
  const args = [
    'daemon',
    '--rootDir', options.rootDir,
    '--local-only',
  ]

  if (options.isolation && options.isolation !== 'auto') {
    args.push('--isolation', options.isolation)
  }

  if (options.shell && options.shell !== 'auto') {
    args.push('--shell', options.shell)
  }

  return {
    command: 'agent-backend',
    args,
  }
}

export interface MemoryMCPTransportOptions {
  /** Root directory/namespace for the memory backend */
  rootDir: string
}

/**
 * Create options for a memory backend MCP stdio transport.
 */
export function createMemoryMCPTransportOptions(
  options: MemoryMCPTransportOptions
): StdioServerParameters {
  return {
    command: 'agent-backend',
    args: [
      '--backend', 'memory',
      '--rootDir', options.rootDir,
    ],
  }
}
