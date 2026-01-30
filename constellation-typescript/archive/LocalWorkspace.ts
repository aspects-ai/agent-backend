import type { Dirent, Stats } from 'fs'
import { join } from 'path'
import type { LocalBackend } from '../backends/LocalBackend.js'
import { ERROR_CODES } from '../constants.js'
import type { OperationLogEntry, OperationsLogger, OperationType } from '../logging/types.js'
import { shouldLogOperation } from '../logging/types.js'
import { isCommandSafe, isDangerous } from '../safety.js'
import { DangerousOperationError, FileSystemError } from '../types.js'
import { getLogger } from '../utils/logger.js'
import { checkSymlinkSafety } from '../utils/pathValidator.js'
import { BaseWorkspace, type ExecOptions, type WorkspaceConfig } from './Workspace.js'

/**
 * Local filesystem workspace implementation
 * Executes operations on the local machine using Node.js APIs
 */
export class LocalWorkspace extends BaseWorkspace {
  declare readonly backend: LocalBackend
  private readonly operationsLogger?: OperationsLogger

  constructor(
    backend: LocalBackend,
    userId: string,
    workspaceName: string,
    workspacePath: string,
    config?: WorkspaceConfig
  ) {
    super(backend, userId, workspaceName, workspacePath, config)
    this.operationsLogger = config?.operationsLogger
  }

  /**
   * Check if an operation should be logged based on the logger's mode
   */
  private shouldLog(operation: OperationType): boolean {
    if (!this.operationsLogger) return false
    return shouldLogOperation(operation, this.operationsLogger.mode)
  }

  /**
   * Log an operation to the operations logger
   */
  private async logOperation(entry: Omit<OperationLogEntry, 'userId' | 'workspaceName' | 'workspacePath'>): Promise<void> {
    if (!this.operationsLogger) return

    await this.operationsLogger.log({
      ...entry,
      userId: this.userId,
      workspaceName: this.workspaceName,
      workspacePath: this.workspacePath,
    })
  }

  /**
   * Log an operation synchronously (fire and forget for async loggers)
   * Used by sync methods to not block on logging
   */
  private logOperationSync(entry: Omit<OperationLogEntry, 'userId' | 'workspaceName' | 'workspacePath'>): void {
    if (!this.operationsLogger) return

    const result = this.operationsLogger.log({
      ...entry,
      userId: this.userId,
      workspaceName: this.workspaceName,
      workspacePath: this.workspacePath,
    })

    // If the logger returns a promise, catch any errors to prevent unhandled rejections
    if (result instanceof Promise) {
      result.catch((err) => {
        getLogger().error('Failed to log operation', err)
      })
    }
  }

