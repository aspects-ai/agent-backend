/**
 * Daemon configuration parsing utilities
 * Extracted from bin/agent-backend.js for testability
 */

export interface DaemonConfig {
  rootDir?: string
  scopePath?: string
  mcpPort: number
  mcpAuthToken?: string
  localOnly: boolean
  sshUsers: Array<{ username: string; password: string }>
  sshPublicKey?: string
  sshAuthorizedKeys?: string
  isolation?: 'auto' | 'bwrap' | 'software' | 'none'
  shell?: 'bash' | 'sh' | 'auto'
}

export interface ParseResult {
  config?: DaemonConfig
  error?: string
}

/**
 * Parse daemon command arguments
 * Returns config object or error message
 */
export function parseDaemonArgs(args: string[]): ParseResult {
  const config: DaemonConfig = {
    mcpPort: 3001,
    localOnly: false,
    sshUsers: [{ username: 'root', password: 'agents' }]
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]

    switch (arg) {
      case '--rootDir':
        if (!next || next.startsWith('--')) {
          return { error: '--rootDir requires a value' }
        }
        config.rootDir = next
        i++
        break

      case '--scopePath':
        if (!next || next.startsWith('--')) {
          return { error: '--scopePath requires a value' }
        }
        // Validate scopePath doesn't contain path traversal
        if (next.includes('..')) {
          return { error: '--scopePath must not contain path traversal sequences (..)' }
        }
        config.scopePath = next.replace(/^\/+/, '') // Strip leading slashes
        i++
        break

      case '--isolation':
        if (!next || next.startsWith('--')) {
          return { error: '--isolation requires a value' }
        }
        if (!['auto', 'bwrap', 'software', 'none'].includes(next)) {
          return { error: `Invalid isolation mode "${next}". Valid modes: auto, bwrap, software, none` }
        }
        config.isolation = next as DaemonConfig['isolation']
        i++
        break

      case '--shell':
        if (!next || next.startsWith('--')) {
          return { error: '--shell requires a value' }
        }
        if (!['bash', 'sh', 'auto'].includes(next)) {
          return { error: `Invalid shell "${next}". Valid shells: bash, sh, auto` }
        }
        config.shell = next as DaemonConfig['shell']
        i++
        break

      case '--mcp-port':
        if (!next || next.startsWith('--')) {
          return { error: '--mcp-port requires a value' }
        }
        const port = parseInt(next, 10)
        if (isNaN(port) || port < 1024 || port > 65535) {
          return { error: '--mcp-port must be between 1024-65535' }
        }
        config.mcpPort = port
        i++
        break

      case '--mcp-auth-token':
        if (!next || next.startsWith('--')) {
          return { error: '--mcp-auth-token requires a value' }
        }
        config.mcpAuthToken = next
        i++
        break

      case '--local-only':
        config.localOnly = true
        break

      case '--ssh-users':
        if (!next || next.startsWith('--')) {
          return { error: '--ssh-users requires a value' }
        }
        try {
          config.sshUsers = next.split(',').map(pair => {
            const [username, password] = pair.split(':')
            if (!username || !password) {
              throw new Error(`Invalid format: ${pair}`)
            }
            return { username: username.trim(), password: password.trim() }
          })
        } catch (e) {
          return { error: `Invalid --ssh-users format. Expected user:pass,user:pass` }
        }
        i++
        break

      case '--ssh-public-key':
        if (!next || next.startsWith('--')) {
          return { error: '--ssh-public-key requires a value' }
        }
        config.sshPublicKey = next
        i++
        break

      case '--ssh-authorized-keys':
        if (!next || next.startsWith('--')) {
          return { error: '--ssh-authorized-keys requires a value' }
        }
        config.sshAuthorizedKeys = next
        i++
        break

      default:
        if (arg.startsWith('--')) {
          return { error: `Unrecognized option: ${arg}` }
        }
    }
  }

  // Validation
  if (!config.rootDir) {
    return { error: '--rootDir is required' }
  }

  return { config }
}

/**
 * Validate that a config is complete and valid
 */
export function validateDaemonConfig(config: DaemonConfig): string | null {
  if (!config.rootDir) {
    return '--rootDir is required'
  }

  if (config.mcpPort < 1024 || config.mcpPort > 65535) {
    return '--mcp-port must be between 1024-65535'
  }

  if (config.isolation && !['auto', 'bwrap', 'software', 'none'].includes(config.isolation)) {
    return `Invalid isolation mode "${config.isolation}"`
  }

  if (config.shell && !['bash', 'sh', 'auto'].includes(config.shell)) {
    return `Invalid shell "${config.shell}"`
  }

  return null
}
