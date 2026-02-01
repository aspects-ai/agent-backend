import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { execSync, spawn } from 'child_process'
import type { Stats } from 'fs'
import { access, mkdir as fsMkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import * as path from 'path'
import { ERROR_CODES } from '../constants.js'
import { isCommandSafe, isDangerous } from '../safety.js'
import { BackendError, DangerousOperationError } from '../types.js'
import { getLogger } from '../utils/logger.js'
import type { ExecOptions, LocalFilesystemBackendConfig, ReadOptions, ScopeConfig } from './config.js'
import { validateLocalFilesystemBackendConfig } from './config.js'
import { validateWithinBoundary } from './pathValidation.js'
import { ScopedFilesystemBackend } from './ScopedFilesystemBackend.js'
import type { FileBasedBackend, ScopedBackend } from './types.js'
import { BackendType } from './types.js'

/**
 * Local filesystem backend implementation
 * Executes commands and file operations on the local machine using Node.js APIs
 */
export class LocalFilesystemBackend implements FileBasedBackend {
  readonly type = BackendType.LOCAL_FILESYSTEM
  readonly rootDir: string
  readonly connected = true

  private readonly shell: string
  private readonly isolation: 'auto' | 'bwrap' | 'software' | 'none'
  private readonly preventDangerous: boolean
  private readonly onDangerousOperation?: (operation: string) => void
  private readonly maxOutputLength?: number
  private readonly actualIsolation: 'bwrap' | 'software' | 'none'

  constructor(config: LocalFilesystemBackendConfig) {
    validateLocalFilesystemBackendConfig(config)

    this.rootDir = path.resolve(config.rootDir)
    this.shell = config.shell ?? 'auto'
    this.isolation = config.isolation ?? 'auto'
    this.preventDangerous = config.preventDangerous ?? true
    this.onDangerousOperation = config.onDangerousOperation
    this.maxOutputLength = config.maxOutputLength

    // Ensure rootDir exists
    this.ensureRootDir()

    // Detect actual isolation method if 'auto'
    this.actualIsolation = this.detectIsolation()

    // If bwrap explicitly requested, verify it's available
    if (this.isolation === 'bwrap' && this.actualIsolation !== 'bwrap') {
      throw new BackendError(
        'bwrap isolation requested but bubblewrap is not installed. Install with: apt install bubblewrap',
        ERROR_CODES.MISSING_UTILITIES,
        'bwrap'
      )
    }

    // Validate utilities if requested
    if (config.validateUtils) {
      this.validateEnvironment()
    }
  }

  /**
   * Ensure root directory exists
   */
  private ensureRootDir(): void {
    try {
      fsMkdir(this.rootDir, { recursive: true })
    } catch (error) {
      throw new BackendError(
        `Failed to create root directory: ${this.rootDir}`,
        ERROR_CODES.WRITE_FAILED,
        'mkdir'
      )
    }
  }

  /**
   * Validate that required POSIX utilities are available
   */
  private validateEnvironment(): void {
    const requiredUtils = ['ls', 'find', 'grep', 'cat', 'wc', 'head', 'tail', 'sort']
    const missing: string[] = []

    for (const util of requiredUtils) {
      try {
        execSync(`command -v ${util}`, { stdio: 'ignore' })
      } catch {
        missing.push(util)
      }
    }

    if (missing.length > 0) {
      throw new BackendError(
        `Missing required POSIX utilities: ${missing.join(', ')}`,
        ERROR_CODES.MISSING_UTILITIES
      )
    }
  }

  /**
   * Detect isolation method based on availability
   */
  private detectIsolation(): 'bwrap' | 'software' | 'none' {
    if (this.isolation !== 'auto') {
      return this.isolation as 'bwrap' | 'software' | 'none'
    }

    // Try bwrap first
    try {
      execSync('command -v bwrap', { stdio: 'ignore' })
      return 'bwrap'
    } catch {
      // Fall back to software isolation
      getLogger().warn(
        'bwrap not detected, using software isolation (validation only). ' +
        'This is OK if not on Linux. For hardware isolation, install bubblewrap: apt install bubblewrap'
      )
      return 'software'
    }
  }

  /**
   * Detect appropriate shell
   */
  private detectShell(): string {
    if (this.shell !== 'auto') {
      return this.shell
    }

    // Try bash first, fall back to sh
    try {
      execSync('command -v bash', { stdio: 'ignore' })
      return 'bash'
    } catch {
      return 'sh'
    }
  }

  /**
   * Resolve and validate path is within rootDir
   * Uses shared validation utility for DRY
   */
  private resolvePath(relativePath: string): string {
    // Use shared validation - strips leading slash if absolute, validates boundary
    const combined = validateWithinBoundary(relativePath, this.rootDir, path)

    // Resolve to absolute path
    return path.resolve(combined)
  }

  /**
   * Build environment for command execution
   */
  private buildEnvironment(customEnv?: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...customEnv,
    }
  }

  /**
   * Execute shell command in root directory
   */
  async exec(command: string, options?: ExecOptions): Promise<string | Buffer> {
    if (!command.trim()) {
      throw new BackendError('Command cannot be empty', ERROR_CODES.EMPTY_COMMAND)
    }

    // Safety checks (only if preventDangerous is enabled)
    if (this.preventDangerous) {
      if (isDangerous(command)) {
        const error = new DangerousOperationError(command)
        if (this.onDangerousOperation) {
          this.onDangerousOperation(command)
          return ''
        }
        throw error
      }

      const safetyCheck = isCommandSafe(command)
      if (!safetyCheck.safe) {
        throw new BackendError(safetyCheck.reason || 'Command failed safety check', 'UNSAFE_COMMAND', command)
      }
    }

    // Route to appropriate executor based on isolation mode
    if (this.actualIsolation === 'bwrap') {
      return this.execWithBwrap(command, options)
    } else {
      return this.execDirect(command, options)
    }
  }

  /**
   * Execute command with bwrap sandboxing
   */
  private async execWithBwrap(
    command: string,
    options?: ExecOptions
  ): Promise<string | Buffer> {
    const shell = this.detectShell()
    const env = this.buildEnvironment(options?.env)
    const encoding = options?.encoding ?? 'utf8'

    // Determine working directory
    const requestedCwd = options?.cwd ?? this.rootDir

    // Validate cwd is within rootDir (security check)
    const normalizedRoot = path.resolve(this.rootDir)
    const normalizedCwd = path.resolve(requestedCwd)

    if (!normalizedCwd.startsWith(normalizedRoot + path.sep) &&
        normalizedCwd !== normalizedRoot) {
      throw new BackendError(
        `Working directory ${requestedCwd} is outside rootDir ${this.rootDir}`,
        ERROR_CODES.PATH_ESCAPE_ATTEMPT,
        'exec'
      )
    }

    // Calculate sandbox-relative path
    // Example: rootDir='/tmp/app', cwd='/tmp/app/users/user1'
    // Result: relativeCwd='users/user1', bwrapCwd='/workspace/users/user1'
    const relativeCwd = path.relative(this.rootDir, normalizedCwd)
    const bwrapCwd = relativeCwd ? `/workspace/${relativeCwd}` : '/workspace'

    const bwrapArgs = [
      // System directories (read-only) - needed for commands to work
      '--ro-bind', '/usr', '/usr',
      '--ro-bind', '/lib', '/lib',
      '--ro-bind', '/lib64', '/lib64',
      '--ro-bind', '/bin', '/bin',
      '--ro-bind', '/sbin', '/sbin',

      // Workspace (writable) - this is the ONLY writable mount outside /tmp
      '--bind', this.rootDir, '/workspace',

      // Set working directory in sandbox
      '--chdir', bwrapCwd,

      // Isolation settings
      '--unshare-all',       // Isolate all namespaces
      '--share-net',         // But allow network access
      '--die-with-parent',   // Kill sandbox if parent dies

      // Minimal /dev, /proc, /tmp (isolated)
      '--dev', '/dev',
      '--proc', '/proc',
      '--tmpfs', '/tmp',

      // Execute command
      '--',
      shell, '-c', command
    ]

    return new Promise((resolve, reject) => {
      const child = spawn('bwrap', bwrapArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        // NO cwd here - bwrap handles it with --chdir
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []

      child.stdout?.on('data', (data) => stdoutChunks.push(data))
      child.stderr?.on('data', (data) => stderrChunks.push(data))

      child.on('close', (code) => {
        const stdoutBuffer = Buffer.concat(stdoutChunks)
        const stderrBuffer = Buffer.concat(stderrChunks)

        if (code === 0) {
          if (encoding === 'buffer') {
            resolve(stdoutBuffer)
          } else {
            let output = stdoutBuffer.toString('utf-8').trim()

            if (this.maxOutputLength && output.length > this.maxOutputLength) {
              const truncatedLength = this.maxOutputLength - 50
              output = `${output.substring(0, truncatedLength)}\n\n... [Output truncated. Full output was ${output.length} characters, showing first ${truncatedLength}]`
            }

            resolve(output)
          }
        } else {
          const errorMessage = stderrBuffer.toString('utf-8').trim() || stdoutBuffer.toString('utf-8').trim()
          reject(new BackendError(
            `Command execution failed with exit code ${code}: ${errorMessage}`,
            ERROR_CODES.EXEC_FAILED,
            command
          ))
        }
      })

      child.on('error', (error) => {
        // Check if bwrap is not installed
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new BackendError(
            'bwrap command not found. Install bubblewrap: apt install bubblewrap',
            ERROR_CODES.MISSING_UTILITIES,
            'bwrap'
          ))
        } else {
          reject(new BackendError(
            `Failed to execute command: ${error.message}`,
            ERROR_CODES.EXEC_ERROR,
            command
          ))
        }
      })
    })
  }

  /**
   * Execute command directly (software/none isolation mode)
   */
  private async execDirect(
    command: string,
    options?: ExecOptions
  ): Promise<string | Buffer> {
    const shell = this.detectShell()
    const env = this.buildEnvironment(options?.env)
    const cwd = options?.cwd ?? this.rootDir
    const encoding = options?.encoding ?? 'utf8'

    return new Promise((resolve, reject) => {
      const child = spawn(shell, ['-c', command], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []

      child.stdout?.on('data', (data) => stdoutChunks.push(data))
      child.stderr?.on('data', (data) => stderrChunks.push(data))

      child.on('close', (code) => {
        const stdoutBuffer = Buffer.concat(stdoutChunks)
        const stderrBuffer = Buffer.concat(stderrChunks)

        if (code === 0) {
          if (encoding === 'buffer') {
            resolve(stdoutBuffer)
          } else {
            let output = stdoutBuffer.toString('utf-8').trim()

            if (this.maxOutputLength && output.length > this.maxOutputLength) {
              const truncatedLength = this.maxOutputLength - 50
              output = `${output.substring(0, truncatedLength)}\n\n... [Output truncated. Full output was ${output.length} characters, showing first ${truncatedLength}]`
            }

            resolve(output)
          }
        } else {
          const errorMessage = stderrBuffer.toString('utf-8').trim() || stdoutBuffer.toString('utf-8').trim()
          reject(new BackendError(
            `Command execution failed with exit code ${code}: ${errorMessage}`,
            ERROR_CODES.EXEC_FAILED,
            command
          ))
        }
      })

      child.on('error', (error) => {
        reject(new BackendError(
          `Failed to execute command: ${error.message}`,
          ERROR_CODES.EXEC_ERROR,
          command
        ))
      })
    })
  }

  /**
   * Read file from rootDir
   */
  async read(relativePath: string, options?: ReadOptions): Promise<string | Buffer> {
    const fullPath = this.resolvePath(relativePath)
    const encoding = options?.encoding ?? 'utf8'

    try {
      if (encoding === 'buffer') {
        return await readFile(fullPath)
      }
      return await readFile(fullPath, 'utf8')
    } catch (error) {
      throw new BackendError(
        `Failed to read file: ${relativePath}`,
        ERROR_CODES.READ_FAILED,
        'read'
      )
    }
  }

  /**
   * Write content to file
   */
  async write(relativePath: string, content: string | Buffer): Promise<void> {
    const fullPath = this.resolvePath(relativePath)

    try {
      // Ensure parent directory exists
      await fsMkdir(path.dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content)
    } catch (error) {
      throw new BackendError(
        `Failed to write file: ${relativePath}`,
        ERROR_CODES.WRITE_FAILED,
        'write'
      )
    }
  }

  /**
   * List directory contents
   */
  async readdir(relativePath: string): Promise<string[]> {
    const fullPath = this.resolvePath(relativePath)

    try {
      const entries = await readdir(fullPath)
      return entries
    } catch (error) {
      throw new BackendError(
        `Failed to read directory: ${relativePath}`,
        ERROR_CODES.LS_FAILED,
        'readdir'
      )
    }
  }

  /**
   * Create directory
   */
  async mkdir(relativePath: string, options?: { recursive?: boolean }): Promise<void> {
    const fullPath = this.resolvePath(relativePath)

    try {
      await fsMkdir(fullPath, { recursive: options?.recursive ?? true })
    } catch (error) {
      throw new BackendError(
        `Failed to create directory: ${relativePath}`,
        ERROR_CODES.WRITE_FAILED,
        'mkdir'
      )
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

    try {
      await access(fullPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get file/directory stats
   */
  async stat(relativePath: string): Promise<Stats> {
    const fullPath = this.resolvePath(relativePath)

    try {
      return await stat(fullPath)
    } catch (error) {
      throw new BackendError(
        `Failed to stat path: ${relativePath}`,
        ERROR_CODES.READ_FAILED,
        'stat'
      )
    }
  }

  /**
   * Create a scoped backend restricted to a subdirectory
   */
  scope(scopePath: string, config?: ScopeConfig): ScopedBackend<this> {
    return new ScopedFilesystemBackend(this, scopePath, config) as ScopedBackend<this>
  }

  /**
   * List all scopes (subdirectories from root)
   */
  async listScopes(): Promise<string[]> {
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true })
      return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
    } catch (error) {
      // If root doesn't exist yet, return empty array
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw new BackendError(
        'Failed to list scopes',
        ERROR_CODES.LS_FAILED,
        'listScopes'
      )
    }
  }

  /**
   * Get MCP client for this backend.
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
      '--backend', 'local',
      '--rootDir', scopePath || this.rootDir,
    ]

    if (this.isolation) {
      args.push('--isolation', this.isolation)
    }

    if (this.shell) {
      args.push('--shell', this.shell)
    }

    // Spawn agentbe-server
    const transport = new StdioClientTransport({
      command: 'agentbe-server',
      args,
    })

    const client = new Client(
      {
        name: 'local-filesystem-client',
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
    getLogger().debug(`LocalFilesystemBackend destroyed for root: ${this.rootDir}`)
  }
}