  async exec(command: string, options?: ExecOptions): Promise<string | Buffer> {
    const encoding = options?.encoding ?? 'utf8'
    const startTime = Date.now()
    const shouldLogExec = this.shouldLog('exec')

    if (!command.trim()) {
      throw new FileSystemError('Command cannot be empty', ERROR_CODES.EMPTY_COMMAND)
    }

    // Comprehensive safety check
    const safetyCheck = isCommandSafe(command)
    if (!safetyCheck.safe) {
      // Special handling for preventDangerous option
      if (this.backend.options.preventDangerous && isDangerous(command)) {
        if (this.backend.options.onDangerousOperation) {
          this.backend.options.onDangerousOperation(command)
          return ''
        } else {
          throw new DangerousOperationError(command)
        }
      }

      // For other safety violations, always throw
      throw new FileSystemError(
        safetyCheck.reason || 'Command failed safety check',
        ERROR_CODES.DANGEROUS_OPERATION,
        command
      )
    }

    const shell = this.detectShell()
    const env = this.buildEnvironment(options?.env)

    return new Promise((resolve, reject) => {
      const child = this.backend.spawnProcess(shell, ['-c', command], {
        cwd: this.workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      })

      // Collect output based on encoding mode
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []

      child.stdout?.on('data', (data) => {
        stdoutChunks.push(data)
      })

      child.stderr?.on('data', (data) => {
        stderrChunks.push(data)
      })

      child.on('close', (code) => {
        const stdoutBuffer = Buffer.concat(stdoutChunks)
        const stderrBuffer = Buffer.concat(stderrChunks)
        const stdoutStr = stdoutBuffer.toString('utf-8').trim()
        const stderrStr = stderrBuffer.toString('utf-8').trim()

        if (code === 0) {
          if (encoding === 'buffer') {
            // Log before resolving
            if (shouldLogExec) {
              this.logOperation({
                timestamp: new Date(),
                operation: 'exec',
                command,
                stdout: stdoutStr,
                stderr: stderrStr,
                exitCode: code,
                success: true,
                durationMs: Date.now() - startTime,
              })
            }
            // Return raw binary data as Buffer
            resolve(stdoutBuffer)
          } else {
            // Return as UTF-8 string (default behavior)
            let output = stdoutStr

            if (this.backend.options.maxOutputLength && output.length > this.backend.options.maxOutputLength) {
              const truncatedLength = this.backend.options.maxOutputLength - 50
              output = `${output.substring(0, truncatedLength)}\n\n... [Output truncated. Full output was ${output.length} characters, showing first ${truncatedLength}]`
            }

            // Log before resolving
            if (shouldLogExec) {
              this.logOperation({
                timestamp: new Date(),
                operation: 'exec',
                command,
                stdout: stdoutStr,
                stderr: stderrStr,
                exitCode: code,
                success: true,
                durationMs: Date.now() - startTime,
              })
            }

            resolve(output)
          }
        } else {
          const errorMessage = stderrStr || stdoutStr

          getLogger().error(`Command execution failed in workspace: ${this.workspacePath}, cwd: ${this.workspacePath}, exit code: ${code}`)

          const error = new FileSystemError(
            `Command execution failed with exit code ${code}: ${errorMessage}`,
            ERROR_CODES.EXEC_FAILED,
            command
          )

          // Log before rejecting
          if (shouldLogExec) {
            this.logOperation({
              timestamp: new Date(),
              operation: 'exec',
              command,
              stdout: stdoutStr,
              stderr: stderrStr,
              exitCode: code ?? undefined,
              success: false,
              error: error.message,
              durationMs: Date.now() - startTime,
            })
          }

          reject(error)
        }
      })

      child.on('error', (err) => {
        getLogger().error(`Command execution error in workspace: ${this.workspacePath}, cwd: ${this.workspacePath}`, err)
        const wrappedError = this.wrapError(err, 'Execute command', ERROR_CODES.EXEC_ERROR, command)

        // Log before rejecting
        if (shouldLogExec) {
          this.logOperation({
            timestamp: new Date(),
            operation: 'exec',
            command,
            success: false,
            error: wrappedError.message,
            durationMs: Date.now() - startTime,
          })
        }

        reject(wrappedError)
      })
    })
  }

  /**
   * Detect the best available shell for command execution
   */
  private detectShell(): string {
    if (this.backend.options.shell === 'bash') {
      return 'bash'
    } else if (this.backend.options.shell === 'sh') {
      return 'sh'
    } else if (this.backend.options.shell === 'auto') {
      // Auto-detection: prefer bash if available, fall back to sh
      try {
        this.backend.execSyncCommand('command -v bash', { stdio: 'ignore' })
        return 'bash'
      } catch {
        return 'sh'
      }
    }

    // Fallback for any unexpected shell value
    return 'sh'
  }

