import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Stats } from 'fs'
import { clearTimeout, setTimeout } from 'node:timers'
import * as path from 'path'
import type { ConnectConfig, SFTPWrapper } from 'ssh2'
import { SSH2Client, type SSH2ClientType } from '../utils/ssh2.js'
import { ERROR_CODES } from '../constants.js'
import { createBackendMCPTransport } from '../mcp/transport.js'
import { isCommandSafe, isDangerous } from '../safety.js'
import { BackendError, DangerousOperationError } from '../types.js'
import { getLogger } from '../utils/logger.js'
import type { ExecOptions, ReadOptions, ReconnectionConfig, RemoteFilesystemBackendConfig, ScopeConfig } from './config.js'
import { validateRemoteFilesystemBackendConfig } from './config.js'
import { ConnectionStatusManager } from './ConnectionStatusManager.js'
import { validateWithinBoundary } from './pathValidation.js'
import { ScopedFilesystemBackend } from './ScopedFilesystemBackend.js'
import type { Backend, FileBasedBackend, ScopedBackend, StatusChangeCallback, Unsubscribe } from './types.js'
import { BackendType, ConnectionStatus } from './types.js'
import { WebSocketSSHTransport } from './transports/WebSocketSSHTransport.js'

/** Transport type for SSH operations */
type TransportType = 'ssh-ws' | 'ssh'

/** Default timeout for filesystem operations in milliseconds (120 seconds) */
const DEFAULT_OPERATION_TIMEOUT_MS = 120_000

/** SSH keep-alive interval in milliseconds (30 seconds) */
const DEFAULT_KEEPALIVE_INTERVAL_MS = 30_000

/** Number of missed keep-alives before considering connection dead */
const DEFAULT_KEEPALIVE_COUNT_MAX = 3

/**
 * Maximum concurrent SSH channels per connection.
 * Server MaxSessions is 64, we use 50 to leave headroom.
 */
const MAX_CONCURRENT_CHANNELS = 50

/** Represents a pending operation that can be rejected on connection loss */
interface PendingOperation {
  reject: (error: Error) => void
  description: string
}

/** Queued operation waiting for a channel slot */
interface QueuedOperation<T> {
  execute: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

/**
 * Remote filesystem backend implementation using SSH + HTTP MCP
 *
 * CLIENT-SIDE ONLY: This backend is used by clients to connect to a remote agentbe-daemon.
 * agentbe-daemon (the daemon) does NOT use this - it's just an MCP server with filesystem tools.
 *
 * Architecture:
 * - Machine A (Client): Creates RemoteFilesystemBackend instance
 * - Machine B (agentbe-daemon): Runs `agent-backend daemon --rootDir /agentbe`
 *
 * The client connects to Machine B via TWO channels:
 * 1. SSH client → sshd on Machine B (for direct exec, read, write, etc.)
 * 2. MCP client (HTTP) → agentbe-daemon on Machine B (for MCP tool execution)
 *
 * Both connections target the same machine and filesystem.
 *
 * Executes commands and file operations on a remote server via SSH/SFTP
 */
export class RemoteFilesystemBackend implements FileBasedBackend {
  readonly type = BackendType.REMOTE_FILESYSTEM
  readonly rootDir: string

  private readonly statusManager = new ConnectionStatusManager(ConnectionStatus.DISCONNECTED)
  private readonly config: RemoteFilesystemBackendConfig

  /** Transport type being used */
  private readonly transportType: TransportType

  /** WebSocket SSH transport (used when transport is 'ssh-ws') */
  private wsTransport: WebSocketSSHTransport | null = null

  /** Conventional SSH client (used when transport is 'ssh') */
  private sshClient: SSH2ClientType | null = null
  private connectionPromise: Promise<void> | null = null

  /** Track pending operations so we can reject them on connection loss */
  private pendingOperations = new Set<PendingOperation>()

  /** Current number of active SSH channels */
  private activeChannels = 0

  /** Queue of operations waiting for a channel slot */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private operationQueue: QueuedOperation<any>[] = []

  /** Cached SFTP session - reused for all SFTP operations to avoid channel exhaustion */
  private sftpSession: SFTPWrapper | null = null
  private sftpSessionPromise: Promise<SFTPWrapper> | null = null

  /** Configurable timeout values */
  private readonly operationTimeoutMs: number
  private readonly keepaliveIntervalMs: number
  private readonly keepaliveCountMax: number

  /** Track active scoped backends for reference counting */
  private readonly _activeScopes = new Set<ScopedFilesystemBackend>()

  /** Reconnection configuration */
  private readonly reconnectionConfig: Required<ReconnectionConfig>

  /** Current reconnection attempt count */
  private reconnectAttempts = 0

  /** Timer for pending reconnection */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** Whether this backend has been destroyed */
  private destroyed = false

  get status(): ConnectionStatus {
    return this.statusManager.status
  }

  onStatusChange(cb: StatusChangeCallback): Unsubscribe {
    return this.statusManager.onStatusChange(cb)
  }

