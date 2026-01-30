import type { Stats } from 'fs'
import { clearTimeout, setTimeout } from 'node:timers'
import { join } from 'path'
import type { ConnectConfig, SFTPWrapper } from 'ssh2'
import { Client } from 'ssh2'
import { ERROR_CODES } from '../constants.js'
import { isCommandSafe, isDangerous } from '../safety.js'
import { DangerousOperationError, FileSystemError } from '../types.js'
import { getLogger } from '../utils/logger.js'
import { getPlatformGuidance } from '../utils/nativeLibrary.js'
import { RemoteWorkspaceUtils } from '../utils/RemoteWorkspaceUtils.js'
import { RemoteWorkspace } from '../workspace/RemoteWorkspace.js'
import type { Workspace, WorkspaceConfig } from '../workspace/Workspace.js'
import type { FileSystemBackend, RemoteBackendConfig } from './index.js'

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
 * Provides remote command execution via SSH connection
 *
 * Manages multiple workspaces for a single user
 */
export class RemoteBackend implements FileSystemBackend {
  public readonly type = 'remote' as const
  public readonly userId: string
  public readonly options: RemoteBackendConfig
  public connected: boolean
  private sshClient: Client | null = null
  private isConnected = false
  private connectionPromise: Promise<void> | null = null
  private workspaceCache = new Map<string, RemoteWorkspace>()

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

  /**
   * Create a new RemoteBackend instance
   * @param options - Configuration for remote backend
   * @throws {FileSystemError} When platform is not supported
   */
  constructor(options: RemoteBackendConfig) {
    this.options = options
    this.userId = options.userId

    // Initialize configurable timeouts with defaults
    this.operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS
    this.keepaliveIntervalMs = options.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS
    this.keepaliveCountMax = options.keepaliveCountMax ?? DEFAULT_KEEPALIVE_COUNT_MAX

    // Validate userId for security
    RemoteWorkspaceUtils.validateUserId(options.userId)

    // Check platform support and locate native library
    const guidance = getPlatformGuidance('remote')
    if (!guidance.supported) {
      const suggestions = guidance.suggestions.join('\n  ')
      throw new FileSystemError(
        guidance.message || 'Remote backend not supported on this platform',
        ERROR_CODES.BACKEND_NOT_IMPLEMENTED,
        `Suggestions:\n  ${suggestions}`
      )
    }

    // SSH client will be created on first connection (lazy initialization)
    // This allows reconnection with a fresh client if the connection drops
    this.connected = false
  }