  /**
   * Build environment variables for command execution
   * Merges safe defaults with validated custom environment variables
   * @param execEnv - Per-call environment variables that override workspace-level env
   */
  private buildEnvironment(execEnv?: Record<string, string | undefined>): Record<string, string | undefined> {
    // Start with safe base environment
    const safeEnv: Record<string, string | undefined> = {
      // Start with minimal environment, including common npm/node locations
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/opt/node/bin:/usr/local/opt/node/bin',
      USER: process.env.USER,
      SHELL: this.detectShell(),
      // Force working directory
      PWD: this.workspacePath,
      TMPDIR: join(this.workspacePath, '.tmp'),
      // Locale settings
      LANG: 'C',
      LC_ALL: 'C',
      // Block dangerous variables
      LD_PRELOAD: undefined,
      LD_LIBRARY_PATH: undefined,
      DYLD_INSERT_LIBRARIES: undefined,
      DYLD_LIBRARY_PATH: undefined,
    }

    // Validate and merge workspace-level custom environment variables
    if (this.customEnv && Object.keys(this.customEnv).length > 0) {
      const validatedCustomEnv = this.validateCustomEnv(this.customEnv)
      // Custom env vars override safe defaults (except blocked ones)
      Object.assign(safeEnv, validatedCustomEnv)
    }

    // Validate and merge per-call environment variables (highest priority)
    if (execEnv && Object.keys(execEnv).length > 0) {
      const validatedExecEnv = this.validateExecEnv(execEnv)
      // Per-call env vars override workspace-level env (except blocked ones)
      Object.assign(safeEnv, validatedExecEnv)
    }

    return safeEnv
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
  private validateCustomEnv(customEnv: Record<string, string>): Record<string, string> {
    const validated: Record<string, string> = {}

    for (const [key, value] of Object.entries(customEnv)) {
      // Block dangerous variables that could lead to code injection
      if (LocalWorkspace.BLOCKED_VARS.includes(key)) {
        continue
      }

      // Warn about protected variables (allow but log)
      if (LocalWorkspace.PROTECTED_VARS.includes(key)) {
        // Could add logging here if needed
      }

      // Validate value doesn't contain null bytes or other dangerous chars
      if (value.includes('\0')) {
        throw new FileSystemError(
          `Environment variable ${key} contains null byte`,
          ERROR_CODES.INVALID_CONFIGURATION
        )
      }

      validated[key] = value
    }

    return validated
  }

  /**
   * Validate per-call exec environment variables for security
   * Allows undefined values to unset environment variables
   */
  private validateExecEnv(execEnv: Record<string, string | undefined>): Record<string, string | undefined> {
    const validated: Record<string, string | undefined> = {}

    for (const [key, value] of Object.entries(execEnv)) {
      // Block dangerous variables that could lead to code injection
      if (LocalWorkspace.BLOCKED_VARS.includes(key)) {
        continue
      }

      // Warn about protected variables (allow but log)
      if (LocalWorkspace.PROTECTED_VARS.includes(key)) {
        // Could add logging here if needed
      }

      // Allow undefined to unset variables
      if (value === undefined) {
        validated[key] = undefined
        continue
      }

      // Validate value doesn't contain null bytes or other dangerous chars
      if (value.includes('\0')) {
        throw new FileSystemError(
          `Environment variable ${key} contains null byte`,
          ERROR_CODES.INVALID_CONFIGURATION
        )
      }

      validated[key] = value
    }

    return validated
  }

  async write(path: string, content: string | Buffer): Promise<void> {
    const startTime = Date.now()
    this.validatePath(path)

    // Check symlink safety for parent directories
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '.'
    if (parentPath !== '.') {
      const symlinkCheck = checkSymlinkSafety(this.workspacePath, parentPath)
      if (!symlinkCheck.safe) {
        throw new FileSystemError(
          `Cannot write file: ${symlinkCheck.reason}`,
          ERROR_CODES.PATH_ESCAPE_ATTEMPT,
          `write ${path}`
        )
      }
    }

    const fullPath = this.resolvePath(path)

    try {
      // Create parent directories if they don't exist
      if (parentPath !== '.') {
        const fullParentPath = this.resolvePath(parentPath)
        await this.backend.mkdirAsync(fullParentPath, { recursive: true })
      }

      // Handle Buffer or string content
      if (Buffer.isBuffer(content)) {
        await this.backend.writeFileAsync(fullPath, content, { flag: 'w' })
      } else {
        await this.backend.writeFileAsync(fullPath, content, 'utf-8')
      }

      if (this.shouldLog('write')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'write',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }
    } catch (error) {
      if (this.shouldLog('write')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'write',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Write file', ERROR_CODES.WRITE_FAILED, `write ${path}`)
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const startTime = Date.now()
    const recursive = options?.recursive ?? true
    this.validatePath(path)

    // Check symlink safety for parent directories
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '.'
    if (parentPath !== '.') {
      const symlinkCheck = checkSymlinkSafety(this.workspacePath, parentPath)
      if (!symlinkCheck.safe) {
        throw new FileSystemError(
          `Cannot create directory: ${symlinkCheck.reason}`,
          ERROR_CODES.PATH_ESCAPE_ATTEMPT,
          `mkdir ${path}`
        )
      }
    }

    const fullPath = this.resolvePath(path)

    try {
      await this.backend.mkdirAsync(fullPath, { recursive })

      if (this.shouldLog('mkdir')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'mkdir',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }
    } catch (error) {
      if (this.shouldLog('mkdir')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'mkdir',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Create directory', ERROR_CODES.WRITE_FAILED, `mkdir ${path}`)
    }
  }

  async touch(path: string): Promise<void> {
    const startTime = Date.now()
    this.validatePath(path)

    // Check symlink safety for parent directories
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '.'
    if (parentPath !== '.') {
      const symlinkCheck = checkSymlinkSafety(this.workspacePath, parentPath)
      if (!symlinkCheck.safe) {
        throw new FileSystemError(
          `Cannot create file: ${symlinkCheck.reason}`,
          ERROR_CODES.PATH_ESCAPE_ATTEMPT,
          `touch ${path}`
        )
      }
    }

    const fullPath = this.resolvePath(path)

    try {
      // Create empty file or update timestamp if it exists
      await this.backend.writeFileAsync(fullPath, '', { flag: 'a' })

      if (this.shouldLog('touch')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'touch',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }
    } catch (error) {
      if (this.shouldLog('touch')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'touch',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Create file', ERROR_CODES.WRITE_FAILED, `touch ${path}`)
    }
  }

  async exists(path: string): Promise<boolean> {
    const startTime = Date.now()
    this.validatePath(path)

    try {
      const fullPath = this.resolvePath(path)
      const result = await this.backend.existsAsync(fullPath)

      if (this.shouldLog('exists')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'exists',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }

      return result
    } catch {
      // If path validation fails, the file doesn't exist (or is inaccessible)
      if (this.shouldLog('exists')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'exists',
          command: path,
          success: true, // exists returning false is still a success
          durationMs: Date.now() - startTime,
        })
      }
      return false
    }
  }

  async fileExists(path: string): Promise<boolean> {
    // Alias for exists() for backwards compatibility
    return this.exists(path)
  }

  async stat(path: string): Promise<Stats> {
    const startTime = Date.now()
    this.validatePath(path)

    // Check symlink safety
    const symlinkCheck = checkSymlinkSafety(this.workspacePath, path)
    if (!symlinkCheck.safe) {
      throw new FileSystemError(
        `Cannot stat file: ${symlinkCheck.reason}`,
        ERROR_CODES.PATH_ESCAPE_ATTEMPT,
        `stat ${path}`
      )
    }

    const fullPath = this.resolvePath(path)

    try {
      const result = await this.backend.statAsync(fullPath)

      if (this.shouldLog('stat')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'stat',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }

      return result
    } catch (error) {
      if (this.shouldLog('stat')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'stat',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Stat file', ERROR_CODES.READ_FAILED, `stat ${path}`, false)
    }
  }

  async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> {
    const startTime = Date.now()
    this.validatePath(path)
    const fullPath = this.resolvePath(path)

    try {
      let result: string[] | Dirent[]
      if (options?.withFileTypes) {
        result = await this.backend.readdirAsync(fullPath, { withFileTypes: true })
      } else {
        result = await this.backend.readdirAsync(fullPath)
      }

      if (this.shouldLog('readdir')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'readdir',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }

      return result
    } catch (error) {
      if (this.shouldLog('readdir')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'readdir',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Read directory', ERROR_CODES.READ_FAILED, `readdir ${path}`)
    }
  }

  async readFile(path: string, encoding?: NodeJS.BufferEncoding | null): Promise<string | Buffer> {
    const startTime = Date.now()
    this.validatePath(path)

    // Check symlink safety
    const symlinkCheck = checkSymlinkSafety(this.workspacePath, path)
    if (!symlinkCheck.safe) {
      throw new FileSystemError(
        `Cannot read file: ${symlinkCheck.reason}`,
        ERROR_CODES.PATH_ESCAPE_ATTEMPT,
        `readFile ${path}`
      )
    }

    const fullPath = this.resolvePath(path)

    try {
      let result: string | Buffer
      if (encoding) {
        result = await this.backend.readFileAsync(fullPath, encoding)
      } else {
        result = await this.backend.readFileAsync(fullPath)
      }

      if (this.shouldLog('readFile')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'readFile',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }

      return result
    } catch (error) {
      if (this.shouldLog('readFile')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'readFile',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Read file', ERROR_CODES.READ_FAILED, `readFile ${path}`)
    }
  }

  async writeFile(path: string, content: string | Buffer, encoding: NodeJS.BufferEncoding = 'utf-8'): Promise<void> {
    const startTime = Date.now()
    this.validatePath(path)

    // Check symlink safety for parent directories
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '.'
    if (parentPath !== '.') {
      const symlinkCheck = checkSymlinkSafety(this.workspacePath, parentPath)
      if (!symlinkCheck.safe) {
        throw new FileSystemError(
          `Cannot write file: ${symlinkCheck.reason}`,
          ERROR_CODES.PATH_ESCAPE_ATTEMPT,
          `writeFile ${path}`
        )
      }
    }

    const fullPath = this.resolvePath(path)

    try {
      // Create parent directories if they don't exist
      if (parentPath !== '.') {
        const fullParentPath = this.resolvePath(parentPath)
        await this.backend.mkdirAsync(fullParentPath, { recursive: true })
      }

      // Handle Buffer or string content
      if (Buffer.isBuffer(content)) {
        await this.backend.writeFileAsync(fullPath, content, { flag: 'w' })
      } else {
        await this.backend.writeFileAsync(fullPath, content, encoding as 'utf-8')
      }

      if (this.shouldLog('writeFile')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'writeFile',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }
    } catch (error) {
      if (this.shouldLog('writeFile')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'writeFile',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Write file', ERROR_CODES.WRITE_FAILED, `writeFile ${path}`)
    }
  }

  async delete(): Promise<void> {
    const startTime = Date.now()
    try {
      await this.backend.removeAsync(this.workspacePath, { recursive: true, force: true })

      if (this.shouldLog('delete')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'delete',
          command: this.workspaceName,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }
    } catch (error) {
      if (this.shouldLog('delete')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'delete',
          command: this.workspaceName,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(
        error,
        'Delete workspace',
        ERROR_CODES.WRITE_FAILED,
        `delete ${this.workspaceName}`
      )
    }
  }

  async list(): Promise<string[]> {
    const startTime = Date.now()
    try {
      const result = await this.backend.readdirAsync(this.workspacePath)

      if (this.shouldLog('list')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'list',
          command: this.workspaceName,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }

      return result
    } catch (error) {
      if (this.shouldLog('list')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'list',
          command: this.workspaceName,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(
        error,
        'List workspace',
        ERROR_CODES.READ_FAILED,
        `list ${this.workspaceName}`
      )
    }
  }

  // Synchronous filesystem methods for Codebuff compatibility
  existsSync(path: string): boolean {
    const startTime = Date.now()
    this.validatePath(path)
    const fullPath = this.resolvePath(path)
    const result = this.backend.existsSyncFS(fullPath)

    if (this.shouldLog('exists')) {
      this.logOperationSync({
        timestamp: new Date(),
        operation: 'exists',
        command: path,
        success: true,
        durationMs: Date.now() - startTime,
      })
    }

    return result
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    const startTime = Date.now()
    this.validatePath(path)

    // Check symlink safety for parent directories
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '.'
    if (parentPath !== '.') {
      const symlinkCheck = checkSymlinkSafety(this.workspacePath, parentPath)
      if (!symlinkCheck.safe) {
        throw new FileSystemError(
          `Cannot create directory: ${symlinkCheck.reason}`,
          ERROR_CODES.PATH_ESCAPE_ATTEMPT,
          `mkdir ${path}`
        )
      }
    }

    const fullPath = this.resolvePath(path)

    try {
      this.backend.mkdirSyncFS(fullPath, { recursive: options?.recursive ?? true })

      if (this.shouldLog('mkdir')) {
        this.logOperationSync({
          timestamp: new Date(),
          operation: 'mkdir',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }
    } catch (error) {
      if (this.shouldLog('mkdir')) {
        this.logOperationSync({
          timestamp: new Date(),
          operation: 'mkdir',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Create directory (sync)', ERROR_CODES.WRITE_FAILED, `mkdir ${path}`)
    }
  }

  readdirSync(path: string, options?: { withFileTypes?: boolean }): string[] | Dirent[] {
    const startTime = Date.now()
    this.validatePath(path)
    const fullPath = this.resolvePath(path)

    try {
      let result: string[] | Dirent[]
      if (options?.withFileTypes) {
        result = this.backend.readdirSyncFS(fullPath, { withFileTypes: true })
      } else {
        result = this.backend.readdirSyncFS(fullPath)
      }

      if (this.shouldLog('readdir')) {
        this.logOperationSync({
          timestamp: new Date(),
          operation: 'readdir',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }

      return result
    } catch (error) {
      if (this.shouldLog('readdir')) {
        this.logOperationSync({
          timestamp: new Date(),
          operation: 'readdir',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Read directory (sync)', ERROR_CODES.READ_FAILED, `readdir ${path}`)
    }
  }

  readFileSync(path: string, encoding?: NodeJS.BufferEncoding | null): string | Buffer {
    const startTime = Date.now()
    this.validatePath(path)

    // Check symlink safety
    const symlinkCheck = checkSymlinkSafety(this.workspacePath, path)
    if (!symlinkCheck.safe) {
      throw new FileSystemError(
        `Cannot read file: ${symlinkCheck.reason}`,
        ERROR_CODES.PATH_ESCAPE_ATTEMPT,
        `read ${path}`
      )
    }

    const fullPath = this.resolvePath(path)

    try {
      let result: string | Buffer
      // Return Buffer when encoding is null/undefined
      if (encoding === null || encoding === undefined) {
        result = this.backend.readFileSyncFS(fullPath, null)
      } else {
        result = this.backend.readFileSyncFS(fullPath, encoding)
      }

      if (this.shouldLog('readFile')) {
        this.logOperationSync({
          timestamp: new Date(),
          operation: 'readFile',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }

      return result
    } catch (error) {
      if (this.shouldLog('readFile')) {
        this.logOperationSync({
          timestamp: new Date(),
          operation: 'readFile',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Read file (sync)', ERROR_CODES.READ_FAILED, `read ${path}`)
    }
  }

  statSync(path: string): Stats {
    const startTime = Date.now()
    this.validatePath(path)
    const fullPath = this.resolvePath(path)

    try {
      const result = this.backend.statSyncFS(fullPath)

      if (this.shouldLog('stat')) {
        this.logOperationSync({
          timestamp: new Date(),
          operation: 'stat',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }

      return result
    } catch (error) {
      if (this.shouldLog('stat')) {
        this.logOperationSync({
          timestamp: new Date(),
          operation: 'stat',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Stat file (sync)', ERROR_CODES.READ_FAILED, `stat ${path}`)
    }
  }

  writeFileSync(path: string, content: string | Buffer, encoding: NodeJS.BufferEncoding = 'utf-8'): void {
    const startTime = Date.now()
    this.validatePath(path)

    // Check symlink safety for parent directories
    const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '.'
    if (parentPath !== '.') {
      const symlinkCheck = checkSymlinkSafety(this.workspacePath, parentPath)
      if (!symlinkCheck.safe) {
        throw new FileSystemError(
          `Cannot write file: ${symlinkCheck.reason}`,
          ERROR_CODES.PATH_ESCAPE_ATTEMPT,
          `write ${path}`
        )
      }
    }

    const fullPath = this.resolvePath(path)

    try {
      // Create parent directories if they don't exist
      if (parentPath !== '.') {
        const fullParentPath = this.resolvePath(parentPath)
        this.backend.mkdirSyncFS(fullParentPath, { recursive: true })
      }

      // Handle Buffer or string content
      if (Buffer.isBuffer(content)) {
        this.backend.writeFileSyncFS(fullPath, content)
      } else {
        this.backend.writeFileSyncFS(fullPath, content, encoding)
      }

      if (this.shouldLog('writeFile')) {
        this.logOperationSync({
          timestamp: new Date(),
          operation: 'writeFile',
          command: path,
          success: true,
          durationMs: Date.now() - startTime,
        })
      }
    } catch (error) {
      if (this.shouldLog('writeFile')) {
        this.logOperationSync({
          timestamp: new Date(),
          operation: 'writeFile',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw this.wrapError(error, 'Write file (sync)', ERROR_CODES.WRITE_FAILED, `write ${path}`)
    }
  }

  // Promises API for Codebuff compatibility
  promises = {
    readdir: async (path: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> => {
      this.validatePath(path)
      const fullPath = this.resolvePath(path)

      try {
        if (options?.withFileTypes) {
          return await this.backend.readdirAsync(fullPath, { withFileTypes: true })
        }
        return await this.backend.readdirAsync(fullPath)
      } catch (error) {
        throw this.wrapError(error, 'Read directory (async)', ERROR_CODES.READ_FAILED, `readdir ${path}`)
      }
    }
  }

  /**
   * Wrap errors consistently across all operations
   */
  private wrapError(
    error: unknown,
    operation: string,
    errorCode: string,
    command?: string,
    shouldLogError = true
  ): FileSystemError {
    // If it's already our error type, re-throw as-is
    if (error instanceof FileSystemError) {
      return error
    }

    // Get error message from Error objects or fallback
    const message = error instanceof Error ? error.message : 'Unknown error occurred'

    // Log the error with workspace context
    if (shouldLogError) {
      getLogger().error(`${operation} failed in workspace: ${this.workspacePath}${command ? `, command: ${command}` : ''}`, error)
    }

    return new FileSystemError(`${operation} failed: ${message}`, errorCode, command)
  }
}