  constructor(config: RemoteFilesystemBackendConfig) {
    validateRemoteFilesystemBackendConfig(config)

    this.config = config
    this.rootDir = config.rootDir

    // Determine transport type (default to ssh-ws)
    this.transportType = config.transport ?? 'ssh-ws'

    // Validate configuration based on transport type
    if (this.transportType === 'ssh' && !config.sshAuth) {
      throw new BackendError(
        'sshAuth is required when using conventional SSH transport. ' +
        'Either provide sshAuth or use transport: "ssh-ws" with authToken.',
        ERROR_CODES.INVALID_CONFIGURATION
      )
    }

    if (this.transportType === 'ssh-ws' && !config.authToken) {
      getLogger().warn(
        'No authToken provided for ssh-ws transport. ' +
        'Connection will only work if server has auth disabled.'
      )
    }

    // Initialize configurable timeouts with defaults
    this.operationTimeoutMs = config.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS
    this.keepaliveIntervalMs = config.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS
    this.keepaliveCountMax = config.keepaliveCountMax ?? DEFAULT_KEEPALIVE_COUNT_MAX

    // Parse reconnection config with defaults
    const rc = config.reconnection ?? {}
    this.reconnectionConfig = {
      enabled: rc.enabled ?? true,
      maxRetries: rc.maxRetries ?? 5,
      initialDelayMs: rc.initialDelayMs ?? 1000,
      maxDelayMs: rc.maxDelayMs ?? 30000,
      backoffMultiplier: rc.backoffMultiplier ?? 2,
    }
  }

  /**
   * Extract username from SSH auth configuration
   */
  private getUserFromAuth(): string {
    const auth = this.config.sshAuth
    return auth?.credentials?.username ?? 'agent'
  }

  /**
   * Blocked environment variables that could lead to code injection
   */
  private static readonly BLOCKED_VARS = [
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'IFS',
    'BASH_ENV',
    'ENV',
  ]

  /**
   * Protected environment variables that are allowed but should be used carefully
   */
  private static readonly PROTECTED_VARS = ['PATH', 'HOME', 'PWD', 'TMPDIR', 'TMP', 'SHELL', 'USER']

  /**
   * Validate custom environment variables for security
   */
  private validateCustomEnv(customEnv: Record<string, string | undefined>): Record<string, string | undefined> {
    const validated: Record<string, string | undefined> = {}

    for (const [key, value] of Object.entries(customEnv)) {
      // Block dangerous variables
      if (RemoteFilesystemBackend.BLOCKED_VARS.includes(key)) {
        getLogger().warn(`Blocked dangerous environment variable: ${key}`)
        continue
      }

      // Warn about protected variables (allow but log)
      if (RemoteFilesystemBackend.PROTECTED_VARS.includes(key)) {
        getLogger().warn(`Overriding protected environment variable: ${key}`)
      }

      // Allow undefined to unset variables
      if (value === undefined) {
        validated[key] = undefined
        continue
      }

      // Validate value doesn't contain dangerous characters
      if (value.includes('\0') || value.includes('\n') || value.includes(';')) {
        throw new BackendError(
          `Environment variable ${key} contains dangerous characters`,
          ERROR_CODES.INVALID_CONFIGURATION
        )
      }

      validated[key] = value
    }

    return validated
  }

