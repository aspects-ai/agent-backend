import type { Stats } from 'fs'
import { clearTimeout, setTimeout } from 'node:timers'
import * as path from 'path'
import type { ConnectConfig, SFTPWrapper } from 'ssh2'
import { Client } from 'ssh2'
import type { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js'
import { ERROR_CODES } from '../constants.js'
import { BackendError, DangerousOperationError } from '../types.js'
import { isCommandSafe, isDangerous } from '../safety.js'
import { getLogger } from '../utils/logger.js'
import { getPlatformGuidance } from '../utils/nativeLibrary.js'
import type { FileBasedBackend, ScopedBackend } from './types.js'
import type { RemoteFilesystemBackendConfig, ScopeConfig, ExecOptions, ReadOptions } from './config.js'
import { BackendType } from './types.js'
import { validateRemoteFilesystemBackendConfig } from './config.js'
import { ScopedFilesystemBackend } from './ScopedFilesystemBackend.js'
import { validateWithinBoundary } from './pathValidation.js'

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
 * Remote filesystem backend implementation using SSH
 * Executes commands and file operations on a remote server via SSH/SFTP
 */
export class RemoteFilesystemBackend implements FileBasedBackend {
  readonly type = BackendType.REMOTE_FILESYSTEM
  readonly rootDir: string

  private _connected = false
  private sshClient: Client | null = null
  private connectionPromise: Promise<void> | null = null
  private readonly config: RemoteFilesystemBackendConfig

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

  constructor(config: RemoteFilesystemBackendConfig) {
    validateRemoteFilesystemBackendConfig(config)

    this.config = config
    this.rootDir = config.rootDir

    // Initialize configurable timeouts with defaults
    this.operationTimeoutMs = config.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS
    this.keepaliveIntervalMs = config.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS
    this.keepaliveCountMax = config.keepaliveCountMax ?? DEFAULT_KEEPALIVE_COUNT_MAX

    // Check platform support
    const guidance = getPlatformGuidance('remote')
    if (!guidance.supported) {
      const suggestions = guidance.suggestions.join('\n  ')
      throw new BackendError(
        guidance.message || 'Remote backend not supported on this platform',
        ERROR_CODES.BACKEND_NOT_IMPLEMENTED,
        `Suggestions:\n  ${suggestions}`
      )
    }

    // SSH client will be created on first connection (lazy initialization)
    this._connected = false
  }

  get connected(): boolean {
    return this._connected
  }

  /**
   * Extract username from SSH auth configuration
   */
  private getUserFromAuth(): string {
    const auth = this.config.sshAuth
    return auth.credentials.username
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

    // Safety checks
    if (this.config.preventDangerous && isDangerous(command)) {
      const error = new DangerousOperationError(command)
      if (this.config.onDangerousOperation) {
        this.config.onDangerousOperation(command)
        return options?.encoding === 'buffer' ? Buffer.alloc(0) : ''
      }
      throw error
    }

    const safetyCheck = isCommandSafe(command)
    if (!safetyCheck.safe) {
      throw new BackendError(safetyCheck.reason, ERROR_CODES.DANGEROUS_OPERATION, command)
    }

    // Ensure SSH connection is established
    await this.ensureSSHConnection()

    if (!this.sshClient) {
      throw new BackendError('SSH client not initialized', ERROR_CODES.EXEC_FAILED)
    }

    const cwd = options?.cwd ?? this.rootDir
    const encoding = options?.encoding ?? 'utf8'
    const envPrefix = this.buildEnvPrefix(options?.env)

    // Use channel limiting
    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      if (!this.sshClient) {
        reject(new BackendError('SSH client not initialized', ERROR_CODES.EXEC_FAILED))
        return
      }

      // Build full command with environment variables and directory change
      const fullCommand = cwd && cwd !== '/'
        ? `${envPrefix}cd "${cwd}" && ${command}`
        : `${envPrefix}${command}`

      getLogger().debug(`[SSH exec] Executing command: ${fullCommand}`)

      let completed = false
      const untrack = this.trackOperation(`exec: ${command}`, reject)

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
          getLogger().error(`[SSH exec] Command timed out after ${this.operationTimeoutMs}ms: ${command}`)
          reject(new BackendError(
            `SSH command timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.EXEC_FAILED,
            command
          ))
        }
      }, this.operationTimeoutMs)

      this.sshClient.exec(fullCommand, (err, stream) => {
        if (err) {
          if (completed) return
          complete()
          reject(new BackendError(
            `SSH command failed: ${err.message}`,
            ERROR_CODES.EXEC_FAILED,
            command
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
            command
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
              command
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
            resolve(data as string)
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
            `Failed to read directory: ${relativePath}`,
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
   * Create directory
   */
  async mkdir(relativePath: string, options?: { recursive?: boolean }): Promise<void> {
    const fullPath = this.resolvePath(relativePath)

    if (options?.recursive) {
      // Use SSH command for recursive mkdir
      await this.exec(`mkdir -p "${fullPath}"`)
    } else {
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
            reject(new BackendError(
              `Failed to create directory: ${relativePath}`,
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
          resolve(stats as Stats)
        }
      })
    }))
  }

  /**
   * Create scoped backend
   */
  scope(scopePath: string, config?: ScopeConfig): ScopedBackend<this> {
    return new ScopedFilesystemBackend(this, scopePath, config) as ScopedBackend<this>
  }

  /**
   * List all scopes (subdirectories from root)
   */
  async listScopes(): Promise<string[]> {
    try {
      const entries = await this.readdir('.')
      const scopes: string[] = []

      for (const entry of entries) {
        try {
          const stats = await this.stat(entry)
          if (stats.isDirectory()) {
            scopes.push(entry)
          }
        } catch {
          // Skip entries we can't stat
        }
      }

      return scopes
    } catch {
      return []
    }
  }

  /**
   * Get MCP client for remote backend.
   * Spawns agentbe-server with this backend's configuration.
   *
   * @param scopePath - Optional scope path to use as rootDir
   * @returns MCP Client connected to a server for this backend
   */
  async getMCPClient(scopePath?: string): Promise<Client> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

    // Build command args
    const args = [
      '--backend', 'remote',
      '--rootDir', scopePath || this.rootDir,
      '--host', this.host,
      '--username', this.sshAuth.credentials.username,
    ]

    // Add authentication
    if (this.sshAuth.type === 'password' && this.sshAuth.credentials.password) {
      args.push('--password', this.sshAuth.credentials.password)
    } else if (this.sshAuth.type === 'key' && this.sshAuth.credentials.privateKey) {
      args.push('--privateKey', this.sshAuth.credentials.privateKey)
    }

    // Add optional port
    if (this.port && this.port !== 22) {
      args.push('--port', this.port.toString())
    }

    // Spawn agentbe-server
    const transport = new StdioClientTransport({
      command: 'agentbe-server',
      args,
    })

    const client = new Client(
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

    // Close SSH connection
    if (this.sshClient) {
      try {
        this.sshClient.end()
      } catch (err) {
        getLogger().debug('[SSH] Error closing SSH connection:', err)
      }
      this.sshClient = null
      this._connected = false
    }

    this.connectionPromise = null
    getLogger().debug(`RemoteFilesystemBackend destroyed for root: ${this.rootDir}`)
  }

  // =========================================================================
  // Private SSH Connection Management Methods
  // =========================================================================

  /**
   * Ensure SSH connection is established
   */
  private async ensureSSHConnection(): Promise<void> {
    if (this._connected && this.sshClient) {
      return Promise.resolve()
    }

    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.connectionPromise = this.createSSHConnection()
    return this.connectionPromise
  }

  /**
   * Create SSH connection
   */
  private async createSSHConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sshClient = new Client()

      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.sshPort ?? 22,
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
        this._connected = true
        this.connectionPromise = null
        resolve()
      })

      sshClient.on('error', (err) => {
        getLogger().error('[SSH] Connection error:', err)
        this._connected = false
        this.connectionPromise = null
        reject(new BackendError(
          `SSH connection failed: ${err.message}`,
          ERROR_CODES.EXEC_FAILED
        ))
      })

      sshClient.on('close', () => {
        getLogger().debug('[SSH] Connection closed')
        this._connected = false
        this.sshClient = null
        this.sftpSession = null
        this.sftpSessionPromise = null

        // Reject all pending operations
        const error = new BackendError('SSH connection closed', 'CONNECTION_CLOSED')
        for (const op of this.pendingOperations) {
          op.reject(error)
        }
        this.pendingOperations.clear()
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

    this.sftpSessionPromise = new Promise((resolve, reject) => {
      if (!this.sshClient) {
        reject(new BackendError('SSH client not initialized', ERROR_CODES.EXEC_FAILED))
        return
      }

      this.sshClient.sftp((err, sftp) => {
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
}
