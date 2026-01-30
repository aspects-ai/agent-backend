import type { Dirent, Stats } from 'fs'
import type { RemoteBackend } from '../backends/RemoteBackend.js'
import { ERROR_CODES } from '../constants.js'
import type { OperationLogEntry, OperationsLogger, OperationType } from '../logging/types.js'
import { shouldLogOperation } from '../logging/types.js'
import { FileSystemError } from '../types.js'
import { BaseWorkspace, type ExecOptions, type WorkspaceConfig } from './Workspace.js'

/**
 * Remote filesystem workspace implementation
 * Executes operations on a remote machine via SSH
 */
export class RemoteWorkspace extends BaseWorkspace {
  declare readonly backend: RemoteBackend
  private readonly operationsLogger?: OperationsLogger

  constructor(
    backend: RemoteBackend,
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

  async exec(command: string, options?: ExecOptions): Promise<string | Buffer> {
    const encoding = options?.encoding ?? 'utf8'
    const startTime = Date.now()

    if (!command.trim()) {
      throw new FileSystemError('Command cannot be empty', ERROR_CODES.EMPTY_COMMAND)
    }

    // Merge workspace-level env with per-call env (per-call takes precedence)
    const mergedEnv = options?.env
      ? { ...this.customEnv, ...options.env }
      : this.customEnv

    try {
      // Use RemoteBackend's SSH execution method
      // (This is a RemoteBackend-specific method, not part of the FileSystemBackend interface)
      const result = await this.backend.execInWorkspace(this.workspacePath, command, encoding, mergedEnv)

      if (this.shouldLog('exec')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'exec',
          command,
          stdout: typeof result === 'string' ? result : result.toString('utf-8'),
          success: true,
          durationMs: Date.now() - startTime,
        })
      }

      return result
    } catch (error) {
      if (this.shouldLog('exec')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'exec',
          command,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw error
    }
  }

  async write(path: string, content: string | Buffer): Promise<void> {
    const startTime = Date.now()
    this.validatePath(path)
    const remotePath = this.resolvePath(path)

    try {
      // Use SFTP to write file
      await this.backend.writeFile(remotePath, content)

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
      throw error
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const startTime = Date.now()
    const recursive = options?.recursive ?? true
    this.validatePath(path)
    const remotePath = this.resolvePath(path)

    try {
      // Use SSH exec to create directory
      await this.backend.createDirectory(remotePath, recursive)

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
      throw error
    }
  }

  async touch(path: string): Promise<void> {
    const startTime = Date.now()
    this.validatePath(path)
    const remotePath = this.resolvePath(path)

    try {
      // Use SSH exec to touch file
      await this.backend.touchFile(remotePath)

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
      throw error
    }
  }

  async exists(path: string): Promise<boolean> {
    const startTime = Date.now()
    this.validatePath(path)
    const remotePath = this.resolvePath(path)

    try {
      const result = await this.backend.pathExists(remotePath)

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
    } catch (error) {
      if (this.shouldLog('exists')) {
        await this.logOperation({
          timestamp: new Date(),
          operation: 'exists',
          command: path,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        })
      }
      throw error
    }
  }

  async fileExists(path: string): Promise<boolean> {
    // Alias for exists() for backwards compatibility
    return this.exists(path)
  }

  async stat(path: string): Promise<Stats> {
    const startTime = Date.now()
    this.validatePath(path)
    const remotePath = this.resolvePath(path)

    try {
      const result = await this.backend.pathStat(remotePath)

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
      throw error
    }
  }

  async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> {
    const startTime = Date.now()
    this.validatePath(path)
    const remotePath = this.resolvePath(path)

    if (options?.withFileTypes) {
      // Remote backend doesn't support withFileTypes, so we need to throw
      throw new FileSystemError(
        'withFileTypes option is not supported for remote workspaces',
        ERROR_CODES.INVALID_CONFIGURATION
      )
    }

    try {
      const result = await this.backend.listDirectory(remotePath)

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
      throw error
    }
  }

  async readFile(path: string, encoding?: NodeJS.BufferEncoding | null): Promise<string | Buffer> {
    const startTime = Date.now()
    this.validatePath(path)
    const remotePath = this.resolvePath(path)

    try {
      let result: string | Buffer
      if (encoding) {
        result = await this.backend.readFile(remotePath, encoding)
      } else {
        result = await this.backend.readFile(remotePath)
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
      throw error
    }
  }

  async writeFile(path: string, content: string | Buffer, encoding: NodeJS.BufferEncoding = 'utf-8'): Promise<void> {
    const startTime = Date.now()
    this.validatePath(path)
    const remotePath = this.resolvePath(path)

    try {
      // Remote backend's writeFile handles both string and Buffer with encoding
      await this.backend.writeFile(remotePath, content, encoding)

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
      throw error
    }
  }

  async delete(): Promise<void> {
    const startTime = Date.now()

    try {
      // Delete the entire workspace directory
      await this.backend.deleteDirectory(this.workspacePath)

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
      throw error
    }
  }

  async list(): Promise<string[]> {
    const startTime = Date.now()

    try {
      const result = await this.backend.listDirectory(this.workspacePath)

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
      throw error
    }
  }

  // Synchronous methods are not supported for remote workspaces
  // These are required by the Workspace interface for Codebuff compatibility
  // but remote operations are inherently asynchronous
  existsSync(_path: string): boolean {
    throw new FileSystemError(
      'Synchronous operations are not supported for remote workspaces',
      ERROR_CODES.INVALID_CONFIGURATION
    )
  }

  mkdirSync(_path: string, _options?: { recursive?: boolean }): void {
    throw new FileSystemError(
      'Synchronous operations are not supported for remote workspaces',
      ERROR_CODES.INVALID_CONFIGURATION
    )
  }

  readdirSync(_path: string, _options?: { withFileTypes?: boolean }): string[] | Dirent[] {
    throw new FileSystemError(
      'Synchronous operations are not supported for remote workspaces',
      ERROR_CODES.INVALID_CONFIGURATION
    )
  }

  readFileSync(_path: string, _encoding?: NodeJS.BufferEncoding | null): string | Buffer {
    throw new FileSystemError(
      'Synchronous operations are not supported for remote workspaces',
      ERROR_CODES.INVALID_CONFIGURATION
    )
  }

  statSync(_path: string): Stats {
    throw new FileSystemError(
      'Synchronous operations are not supported for remote workspaces',
      ERROR_CODES.INVALID_CONFIGURATION
    )
  }

  writeFileSync(_path: string, _content: string | Buffer, _encoding?: NodeJS.BufferEncoding): void {
    throw new FileSystemError(
      'Synchronous operations are not supported for remote workspaces',
      ERROR_CODES.INVALID_CONFIGURATION
    )
  }

  // Promises API for Codebuff compatibility
  promises = {
    readdir: async (path: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> => {
      this.validatePath(path)
      const remotePath = this.resolvePath(path)

      if (options?.withFileTypes) {
        // Remote backend doesn't support withFileTypes, so we need to throw
        throw new FileSystemError(
          'withFileTypes option is not supported for remote workspaces',
          ERROR_CODES.INVALID_CONFIGURATION
        )
      }

      return this.backend.listDirectory(remotePath)
    }
  }
}