  /**
   * Build environment variable prefix for SSH commands
   */
  private buildEnvPrefix(customEnv?: Record<string, string | undefined>): string {
    if (!customEnv || Object.keys(customEnv).length === 0) {
      return ''
    }

    const validatedEnv = this.validateCustomEnv(customEnv)
    const envPairs: string[] = []

    for (const [key, value] of Object.entries(validatedEnv)) {
      if (value === undefined) {
        envPairs.push(`unset ${key};`)
      } else {
        // Escape single quotes in values and wrap in single quotes
        const escapedValue = value.replace(/'/g, "'\\''")
        envPairs.push(`${key}='${escapedValue}'`)
      }
    }

    return envPairs.length > 0 ? `${envPairs.join(' ')} ` : ''
  }

  /**
   * Build the full command string with HOME, environment variables, and directory context.
   * This encapsulates the pattern: HOME='<cwd>' <env vars> cd "<cwd>" && <command>
   *
   * @param command - The command to execute
   * @param cwd - Working directory (also used as HOME)
   * @param customEnv - Optional additional environment variables
   * @returns The full command string ready for SSH execution
   */
  buildFullCommand(command: string, cwd: string, customEnv?: Record<string, string | undefined>): string {
    const envPrefix = this.buildEnvPrefix(customEnv)

    // Set HOME to cwd so ~ and $HOME reference the workspace
    const homePrefix = cwd && cwd !== '/' ? `HOME='${cwd}' ` : ''

    if (cwd && cwd !== '/') {
      return `${homePrefix}${envPrefix}cd "${cwd}" && ${command}`
    }
    return `${envPrefix}${command}`
  }

  /**
   * Resolve and validate path is within rootDir
   * Uses shared validation utility for DRY
   */
  private resolvePath(relativePath: string): string {
    // Use shared validation - strips leading slash if absolute, validates boundary
    // Remote always uses path.posix for consistency
    return validateWithinBoundary(relativePath, this.rootDir, path.posix)
  }

  /**
   * Execute shell command in root directory
   */
  async exec(command: string, options?: ExecOptions): Promise<string | Buffer> {
    if (!command.trim()) {
      throw new BackendError('Command cannot be empty', ERROR_CODES.EMPTY_COMMAND)
    }

    // Safety checks (only if preventDangerous is enabled)
    if (this.config.preventDangerous) {
      if (isDangerous(command)) {
        const error = new DangerousOperationError(command)
        if (this.config.onDangerousOperation) {
          this.config.onDangerousOperation(command)
          return options?.encoding === 'buffer' ? Buffer.alloc(0) : ''
        }
        throw error
      }

      const safetyCheck = isCommandSafe(command)
      if (!safetyCheck.safe) {
        throw new BackendError(safetyCheck.reason || 'Command failed safety check', ERROR_CODES.DANGEROUS_OPERATION, command)
      }
    }

    // Ensure SSH connection is established
    await this.ensureSSHConnection()

    const cwd = options?.cwd ?? this.rootDir
    const encoding = options?.encoding ?? 'utf8'
    const fullCommand = this.buildFullCommand(command, cwd, options?.env)

    // Use appropriate transport
    if (this.transportType === 'ssh-ws') {
      return this.execViaWebSocket(fullCommand, command, encoding)
    } else {
      return this.execViaConventionalSSH(fullCommand, command, encoding)
    }
  }

  /**
   * Execute command via WebSocket SSH transport
   */
  private async execViaWebSocket(
    fullCommand: string,
    originalCommand: string,
    encoding: 'utf8' | 'buffer'
  ): Promise<string | Buffer> {
    if (!this.wsTransport) {
      throw new BackendError('WebSocket transport not initialized', ERROR_CODES.EXEC_FAILED)
    }

    getLogger().debug(`[SSH-WS exec] Executing command: ${fullCommand}`)

    try {
      const result = await this.wsTransport.exec(fullCommand, {
        timeout: this.operationTimeoutMs
      })

      if (result.code === 0) {
        if (encoding === 'buffer') {
          return Buffer.from(result.stdout)
        } else {
          let output = result.stdout.trim()

          if (this.config.maxOutputLength && output.length > this.config.maxOutputLength) {
            const truncatedLength = this.config.maxOutputLength - 50
            output = `${output.substring(0, truncatedLength)}\n\n... [Output truncated. Full output was ${output.length} characters, showing first ${truncatedLength}]`
          }

          return output
        }
      } else {
        const errorMessage = result.stderr.trim() || result.stdout.trim()
        throw new BackendError(
          `Command failed with exit code ${result.code}: ${errorMessage}`,
          ERROR_CODES.EXEC_FAILED,
          originalCommand
        )
      }
    } catch (err: any) {
      if (err instanceof BackendError) throw err
      throw new BackendError(
        `SSH command failed: ${err.message}`,
        ERROR_CODES.EXEC_FAILED,
        originalCommand
      )
    }
  }

  /**
   * Execute command via conventional SSH
   */
  private async execViaConventionalSSH(
    fullCommand: string,
    originalCommand: string,
    encoding: 'utf8' | 'buffer'
  ): Promise<string | Buffer> {
    if (!this.sshClient) {
      throw new BackendError('SSH client not initialized', ERROR_CODES.EXEC_FAILED)
    }

    // Use channel limiting
    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      if (!this.sshClient) {
        reject(new BackendError('SSH client not initialized', ERROR_CODES.EXEC_FAILED))
        return
      }

      getLogger().debug(`[SSH exec] Executing command: ${fullCommand}`)

      let completed = false
      const untrack = this.trackOperation(`exec: ${originalCommand}`, reject)

      const complete = () => {
        if (!completed) {
          completed = true
          clearTimeout(timeout)
          untrack()
        }
      }

      const timeout = setTimeout(() => {
        if (!completed) {
          complete()
          getLogger().error(`[SSH exec] Command timed out after ${this.operationTimeoutMs}ms: ${originalCommand}`)
          reject(new BackendError(
            `SSH command timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.EXEC_FAILED,
            originalCommand
          ))
        }
      }, this.operationTimeoutMs)

      this.sshClient.exec(fullCommand, (err: Error | undefined, stream: import('ssh2').ClientChannel) => {
        if (err) {
          if (completed) return
          complete()
          reject(new BackendError(
            `SSH command failed: ${err.message}`,
            ERROR_CODES.EXEC_FAILED,
            originalCommand
          ))
          return
        }

        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []

        stream.on('error', (streamErr: Error) => {
          if (completed) return
          complete()
          reject(new BackendError(
            `SSH stream error: ${streamErr.message}`,
            ERROR_CODES.EXEC_FAILED,
            originalCommand
          ))
        })

        stream.on('data', (data: Buffer) => stdoutChunks.push(data))
        stream.stderr.on('data', (data: Buffer) => stderrChunks.push(data))

        stream.on('close', (code: number) => {
          if (completed) return
          complete()

          const stdoutBuffer = Buffer.concat(stdoutChunks)
          const stderrBuffer = Buffer.concat(stderrChunks)

          if (code === 0) {
            if (encoding === 'buffer') {
              resolve(stdoutBuffer)
            } else {
              let output = stdoutBuffer.toString('utf-8').trim()

              if (this.config.maxOutputLength && output.length > this.config.maxOutputLength) {
                const truncatedLength = this.config.maxOutputLength - 50
                output = `${output.substring(0, truncatedLength)}\n\n... [Output truncated. Full output was ${output.length} characters, showing first ${truncatedLength}]`
              }

              resolve(output)
            }
          } else {
            const errorMessage = stderrBuffer.toString('utf-8').trim() || stdoutBuffer.toString('utf-8').trim()
            reject(new BackendError(
              `Command failed with exit code ${code}: ${errorMessage}`,
              ERROR_CODES.EXEC_FAILED,
              originalCommand
            ))
          }
        })
      })
    }))
  }

  /**
   * Read file from remote
   */
  async read(relativePath: string, options?: ReadOptions): Promise<string | Buffer> {
    const fullPath = this.resolvePath(relativePath)
    const encoding = options?.encoding ?? 'utf8'

    const sftp = await this.getSFTPSession()

    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      let completed = false
      const untrack = this.trackOperation(`read: ${relativePath}`, reject)

      const complete = () => {
        if (!completed) {
          completed = true
          clearTimeout(timeout)
          untrack()
        }
      }

      const timeout = setTimeout(() => {
        if (!completed) {
          complete()
          getLogger().error(`[SFTP] readFile timed out after ${this.operationTimeoutMs}ms: ${fullPath}`)
          reject(new BackendError(
            `readFile timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.READ_FAILED
          ))
        }
      }, this.operationTimeoutMs)

      if (encoding === 'buffer') {
        sftp.readFile(fullPath, (readErr, data) => {
          if (completed) return
          complete()
          if (readErr) {
            reject(new BackendError(
              `Failed to read file: ${relativePath}`,
              ERROR_CODES.READ_FAILED,
              'read'
            ))
          } else {
            resolve(data)
          }
        })
      } else {
        sftp.readFile(fullPath, 'utf8', (readErr, data) => {
          if (completed) return
          complete()
          if (readErr) {
            reject(new BackendError(
              `Failed to read file: ${relativePath}`,
              ERROR_CODES.READ_FAILED,
              'read'
            ))
          } else {
            // When encoding is 'utf8', data is string (not Buffer)
            resolve(data as unknown as string)
          }
        })
      }
    }))
  }

  /**
   * Write content to file
   */
  async write(relativePath: string, content: string | Buffer): Promise<void> {
    const fullPath = this.resolvePath(relativePath)

    // Ensure parent directory exists
    const parentDir = path.posix.dirname(fullPath)
    await this.mkdir(path.posix.relative(this.rootDir, parentDir), { recursive: true })

    const sftp = await this.getSFTPSession()

    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      let completed = false
      const untrack = this.trackOperation(`write: ${relativePath}`, reject)

      const complete = () => {
        if (!completed) {
          completed = true
          clearTimeout(timeout)
          untrack()
        }
      }

      const timeout = setTimeout(() => {
        if (!completed) {
          complete()
          getLogger().error(`[SFTP] writeFile timed out after ${this.operationTimeoutMs}ms: ${fullPath}`)
          reject(new BackendError(
            `writeFile timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.WRITE_FAILED
          ))
        }
      }, this.operationTimeoutMs)

      sftp.writeFile(fullPath, content, (writeErr) => {
        if (completed) return
        complete()
        if (writeErr) {
          reject(new BackendError(
            `Failed to write file: ${relativePath}`,
            ERROR_CODES.WRITE_FAILED,
            'write'
          ))
        } else {
          resolve()
        }
      })
    }))
  }

  /**
   * Read file contents (alias for read, matches Node fs.promises API)
   */
  async readFile(relativePath: string, options?: ReadOptions): Promise<string | Buffer> {
    return this.read(relativePath, options)
  }

  /**
   * Write content to file (alias for write, matches Node fs.promises API)
   */
  async writeFile(relativePath: string, content: string | Buffer): Promise<void> {
    return this.write(relativePath, content)
  }

  /**
   * Rename or move a file/directory (matches Node fs.promises API)
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const fullOldPath = this.resolvePath(oldPath)
    const fullNewPath = this.resolvePath(newPath)

    // Ensure parent directory exists
    const parentDir = path.posix.dirname(fullNewPath)
    await this.mkdir(path.posix.relative(this.rootDir, parentDir), { recursive: true })

    const sftp = await this.getSFTPSession()

    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      let completed = false
      const untrack = this.trackOperation(`rename: ${oldPath} -> ${newPath}`, reject)

      const complete = () => {
        if (!completed) {
          completed = true
          clearTimeout(timeout)
          untrack()
        }
      }

      const timeout = setTimeout(() => {
        if (!completed) {
          complete()
          getLogger().error(`[SFTP] rename timed out after ${this.operationTimeoutMs}ms: ${oldPath} -> ${newPath}`)
          reject(new BackendError(
            `rename timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.WRITE_FAILED
          ))
        }
      }, this.operationTimeoutMs)

      sftp.rename(fullOldPath, fullNewPath, (err) => {
        if (completed) return
        complete()
        if (err) {
          reject(new BackendError(
            `Failed to rename: ${oldPath} -> ${newPath}`,
            ERROR_CODES.WRITE_FAILED,
            'rename'
          ))
        } else {
          resolve()
        }
      })
    }))
  }

  /**
   * Delete files and directories (matches Node fs.promises API)
   */
  async rm(relativePath: string, options?: { recursive?: boolean, force?: boolean }): Promise<void> {
    const fullPath = this.resolvePath(relativePath)

    // Build rm command with flags
    const flags: string[] = []
    if (options?.recursive) flags.push('-r')
    if (options?.force) flags.push('-f')

    const flagsStr = flags.length > 0 ? ` ${flags.join(' ')}` : ''
    await this.exec(`rm${flagsStr} "${fullPath}"`)
  }

  /**
   * List directory contents
   */
  async readdir(relativePath: string): Promise<string[]> {
    const fullPath = this.resolvePath(relativePath)
    const sftp = await this.getSFTPSession()

    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      let completed = false
      const untrack = this.trackOperation(`readdir: ${relativePath}`, reject)

      const complete = () => {
        if (!completed) {
          completed = true
          clearTimeout(timeout)
          untrack()
        }
      }

      const timeout = setTimeout(() => {
        if (!completed) {
          complete()
          reject(new BackendError(
            `readdir timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.LS_FAILED
          ))
        }
      }, this.operationTimeoutMs)

      sftp.readdir(fullPath, (err, list) => {
        if (completed) return
        complete()
        if (err) {
          reject(new BackendError(
            `Failed to read directory: ${relativePath}: ${err.message}`,
            ERROR_CODES.LS_FAILED,
            'readdir'
          ))
        } else {
          resolve(list.map(item => item.filename))
        }
      })
    }))
  }

  /**
   * List directory contents with stats for each entry.
   * Highly efficient for SFTP - attrs are returned with readdir, no extra stat calls needed.
   */
  async readdirWithStats(relativePath: string): Promise<{ name: string, stats: Stats }[]> {
    const fullPath = this.resolvePath(relativePath)
    const sftp = await this.getSFTPSession()

    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      let completed = false
      const untrack = this.trackOperation(`readdirWithStats: ${relativePath}`, reject)

      const complete = () => {
        if (!completed) {
          completed = true
          clearTimeout(timeout)
          untrack()
        }
      }

      const timeout = setTimeout(() => {
        if (!completed) {
          complete()
          reject(new BackendError(
            `readdirWithStats timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.LS_FAILED
          ))
        }
      }, this.operationTimeoutMs)

      sftp.readdir(fullPath, (err, list) => {
        if (completed) return
        complete()
        if (err) {
          reject(new BackendError(
            `Failed to read directory: ${relativePath}: ${err.message}`,
            ERROR_CODES.LS_FAILED,
            'readdirWithStats'
          ))
        } else {
          // SFTP attrs are already included - convert to Stats-like objects
          const results = list.map(item => ({
            name: item.filename,
            // SSH2 Stats is compatible with fs.Stats for our purposes
            stats: item.attrs as unknown as Stats,
          }))
          resolve(results)
        }
      })
    }))
  }

  /**
   * Create directory
   */
  async mkdir(relativePath: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      // Use SSH command for recursive mkdir (exec uses full paths internally)
      const fullPath = this.resolvePath(relativePath)
      await this.exec(`mkdir -p "${fullPath}"`)
    } else {
      const fullPath = this.resolvePath(relativePath)
      const sftp = await this.getSFTPSession()

      return this.withChannelLimit(() => new Promise((resolve, reject) => {
        let completed = false
        const untrack = this.trackOperation(`mkdir: ${relativePath}`, reject)

        const complete = () => {
          if (!completed) {
            completed = true
            clearTimeout(timeout)
            untrack()
          }
        }

        const timeout = setTimeout(() => {
          if (!completed) {
            complete()
            reject(new BackendError(
              `mkdir timed out after ${this.operationTimeoutMs}ms`,
              ERROR_CODES.WRITE_FAILED
            ))
          }
        }, this.operationTimeoutMs)

        sftp.mkdir(fullPath, (err) => {
          if (completed) return
          complete()
          if (err) {
            const errMsg = err.message || String(err)
            reject(new BackendError(
              `Failed to create directory: ${relativePath} - ${errMsg}`,
              ERROR_CODES.WRITE_FAILED,
              'mkdir'
            ))
          } else {
            resolve()
          }
        })
      }))
    }
  }

  /**
   * Create empty file
   */
  async touch(relativePath: string): Promise<void> {
    await this.write(relativePath, '')
  }

  /**
   * Check if path exists
   */
  async exists(relativePath: string): Promise<boolean> {
    const fullPath = this.resolvePath(relativePath)
    const sftp = await this.getSFTPSession()

    return this.withChannelLimit(() => new Promise((resolve) => {
      sftp.stat(fullPath, (err) => {
        resolve(!err)
      })
    }))
  }

  /**
   * Get file/directory stats
   */
  async stat(relativePath: string): Promise<Stats> {
    const fullPath = this.resolvePath(relativePath)
    const sftp = await this.getSFTPSession()

    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      let completed = false
      const untrack = this.trackOperation(`stat: ${relativePath}`, reject)

      const complete = () => {
        if (!completed) {
          completed = true
          clearTimeout(timeout)
          untrack()
        }
      }

      const timeout = setTimeout(() => {
        if (!completed) {
          complete()
          reject(new BackendError(
            `stat timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.READ_FAILED
          ))
        }
      }, this.operationTimeoutMs)

      sftp.stat(fullPath, (err, stats) => {
        if (completed) return
        complete()
        if (err) {
          reject(new BackendError(
            `Failed to stat path: ${relativePath}`,
            ERROR_CODES.READ_FAILED,
            'stat'
          ))
        } else {
          // SSH2 Stats is compatible with fs.Stats for our purposes
          resolve(stats as unknown as Stats)
        }
      })
    }))
  }

  /**
   * Create scoped backend
   */
  scope(scopePath: string, config?: ScopeConfig): ScopedBackend<this> {
    const scoped = new ScopedFilesystemBackend(this, scopePath, config)
    this._activeScopes.add(scoped)
    return scoped as ScopedBackend<this>
  }

  /**
   * List all active scoped backends created from this backend
   * @returns Array of scope paths for currently active scopes
   */
  async listActiveScopes(): Promise<string[]> {
    return Array.from(this._activeScopes).map(scope => scope.scopePath)
  }

  /**
   * Called by child scopes when they are destroyed.
   * Unregisters the child from tracking.
   *
   * Note: Does NOT auto-destroy the parent when no children remain.
   * The owner of this backend (e.g., pool manager or direct caller) is
   * responsible for calling destroy() when appropriate.
   *
   * @param child - The child backend that was destroyed
   */
  async onChildDestroyed(child: Backend): Promise<void> {
    this._activeScopes.delete(child as ScopedFilesystemBackend)
  }

  /**
   * Get MCP transport for this backend.
   * Can be used directly with Vercel AI SDK's createMCPClient or raw MCP SDK.
   *
   * @param scopePath - Optional scope path to use as rootDir
   * @returns StreamableHTTPClientTransport configured for this backend
   */
  async getMCPTransport(scopePath?: string): Promise<Transport> {
    return createBackendMCPTransport(this, scopePath)
  }

  /**
   * Get MCP client for remote backend.
   * Connects to HTTP MCP server running on the remote host.
   *
   * Remote backends MUST use HTTP to connect to an MCP server running on the remote host.
   * The principle: "The MCP server has to be in the same system as the files it manages."
   *
   * @param scopePath - Optional scope path to use as rootDir
   * @returns MCP Client connected to HTTP MCP server on remote host
   * @throws {BackendError} If host is not configured
   */
  async getMCPClient(_scopePath?: string): Promise<MCPClient> {
    // Remote backends MUST use HTTP to connect to MCP server on remote host
    if (!this.config.host) {
      throw new BackendError(
        'RemoteFilesystemBackend requires host to be configured. ' +
        'The MCP server must run on the remote host and be accessible via HTTP. ' +
        'Start the MCP server on the remote host with: ' +
        `agent-backend daemon --rootDir ${this.rootDir}`,
        ERROR_CODES.INVALID_CONFIGURATION,
        'host'
      )
    }

    // Construct MCP server URL from host and port
    const mcpHost = this.config.mcpServerHostOverride || this.config.host
    const mcpPort = this.config.port ?? this.config.mcpPort ?? 3001
    const mcpServerUrl = `http://${mcpHost}:${mcpPort}`

    // Use unified authToken or fallback to mcpAuth.token
    const authToken = this.config.authToken ?? this.config.mcpAuth?.token

    // Create HTTP transport to remote MCP server
    const transport = new StreamableHTTPClientTransport(
      new URL('/mcp', mcpServerUrl),
      {
        requestInit: {
          headers: {
            ...(authToken && {
              'Authorization': `Bearer ${authToken}`,
            }),
          },
        },
      }
    )

    const client = new MCPClient(
      {
        name: 'remote-filesystem-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    )

    await client.connect(transport)
    return client
  }

  /**
   * Clean up backend resources
   */
  async destroy(): Promise<void> {
    this.destroyed = true

    // Cancel pending reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Clear active scopes - they become orphaned but that's expected
    // when the parent is explicitly destroyed
    if (this._activeScopes.size > 0) {
      getLogger().debug(`RemoteFilesystemBackend destroying with ${this._activeScopes.size} active scopes`)
      this._activeScopes.clear()
    }

    // Reject all pending operations
    const error = new BackendError('Backend destroyed', 'CONNECTION_CLOSED')
    for (const op of this.pendingOperations) {
      op.reject(error)
    }
    this.pendingOperations.clear()

    // Close SFTP session
    if (this.sftpSession) {
      try {
        this.sftpSession.end()
      } catch (err) {
        getLogger().debug('[SFTP] Error closing SFTP session:', err)
      }
      this.sftpSession = null
      this.sftpSessionPromise = null
    }

    // Close WebSocket transport
    if (this.wsTransport) {
      try {
        await this.wsTransport.disconnect()
      } catch (err) {
        getLogger().debug('[SSH-WS] Error closing WebSocket transport:', err)
      }
      this.wsTransport = null
    }

    // Close conventional SSH connection
    if (this.sshClient) {
      try {
        this.sshClient.end()
      } catch (err) {
        getLogger().debug('[SSH] Error closing SSH connection:', err)
      }
      this.sshClient = null
    }

    this.connectionPromise = null
    this.statusManager.setStatus(ConnectionStatus.DESTROYED)
    this.statusManager.clearListeners()
    getLogger().debug(`RemoteFilesystemBackend destroyed for root: ${this.rootDir}`)
  }

  // =========================================================================
  // Private SSH Connection Management Methods
  // =========================================================================

  /**
   * Ensure SSH connection is established (either ssh-ws or conventional ssh)
   */
  private async ensureSSHConnection(): Promise<void> {
    if (this.statusManager.status === ConnectionStatus.CONNECTED) {
      // Check if the appropriate transport is connected
      if (this.transportType === 'ssh-ws' && this.wsTransport?.connected) {
        return
      }
      if (this.transportType === 'ssh' && this.sshClient) {
        return
      }
    }

    if (this.connectionPromise) {
      return this.connectionPromise
    }

    // Set status based on whether this is a first connect or reconnect
    const connectingStatus = this.reconnectAttempts > 0
      ? ConnectionStatus.RECONNECTING
      : ConnectionStatus.CONNECTING

    this.statusManager.setStatus(connectingStatus)

    if (this.transportType === 'ssh-ws') {
      this.connectionPromise = this.createWebSocketSSHConnection()
    } else {
      this.connectionPromise = this.createConventionalSSHConnection()
    }

    return this.connectionPromise
  }

  /**
   * Create WebSocket SSH connection
   */
  private async createWebSocketSSHConnection(): Promise<void> {
    const port = this.config.port ?? this.config.mcpPort ?? 3001

    this.wsTransport = new WebSocketSSHTransport({
      host: this.config.sshHostOverride || this.config.host,
      port,
      path: '/ssh',
      authToken: this.config.authToken ?? this.config.mcpAuth?.token,
      timeout: this.operationTimeoutMs,
      keepaliveInterval: this.keepaliveIntervalMs
    })

    this.wsTransport.on('close', () => {
      getLogger().debug('[SSH-WS] Connection closed')
      this.sftpSession = null
      this.sftpSessionPromise = null

      // Reject all pending operations
      const error = new BackendError('SSH connection closed', 'CONNECTION_CLOSED')
      for (const op of this.pendingOperations) {
        op.reject(error)
      }
      this.pendingOperations.clear()

      this.statusManager.setStatus(ConnectionStatus.DISCONNECTED)
      this.scheduleReconnect()
    })

    try {
      await this.wsTransport.connect()
      getLogger().debug('[SSH-WS] Connection established')
      this.reconnectAttempts = 0
      this.connectionPromise = null
      this.statusManager.setStatus(ConnectionStatus.CONNECTED)
    } catch (err: any) {
      this.connectionPromise = null
      this.wsTransport = null
      const connectError = new BackendError(
        `SSH-WS connection failed: ${err.message}`,
        ERROR_CODES.EXEC_FAILED
      )
      this.statusManager.setStatus(ConnectionStatus.DISCONNECTED, connectError)
      throw connectError
    }
  }

  /**
   * Create conventional SSH connection (to sshd)
   */
  private async createConventionalSSHConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sshClient = new SSH2Client()

      if (!this.config.sshAuth) {
        reject(new BackendError(
          'sshAuth is required for conventional SSH transport',
          ERROR_CODES.INVALID_CONFIGURATION
        ))
        return
      }

      const connectConfig: ConnectConfig = {
        host: this.config.sshHostOverride || this.config.host,
        port: this.config.port ?? this.config.sshPort ?? 22,
        username: this.getUserFromAuth(),
        keepaliveInterval: this.keepaliveIntervalMs,
        keepaliveCountMax: this.keepaliveCountMax,
        readyTimeout: this.operationTimeoutMs,
      }

      // Add auth credentials
      if (this.config.sshAuth.type === 'password') {
        connectConfig.password = this.config.sshAuth.credentials.password
      } else if (this.config.sshAuth.type === 'key') {
        connectConfig.privateKey = this.config.sshAuth.credentials.privateKey
      }

      sshClient.on('ready', () => {
        getLogger().debug('[SSH] Connection established')
        this.sshClient = sshClient
        this.reconnectAttempts = 0
        this.connectionPromise = null
        this.statusManager.setStatus(ConnectionStatus.CONNECTED)
        resolve()
      })

      sshClient.on('error', (err: Error) => {
        getLogger().error('[SSH] Connection error:', err)
        this.connectionPromise = null
        const connectError = new BackendError(
          `SSH connection failed: ${err.message}`,
          ERROR_CODES.EXEC_FAILED
        )
        this.statusManager.setStatus(ConnectionStatus.DISCONNECTED, connectError)
        reject(connectError)
      })

      sshClient.on('close', () => {
        getLogger().debug('[SSH] Connection closed')
        this.sshClient = null
        this.sftpSession = null
        this.sftpSessionPromise = null

        // Reject all pending operations
        const error = new BackendError('SSH connection closed', 'CONNECTION_CLOSED')
        for (const op of this.pendingOperations) {
          op.reject(error)
        }
        this.pendingOperations.clear()

        this.statusManager.setStatus(ConnectionStatus.DISCONNECTED)
        this.scheduleReconnect()
      })

      sshClient.connect(connectConfig)
    })
  }

  /**
   * Get or create SFTP session
   */
  private async getSFTPSession(): Promise<SFTPWrapper> {
    if (this.sftpSession) {
      return this.sftpSession
    }

    if (this.sftpSessionPromise) {
      return this.sftpSessionPromise
    }

    await this.ensureSSHConnection()

    if (this.transportType === 'ssh-ws') {
      // Use WebSocket transport for SFTP
      this.sftpSessionPromise = (async () => {
        if (!this.wsTransport) {
          throw new BackendError('WebSocket transport not initialized', ERROR_CODES.EXEC_FAILED)
        }
        const sftp = await this.wsTransport.getSFTP()
        this.sftpSession = sftp
        this.sftpSessionPromise = null
        return sftp
      })()
    } else {
      // Use conventional SSH client for SFTP
      this.sftpSessionPromise = new Promise((resolve, reject) => {
        if (!this.sshClient) {
          reject(new BackendError('SSH client not initialized', ERROR_CODES.EXEC_FAILED))
          return
        }

        this.sshClient.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
          if (err) {
            this.sftpSessionPromise = null
            reject(new BackendError(
              `Failed to create SFTP session: ${err.message}`,
              ERROR_CODES.EXEC_FAILED
            ))
          } else {
            this.sftpSession = sftp
            this.sftpSessionPromise = null
            resolve(sftp)
          }
        })
      })
    }

    return this.sftpSessionPromise
  }

  /**
   * Track operation for rejection on connection loss
   */
  private trackOperation(description: string, reject: (error: Error) => void): () => void {
    const op: PendingOperation = { description, reject }
    this.pendingOperations.add(op)
    return () => this.pendingOperations.delete(op)
  }

  /**
   * Execute operation with channel limiting
   */
  private async withChannelLimit<T>(operation: () => Promise<T>): Promise<T> {
    // Wait for available channel slot
    while (this.activeChannels >= MAX_CONCURRENT_CHANNELS) {
      await new Promise<void>((resolve) => {
        this.operationQueue.push({
          execute: async () => undefined,
          resolve,
          reject: () => {},
        })
      })
    }

    this.activeChannels++

    try {
      return await operation()
    } finally {
      this.activeChannels--
      this.processQueue()
    }
  }

  /**
   * Process queued operations
   */
  private processQueue(): void {
    while (this.operationQueue.length > 0 && this.activeChannels < MAX_CONCURRENT_CHANNELS) {
      const next = this.operationQueue.shift()
      if (next) {
        this.activeChannels++
        next.execute()
          .then((result) => {
            this.activeChannels--
            next.resolve(result)
            this.processQueue()
          })
          .catch((error) => {
            this.activeChannels--
            next.reject(error)
            this.processQueue()
          })
      }
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.destroyed) return
    if (!this.reconnectionConfig.enabled) return
    if (this.reconnectionConfig.maxRetries > 0 &&
        this.reconnectAttempts >= this.reconnectionConfig.maxRetries) {
      getLogger().debug(`[Reconnect] Max retries (${this.reconnectionConfig.maxRetries}) reached, giving up`)
      return
    }

    const delay = Math.min(
      this.reconnectionConfig.initialDelayMs *
        Math.pow(this.reconnectionConfig.backoffMultiplier, this.reconnectAttempts),
      this.reconnectionConfig.maxDelayMs
    )

    this.reconnectAttempts++
    getLogger().debug(`[Reconnect] Scheduling attempt ${this.reconnectAttempts} in ${delay}ms`)

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (this.destroyed) return

      try {
        await this.ensureSSHConnection()
      } catch (err) {
        getLogger().debug(`[Reconnect] Attempt ${this.reconnectAttempts} failed:`, err)
        // scheduleReconnect is called again from the close handler
      }
    }, delay)
  }
}