  /**
   * Extract username from SSH auth configuration
   */
  private getUserFromAuth(): string {
    const auth = this.options.sshAuth
    if (auth.type === 'password' && auth.credentials.username) {
      return auth.credentials.username as string
    } else if (auth.type === 'key' && auth.credentials.username) {
      return auth.credentials.username as string
    }

    throw new FileSystemError(
      'Username is required in sshAuth credentials',
      ERROR_CODES.INVALID_CONFIGURATION,
      'Provide username in sshAuth.credentials.username'
    )
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
   * @param customEnv - Custom environment variables to validate (undefined values allowed to unset vars)
   * @returns Validated environment variables
   */
  private validateCustomEnv(customEnv: Record<string, string | undefined>): Record<string, string | undefined> {
    const validated: Record<string, string | undefined> = {}

    for (const [key, value] of Object.entries(customEnv)) {
      // Block dangerous variables
      if (RemoteBackend.BLOCKED_VARS.includes(key)) {
        getLogger().warn(`Blocked dangerous environment variable: ${key}`)
        continue
      }

      // Warn about protected variables (allow but log)
      if (RemoteBackend.PROTECTED_VARS.includes(key)) {
        getLogger().warn(`Overriding protected environment variable: ${key}`)
      }

      // Allow undefined to unset variables
      if (value === undefined) {
        validated[key] = undefined
        continue
      }

      // Validate value doesn't contain null bytes or shell injection attempts
      if (value.includes('\0') || value.includes('\n') || value.includes(';')) {
        throw new FileSystemError(
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
   * @param customEnv - Optional custom environment variables
   * @returns Shell command prefix with environment variables
   */
  private buildEnvPrefix(customEnv?: Record<string, string | undefined>): string {
    if (!customEnv || Object.keys(customEnv).length === 0) {
      return ''
    }

    const validatedEnv = this.validateCustomEnv(customEnv)
    const envPairs: string[] = []

    for (const [key, value] of Object.entries(validatedEnv)) {
      if (value === undefined) {
        // Unset the environment variable
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
   * Execute command in a specific workspace path (internal use by Workspace)
   * @param workspacePath - Absolute path to workspace directory
   * @param command - Command to execute
   * @param encoding - Output encoding: 'utf8' for string (default), 'buffer' for raw Buffer
   * @param customEnv - Optional custom environment variables
   * @returns Promise resolving to command output as string or Buffer based on encoding
   */
  async execInWorkspace(
    workspacePath: string,
    command: string,
    encoding: 'utf8' | 'buffer' = 'utf8',
    customEnv?: Record<string, string | undefined>
  ): Promise<string | Buffer> {
    // Safety check
    const safetyCheck = isCommandSafe(command)
    if (!safetyCheck.safe) {
      if (this.options.preventDangerous && isDangerous(command)) {
        if (this.options.onDangerousOperation) {
          this.options.onDangerousOperation(command)
          return encoding === 'buffer' ? Buffer.alloc(0) : ''
        } else {
          throw new DangerousOperationError(command)
        }
      }

      throw new FileSystemError(
        safetyCheck.reason || 'Command failed safety check',
        ERROR_CODES.DANGEROUS_OPERATION,
        command
      )
    }

    // Ensure SSH connection is established
    await this.ensureSSHConnection()

    if (!this.sshClient) {
      throw new FileSystemError('SSH client not initialized', ERROR_CODES.EXEC_FAILED)
    }

    // Use channel limiting to avoid overwhelming the SSH server
    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      if (!this.sshClient) {
        throw new FileSystemError('SSH client not initialized', ERROR_CODES.EXEC_FAILED)
      }

      // Build environment variable prefix
      const envPrefix = this.buildEnvPrefix(customEnv)

      // Build full command with environment variables and workspace change
      const fullCommand =
        workspacePath && workspacePath !== '/'
          ? `${envPrefix}cd "${workspacePath}" && ${command}`
          : `${envPrefix}${command}`

      getLogger().debug(`[SSH exec] Executing command: ${fullCommand}`)

      let completed = false

      // Track this operation so it can be rejected on connection loss
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
          reject(new FileSystemError(
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
          reject(
            new FileSystemError(
              `SSH command failed in workspace: ${workspacePath}, command: ${command}. Error: ${err.message}`,
              ERROR_CODES.EXEC_FAILED,
              command
            )
          )
          return
        }

        // Collect output as Buffer chunks to properly support both encodings
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []

        stream.on('error', (streamErr: Error) => {
          if (completed) return
          complete()
          const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
          const stderr = Buffer.concat(stderrChunks).toString('utf-8')
          reject(new FileSystemError(
            `SSH stream error for command: ${command}. Error: ${streamErr.message}. Stdout: ${stdout}. Stderr: ${stderr}`,
            ERROR_CODES.EXEC_FAILED,
            command
          ))
        })

        stream.on('data', (data: Buffer) => {
          stdoutChunks.push(data)
          // Only log if it looks like text (not binary data)
          if (process.env.CONSTELLATION_DEBUG_LOGGING === 'true') {
            const chunk = data.toString()
            if (/^[\x20-\x7E\s]*$/.test(chunk)) {
              getLogger().debug(`[SSH stdout] ${chunk.trim()}`)
            }
          }
        })

        stream.stderr.on('data', (data: Buffer) => {
          stderrChunks.push(data)
          // Only log if it looks like text (not binary data)
          if (process.env.CONSTELLATION_DEBUG_LOGGING === 'true') {
            const chunk = data.toString()
            if (/^[\x20-\x7E\s]*$/.test(chunk)) {
              getLogger().debug(`[SSH stderr] ${chunk.trim()}`)
            }
          }
        })

        stream.on('close', (code: number) => {
          if (completed) return
          complete()

          const stdoutBuffer = Buffer.concat(stdoutChunks)
          const stderrBuffer = Buffer.concat(stderrChunks)

          if (code === 0) {
            if (encoding === 'buffer') {
              // Return raw binary data as Buffer
              resolve(stdoutBuffer)
            } else {
              // Return as UTF-8 string (default behavior)
              let output = stdoutBuffer.toString('utf-8').trim()

              // Apply output length limit if configured
              if (this.options.maxOutputLength && output.length > this.options.maxOutputLength) {
                const truncatedLength = this.options.maxOutputLength - 50
                output = `${output.substring(0, truncatedLength)}\n\n... [Output truncated. Full output was ${output.length} characters, showing first ${truncatedLength}]`
              }

              resolve(output)
            }
          } else {
            const stdout = stdoutBuffer.toString('utf-8').trim()
            const stderr = stderrBuffer.toString('utf-8').trim()
            const errorMessage = stderr || stdout
            reject(
              new FileSystemError(
                `Command failed in workspace: ${workspacePath}, command: ${command}, exit code: ${code}: ${errorMessage}`,
                ERROR_CODES.EXEC_FAILED,
                command
              )
            )
          }
        })
      })
    }))
  }

  /**
   * Ensure SSH connection is established
   */
  private async ensureSSHConnection(): Promise<void> {
    // If already connected, return immediately
    if (this.isConnected && this.sshClient) {
      getLogger().debug('[SSH] ensureSSHConnection: already connected')
      return Promise.resolve()
    }

    // If connection is in progress, wait for it
    if (this.connectionPromise) {
      getLogger().debug('[SSH] ensureSSHConnection: connection in progress, waiting...')
      return this.connectionPromise
    }

    // Start new connection (this will create a fresh SSH client if needed)
    getLogger().debug(`[SSH] ensureSSHConnection: starting new connection (isConnected=${this.isConnected}, sshClient=${!!this.sshClient})`)
    this.connectionPromise = this.connectSSH()
    return this.connectionPromise
  }

  /**
   * Connect to SSH server
   * Creates a fresh SSH client instance to ensure clean state
   */
  private async connectSSH(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Always create a fresh SSH client - ssh2 Client cannot be reused after close
      if (this.sshClient) {
        // Clean up old client if it exists
        this.sshClient.removeAllListeners()
        try {
          this.sshClient.end()
        } catch {
          // Ignore errors when ending old client
        }
      }
      this.sshClient = new Client()

      const sshAuth = this.options.sshAuth
      const connectOptions: ConnectConfig = {
        host: this.options.host,
        port: this.options.sshPort ?? 2222,
        username: this.getUserFromAuth(),
        // Try both password and keyboard-interactive authentication
        tryKeyboard: true
      }

      // Only enable SSH debug logging if CONSTELLATION_DEBUG_LOGGING is set
      if (process.env.CONSTELLATION_DEBUG_LOGGING === 'true') {
        connectOptions.debug = (message) => getLogger().debug(`[ConstellationFS] ${message}`)
      }

      if (sshAuth.type === 'password') {
        connectOptions.password = sshAuth.credentials.password as string
      } else if (sshAuth.type === 'key') {
        connectOptions.privateKey = sshAuth.credentials.privateKey as string
        if (sshAuth.credentials.passphrase) {
          connectOptions.passphrase = sshAuth.credentials.passphrase as string
        }
      }

      // Enable client-side keep-alives to detect dead connections proactively
      connectOptions.keepaliveInterval = this.keepaliveIntervalMs
      connectOptions.keepaliveCountMax = this.keepaliveCountMax

      // Set up event handlers BEFORE connecting
      this.sshClient.on('ready', () => {
        this.isConnected = true
        this.connected = true
        this.connectionPromise = null
        getLogger().debug('[ConstellationFS] SSH connection ready')
        resolve()
      })

      this.sshClient.on('end', () => {
        // 'end' fires when the connection is gracefully closed
        getLogger().debug('[ConstellationFS] SSH connection ended')
        this.handleConnectionLoss('Connection ended')
      })

      this.sshClient.on('close', () => {
        // 'close' fires after connection is fully closed (may follow 'end' or happen on its own)
        getLogger().debug('[ConstellationFS] SSH connection closed')
        this.handleConnectionLoss('Connection closed')
      })

      this.sshClient.on('error', (err) => {
        getLogger().error('[ConstellationFS] SSH connection error', err)
        this.handleConnectionLoss(`Connection error: ${err.message}`)
        reject(err)
      })

      // Handle keyboard-interactive authentication (required by some SSH servers)
      // This must be set up before connect() is called
      if (sshAuth.type === 'password') {
        this.sshClient.on('keyboard-interactive', (_name, _instructions, _instructionsLang, prompts, finish) => {
          getLogger().debug(`[ConstellationFS] Keyboard-interactive auth requested with ${prompts.length} prompt(s)`)
          // Respond to all prompts with the password
          const responses = prompts.map(() => sshAuth.credentials.password as string)
          finish(responses)
        })
      }

      this.sshClient.connect(connectOptions)
    })
  }

  /**
   * Handle connection loss by rejecting all pending operations
   * This ensures operations don't hang when the connection drops
   */
  private handleConnectionLoss(reason: string): void {
    // Only process if we were previously connected
    const wasConnected = this.isConnected

    this.isConnected = false
    this.connected = false
    this.connectionPromise = null

    // Clear cached SFTP session (it's tied to the old connection)
    if (this.sftpSession) {
      getLogger().debug('[ConstellationFS] Clearing cached SFTP session due to connection loss')
      this.sftpSession = null
    }
    this.sftpSessionPromise = null

    const error = new FileSystemError(
      `SSH connection lost: ${reason}`,
      ERROR_CODES.EXEC_FAILED
    )

    // Reject all pending operations
    if (wasConnected && this.pendingOperations.size > 0) {
      getLogger().warn(`[ConstellationFS] Connection lost (${reason}), rejecting ${this.pendingOperations.size} pending operation(s)`)
      for (const op of this.pendingOperations) {
        getLogger().debug(`[ConstellationFS] Rejecting pending operation: ${op.description}`)
        op.reject(error)
      }
      this.pendingOperations.clear()
    }

    // Reject all queued operations
    if (this.operationQueue.length > 0) {
      getLogger().warn(`[ConstellationFS] Connection lost (${reason}), rejecting ${this.operationQueue.length} queued operation(s)`)
      for (const queued of this.operationQueue) {
        queued.reject(error)
      }
      this.operationQueue = []
    }

    // Reset channel count
    this.activeChannels = 0
  }

  /**
   * Register a pending operation for tracking
   * Returns a cleanup function to call when the operation completes
   */
  private trackOperation(description: string, reject: (error: Error) => void): () => void {
    const op: PendingOperation = { reject, description }
    this.pendingOperations.add(op)

    return () => {
      this.pendingOperations.delete(op)
    }
  }

  /**
   * Execute an operation with channel concurrency limiting.
   * Ensures we don't exceed MAX_CONCURRENT_CHANNELS to avoid SSH server rejection.
   */
  private async withChannelLimit<T>(operation: () => Promise<T>): Promise<T> {
    // If we have capacity, execute immediately
    if (this.activeChannels < MAX_CONCURRENT_CHANNELS) {
      return this.executeWithChannelTracking(operation)
    }

    // Otherwise, queue the operation
    return new Promise<T>((resolve, reject) => {
      this.operationQueue.push({
        execute: operation,
        resolve,
        reject,
      })
      getLogger().debug(`[SSH] Operation queued, queue size: ${this.operationQueue.length}, active channels: ${this.activeChannels}`)
    })
  }

  /**
   * Execute an operation while tracking channel usage
   */
  private async executeWithChannelTracking<T>(operation: () => Promise<T>): Promise<T> {
    this.activeChannels++
    getLogger().debug(`[SSH] Channel acquired, active: ${this.activeChannels}/${MAX_CONCURRENT_CHANNELS}`)

    try {
      return await operation()
    } finally {
      this.activeChannels--
      getLogger().debug(`[SSH] Channel released, active: ${this.activeChannels}/${MAX_CONCURRENT_CHANNELS}`)
      this.processQueue()
    }
  }

  /**
   * Process queued operations when a channel becomes available
   */
  private processQueue(): void {
    while (this.operationQueue.length > 0 && this.activeChannels < MAX_CONCURRENT_CHANNELS) {
      const queued = this.operationQueue.shift()!
      getLogger().debug(`[SSH] Dequeuing operation, remaining queue: ${this.operationQueue.length}`)

      // Execute the queued operation
      this.executeWithChannelTracking(queued.execute)
        .then(queued.resolve)
        .catch(queued.reject)
    }
  }

  /**
   * Get or create a cached SFTP session.
   * Reuses a single SFTP channel for all SFTP operations to avoid channel exhaustion.
   * The SFTP session is automatically cleaned up on connection loss.
   */
  private async getSftpSession(): Promise<SFTPWrapper> {
    // Return existing session if available
    if (this.sftpSession) {
      return this.sftpSession
    }

    // If session creation is in progress, wait for it
    if (this.sftpSessionPromise) {
      return this.sftpSessionPromise
    }

    // Ensure SSH connection first
    await this.ensureSSHConnection()

    if (!this.sshClient) {
      throw new FileSystemError('SSH client not initialized', ERROR_CODES.READ_FAILED)
    }

    // Create new SFTP session (this opens one channel that stays open)
    this.sftpSessionPromise = new Promise<SFTPWrapper>((resolve, reject) => {
      if (!this.sshClient) {
        reject(new FileSystemError('SSH client not initialized', ERROR_CODES.READ_FAILED))
        return
      }

      getLogger().debug('[SFTP] Creating new cached SFTP session')

      this.sshClient.sftp((err, sftp) => {
        this.sftpSessionPromise = null

        if (err) {
          getLogger().error('[SFTP] Failed to create SFTP session', err)
          reject(new FileSystemError(
            `Failed to create SFTP session: ${err.message}`,
            ERROR_CODES.READ_FAILED
          ))
          return
        }

        // Listen for session close to clear the cache
        sftp.on('close', () => {
          getLogger().debug('[SFTP] Cached SFTP session closed')
          this.sftpSession = null
        })

        sftp.on('error', (sftpErr: Error) => {
          getLogger().error('[SFTP] Cached SFTP session error', sftpErr)
          this.sftpSession = null
        })

        getLogger().debug('[SFTP] Cached SFTP session created successfully')
        this.sftpSession = sftp
        resolve(sftp)
      })
    })

    return this.sftpSessionPromise
  }

  /**
   * Get or create a workspace for this user
   * @param workspaceName - Workspace name (defaults to 'default')
   * @param config - Optional workspace configuration including custom environment variables
   * @returns Promise resolving to Workspace instance
   */
  async getWorkspace(workspaceName = 'default', config?: WorkspaceConfig): Promise<Workspace> {
    // Ensure SSH connection
    await this.ensureSSHConnection()

    // Generate cache key that includes env config
    const cacheKey = config?.env ? `${workspaceName}:${JSON.stringify(config.env)}` : workspaceName

    if (this.workspaceCache.has(cacheKey)) {
      return this.workspaceCache.get(cacheKey)!
    }

    if (!this.sshClient) {
      throw new FileSystemError('SSH client not initialized', ERROR_CODES.EXEC_FAILED)
    }

    // Create workspace directory for this user on remote system using static utility
    const fullPath = await RemoteWorkspaceUtils.ensureUserWorkspace(
      this.sshClient,
      join(this.userId, workspaceName)
    )

    const workspace = new RemoteWorkspace(this, this.userId, workspaceName, fullPath, config)
    this.workspaceCache.set(cacheKey, workspace)

    getLogger().debug(
      `Created remote workspace for user ${this.userId}: ${workspaceName}`,
      config?.env ? 'with custom env' : ''
    )

    return workspace
  }

  /**
   * List all workspaces for this user
   * @returns Promise resolving to array of workspace paths
   */
  async listWorkspaces(): Promise<string[]> {
    await this.ensureSSHConnection()

    const userRoot = RemoteWorkspaceUtils.getUserWorkspacePath(this.userId)

    // List directories via SSH
    return this.listDirectory(userRoot)
  }

  /**
   * Public helper methods for RemoteWorkspace
   */

  async readFile(remotePath: string): Promise<Buffer>
  async readFile(remotePath: string, encoding: BufferEncoding): Promise<string>
  async readFile(remotePath: string, encoding?: BufferEncoding): Promise<string | Buffer> {
    const sftp = await this.getSftpSession()

    return new Promise((resolve, reject) => {
      let completed = false
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true
          getLogger().error(`[SFTP] readFile timed out after ${this.operationTimeoutMs}ms: ${remotePath}`)
          reject(new FileSystemError(
            `readFile timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.READ_FAILED,
            `read ${remotePath}`
          ))
        }
      }, this.operationTimeoutMs)

      if (encoding) {
        // Read as string with specified encoding
        sftp.readFile(remotePath, encoding, (readErr, data) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          if (readErr) {
            reject(this.wrapError(readErr, 'Read file', ERROR_CODES.READ_FAILED, `read ${remotePath}`, remotePath))
          } else {
            resolve(Buffer.isBuffer(data) ? data.toString(encoding) : data)
          }
        })
      } else {
        // Read as Buffer (no encoding)
        sftp.readFile(remotePath, (readErr, data) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          if (readErr) {
            reject(this.wrapError(readErr, 'Read file', ERROR_CODES.READ_FAILED, `read ${remotePath}`, remotePath))
          } else {
            resolve(data)
          }
        })
      }
    })
  }

  async writeFile(remotePath: string, content: string | Buffer, encoding: BufferEncoding = 'utf8'): Promise<void> {
    const sftp = await this.getSftpSession()

    return new Promise((resolve, reject) => {
      let completed = false
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true
          getLogger().error(`[SFTP] writeFile timed out after ${this.operationTimeoutMs}ms: ${remotePath}`)
          reject(new FileSystemError(
            `writeFile timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.WRITE_FAILED,
            `write ${remotePath}`
          ))
        }
      }, this.operationTimeoutMs)

      // Handle Buffer or string content differently
      if (Buffer.isBuffer(content)) {
        sftp.writeFile(remotePath, content, (writeErr) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          if (writeErr) {
            reject(this.wrapError(writeErr, 'Write file', ERROR_CODES.WRITE_FAILED, `write ${remotePath}`, remotePath))
          } else {
            resolve()
          }
        })
      } else {
        sftp.writeFile(remotePath, content, encoding, (writeErr) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          if (writeErr) {
            reject(this.wrapError(writeErr, 'Write file', ERROR_CODES.WRITE_FAILED, `write ${remotePath}`, remotePath))
          } else {
            resolve()
          }
        })
      }
    })
  }

  async createDirectory(remotePath: string, recursive: boolean): Promise<void> {
    await this.ensureSSHConnection()

    if (!this.sshClient) {
      throw new FileSystemError('SSH client not initialized', ERROR_CODES.WRITE_FAILED)
    }

    if (recursive) {
      // Use mkdir -p for recursive directory creation
      return this.withChannelLimit(() => new Promise((resolve, reject) => {
        if (!this.sshClient) {
          reject(new FileSystemError('SSH client not initialized', ERROR_CODES.WRITE_FAILED))
          return
        }

        let completed = false
        const timeout = setTimeout(() => {
          if (!completed) {
            completed = true
            getLogger().error(`[SSH] mkdir timed out after ${this.operationTimeoutMs}ms: ${remotePath}`)
            reject(new FileSystemError(
              `mkdir timed out after ${this.operationTimeoutMs}ms`,
              ERROR_CODES.WRITE_FAILED,
              `mkdir ${remotePath}`
            ))
          }
        }, this.operationTimeoutMs)

        this.sshClient.exec(`mkdir -p "${remotePath}"`, (err, stream) => {
          if (err) {
            if (completed) return
            completed = true
            clearTimeout(timeout)
            reject(this.wrapError(err, 'Create directory', ERROR_CODES.WRITE_FAILED, `mkdir ${remotePath}`, remotePath))
            return
          }

          stream.on('error', (streamErr: Error) => {
            if (completed) return
            completed = true
            clearTimeout(timeout)
            reject(this.wrapError(streamErr, 'Create directory', ERROR_CODES.WRITE_FAILED, `mkdir ${remotePath}`, remotePath))
          })

          stream
            .on('close', (code: number) => {
              if (completed) return
              completed = true
              clearTimeout(timeout)

              if (code === 0) {
                resolve()
              } else {
                getLogger().error(`Failed to create directory for path: ${remotePath}`)
                reject(
                  new FileSystemError(
                    `Failed to create directory: ${remotePath}`,
                    ERROR_CODES.WRITE_FAILED,
                    `mkdir ${remotePath}`
                  )
                )
              }
            })
            .on('data', () => {
              // Consume stdout
            })
            .stderr.on('data', () => {
              // Consume stderr
            })
        })
      }))
    } else {
      // Non-recursive: use cached SFTP session
      const sftp = await this.getSftpSession()

      return new Promise((resolve, reject) => {
        let completed = false
        const timeout = setTimeout(() => {
          if (!completed) {
            completed = true
            getLogger().error(`[SFTP] mkdir timed out after ${this.operationTimeoutMs}ms: ${remotePath}`)
            reject(new FileSystemError(
              `mkdir timed out after ${this.operationTimeoutMs}ms`,
              ERROR_CODES.WRITE_FAILED,
              `mkdir ${remotePath}`
            ))
          }
        }, this.operationTimeoutMs)

        sftp.mkdir(remotePath, (mkdirErr) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          if (mkdirErr) {
            reject(this.wrapError(mkdirErr, 'Create directory', ERROR_CODES.WRITE_FAILED, `mkdir ${remotePath}`, remotePath))
          } else {
            resolve()
          }
        })
      })
    }
  }

  async touchFile(remotePath: string): Promise<void> {
    await this.ensureSSHConnection()

    if (!this.sshClient) {
      throw new FileSystemError('SSH client not initialized', ERROR_CODES.WRITE_FAILED)
    }

    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      if (!this.sshClient) {
        reject(new FileSystemError('SSH client not initialized', ERROR_CODES.WRITE_FAILED))
        return
      }

      let completed = false
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true
          getLogger().error(`[SSH] touch timed out after ${this.operationTimeoutMs}ms: ${remotePath}`)
          reject(new FileSystemError(
            `touch timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.WRITE_FAILED,
            `touch ${remotePath}`
          ))
        }
      }, this.operationTimeoutMs)

      // Use touch command for creating empty files
      this.sshClient.exec(`touch "${remotePath}"`, (err, stream) => {
        if (err) {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          reject(this.wrapError(err, 'Create file', ERROR_CODES.WRITE_FAILED, `touch ${remotePath}`, remotePath))
          return
        }

        stream.on('error', (streamErr: Error) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          reject(this.wrapError(streamErr, 'Create file', ERROR_CODES.WRITE_FAILED, `touch ${remotePath}`, remotePath))
        })

        stream
          .on('close', (code: number) => {
            if (completed) return
            completed = true
            clearTimeout(timeout)

            if (code === 0) {
              resolve()
            } else {
              getLogger().error(`Failed to create file for path: ${remotePath}`)
              reject(
                new FileSystemError(
                  `Failed to create file: ${remotePath}`,
                  ERROR_CODES.WRITE_FAILED,
                  `touch ${remotePath}`
                )
              )
            }
          })
          .on('data', () => {
            // Consume stdout
          })
          .stderr.on('data', () => {
            // Consume stderr
          })
      })
    }))
  }

  async directoryExists(remotePath: string): Promise<boolean> {
    await this.ensureSSHConnection()

    if (!this.sshClient) {
      return false
    }

    return this.withChannelLimit(() => new Promise((resolve) => {
      if (!this.sshClient) {
        resolve(false)
        return
      }

      let completed = false
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true
          getLogger().error(`[SSH] directoryExists timed out after ${this.operationTimeoutMs}ms: ${remotePath}`)
          resolve(false) // Resolve as false on timeout rather than rejecting
        }
      }, this.operationTimeoutMs)

      this.sshClient.exec(`test -d "${remotePath}"`, (err, stream) => {
        if (err) {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          resolve(false)
          return
        }

        stream.on('error', () => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          resolve(false)
        })

        stream.on('close', (code: number) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          // test command returns 0 if directory exists, 1 if it doesn't
          resolve(code === 0)
        })
      })
    }))
  }

  async pathExists(remotePath: string): Promise<boolean> {
    await this.ensureSSHConnection()

    if (!this.sshClient) {
      return false
    }

    return this.withChannelLimit(() => new Promise((resolve) => {
      if (!this.sshClient) {
        resolve(false)
        return
      }

      let completed = false
      let execCallbackFired = false
      let streamCreated = false

      const complete = (result: boolean, source: string) => {
        if (completed) return
        completed = true
        clearTimeout(timeout)
        getLogger().debug(`[SSH] pathExists completed via ${source}: ${remotePath} = ${result}`)
        resolve(result)
      }

      const timeout = setTimeout(() => {
        if (!completed) {
          getLogger().error(
            `[SSH] pathExists timed out after ${this.operationTimeoutMs}ms: ${remotePath}. ` +
            `Diagnostics: execCallbackFired=${execCallbackFired}, streamCreated=${streamCreated}, ` +
            `isConnected=${this.isConnected}, sshClient=${!!this.sshClient}`
          )
          complete(false, 'timeout')
        }
      }, this.operationTimeoutMs)

      getLogger().debug(`[SSH] pathExists starting: ${remotePath}, isConnected=${this.isConnected}`)

      this.sshClient.exec(`test -e "${remotePath}"`, (err, stream) => {
        execCallbackFired = true

        if (err) {
          getLogger().debug(`[SSH] pathExists exec error: ${err.message}`)
          complete(false, 'exec-error')
          return
        }

        streamCreated = true
        getLogger().debug(`[SSH] pathExists stream created: ${remotePath}`)

        stream.on('error', (streamErr: Error) => {
          getLogger().debug(`[SSH] pathExists stream error: ${streamErr.message}`)
          complete(false, 'stream-error')
        })

        stream.on('end', () => {
          getLogger().debug('[SSH] pathExists stream end event')
        })

        stream.on('finish', () => {
          getLogger().debug('[SSH] pathExists stream finish event')
        })

        stream.on('data', (data: Buffer) => {
          getLogger().debug(`[SSH] pathExists stream data: ${data.toString()}`)
        })

        // Listen for both 'exit' and 'close' - sometimes only one fires
        stream.on('exit', (code: number | null) => {
          getLogger().debug(`[SSH] pathExists stream exit event: code=${code}`)
          // exit code 0 = exists, 1 = doesn't exist, null = signal termination
          complete(code === 0, 'exit')
        })

        stream.on('close', (code: number) => {
          getLogger().debug(`[SSH] pathExists stream close event: code=${code}`)
          // test command returns 0 if file/directory exists, 1 if it doesn't
          complete(code === 0, 'close')
        })
      })
    }))
  }

  async pathStat(remotePath: string): Promise<Stats> {
    const sftp = await this.getSftpSession()

    return new Promise((resolve, reject) => {
      let completed = false
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true
          getLogger().error(`[SFTP] pathStat timed out after ${this.operationTimeoutMs}ms: ${remotePath}`)
          reject(new FileSystemError(
            `pathStat timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.READ_FAILED,
            `stat ${remotePath}`
          ))
        }
      }, this.operationTimeoutMs)

      sftp.stat(remotePath, (statErr, stats) => {
        if (completed) return
        completed = true
        clearTimeout(timeout)
        if (statErr) {
          reject(this.wrapError(statErr, 'Stat file', ERROR_CODES.READ_FAILED, `stat ${remotePath}`, remotePath))
        } else {
          // SSH2 Stats type is compatible with fs.Stats for most use cases
          // Cast through unknown to handle type incompatibility
          resolve(stats as unknown as Stats)
        }
      })
    })
  }

  async deleteDirectory(remotePath: string): Promise<void> {
    await this.ensureSSHConnection()

    if (!this.sshClient) {
      throw new FileSystemError('SSH client not initialized', ERROR_CODES.WRITE_FAILED)
    }

    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      if (!this.sshClient) {
        reject(new FileSystemError('SSH client not initialized', ERROR_CODES.WRITE_FAILED))
        return
      }

      let completed = false
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true
          getLogger().error(`[SSH] deleteDirectory timed out after ${this.operationTimeoutMs}ms: ${remotePath}`)
          reject(new FileSystemError(
            `deleteDirectory timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.WRITE_FAILED,
            `rm -rf ${remotePath}`
          ))
        }
      }, this.operationTimeoutMs)

      this.sshClient.exec(`rm -rf "${remotePath}"`, (err, stream) => {
        if (err) {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          reject(this.wrapError(err, 'Delete directory', ERROR_CODES.WRITE_FAILED, `rm -rf ${remotePath}`, remotePath))
          return
        }

        stream.on('error', (streamErr: Error) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          reject(this.wrapError(streamErr, 'Delete directory', ERROR_CODES.WRITE_FAILED, `rm -rf ${remotePath}`, remotePath))
        })

        stream.on('close', (code: number) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)

          if (code === 0) {
            resolve()
          } else {
            getLogger().error(`Failed to delete directory for path: ${remotePath}`)
            reject(
              new FileSystemError(
                `Failed to delete directory: ${remotePath}`,
                ERROR_CODES.WRITE_FAILED,
                `rm -rf ${remotePath}`
              )
            )
          }
        })
      })
    }))
  }

  async listDirectory(remotePath: string): Promise<string[]> {
    await this.ensureSSHConnection()

    if (!this.sshClient) {
      return []
    }

    return this.withChannelLimit(() => new Promise((resolve, reject) => {
      if (!this.sshClient) {
        resolve([])
        return
      }

      let completed = false
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true
          getLogger().error(`[SSH] listDirectory timed out after ${this.operationTimeoutMs}ms: ${remotePath}`)
          reject(new FileSystemError(
            `listDirectory timed out after ${this.operationTimeoutMs}ms`,
            ERROR_CODES.READ_FAILED,
            `ls ${remotePath}`
          ))
        }
      }, this.operationTimeoutMs)

      this.sshClient.exec(`ls -1 "${remotePath}"`, (err, stream) => {
        if (err) {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          reject(this.wrapError(err, 'List directory', ERROR_CODES.READ_FAILED, `ls ${remotePath}`, remotePath))
          return
        }

        let stdout = ''

        stream.on('error', (streamErr: Error) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)
          reject(this.wrapError(streamErr, 'List directory', ERROR_CODES.READ_FAILED, `ls ${remotePath}`, remotePath))
        })

        stream.on('data', (data: Buffer) => {
          stdout += data.toString()
        })

        stream.on('close', (code: number) => {
          if (completed) return
          completed = true
          clearTimeout(timeout)

          if (code === 0) {
            resolve(stdout.trim().split('\n').filter(Boolean))
          } else {
            // Directory doesn't exist or is empty
            resolve([])
          }
        })
      })
    }))
  }

  /**
   * Wrap errors consistently
   */
  private wrapError(
    error: unknown,
    operation: string,
    errorCode: string,
    command?: string,
    remotePath?: string,
  ): FileSystemError {
    if (error instanceof FileSystemError) {
      return error
    }

    const message = error instanceof Error
      ? error.message
      : 'Unknown error occurred'

    let detailedMessage = `${operation} failed: ${message}`
    if (remotePath) {
      detailedMessage = `${operation} failed for path: ${remotePath}${command ? `, command: ${command}` : ''}. Error: ${message}`
    } else if (command) {
      detailedMessage = `${operation} failed, command: ${command}. Error: ${message}`
    }

    return new FileSystemError(
      detailedMessage,
      errorCode,
      command,
    )
  }

  /**
   * Clean up resources on destruction
   */
  async destroy(): Promise<void> {
    // Clear workspace cache
    this.workspaceCache.clear()

    // Clear cached SFTP session
    if (this.sftpSession) {
      try {
        this.sftpSession.end()
      } catch {
        // Ignore errors when ending SFTP session
      }
      this.sftpSession = null
    }
    this.sftpSessionPromise = null

    // Close SSH connection
    if (this.sshClient) {
      this.sshClient.end()
      this.sshClient = null
      this.isConnected = false
      this.connectionPromise = null
    }

    getLogger().debug(`RemoteBackend destroyed for user: ${this.userId}`)
  }
}
