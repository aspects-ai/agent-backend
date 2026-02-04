import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Stats } from 'fs'
import * as path from 'path'
import type { OperationsLogger } from '../logging/types.js'
import type { ExecOptions, ReadOptions, ScopeConfig } from './config.js'
import { validateWithinBoundary } from './pathValidation.js'
import type { BackendType, FileBasedBackend, ScopedBackend } from './types.js'

/**
 * Scoped filesystem backend implementation
 * Wraps any FileBasedBackend and restricts operations to a subdirectory
 */
export class ScopedFilesystemBackend<T extends FileBasedBackend = FileBasedBackend> implements ScopedBackend<T> {
  readonly type: BackendType
  readonly parent: T
  readonly scopePath: string
  readonly rootDir: string

  private readonly customEnv?: Record<string, string>
  private readonly operationsLogger?: OperationsLogger

  constructor(
    parent: T,
    scopePath: string,
    config?: ScopeConfig
  ) {
    this.parent = parent
    this.type = parent.type
    this.scopePath = scopePath
    this.rootDir = path.join(parent.rootDir, scopePath)
    this.customEnv = config?.env
    this.operationsLogger = config?.operationsLogger

    // Validate scope path doesn't escape parent
    this.validateScopePath(scopePath)
  }

  /**
   * Get connection status from parent backend
   */
  get connected(): boolean {
    return this.parent.connected
  }

  /**
   * Validate that scope path doesn't escape parent
   * Uses shared validation utility for DRY
   */
  private validateScopePath(scopePath: string): void {
    // Use shared validation - strips leading slash if absolute, validates boundary
    validateWithinBoundary(scopePath, this.parent.rootDir, path)
  }

  /**
   * Convert relative path to parent-relative path
   * Validates the path stays within the scope
   * Uses shared validation utility for DRY
   */
  private toParentPath(relativePath: string): string {
    // Use shared validation - strips leading slash if absolute, validates boundary
    return validateWithinBoundary(relativePath, this.scopePath, path)
  }

  /**
   * Merge custom environment with command-specific env
   */
  private mergeEnv(commandEnv?: Record<string, string | undefined>): Record<string, string | undefined> | undefined {
    if (!this.customEnv && !commandEnv) {
      return undefined
    }

    return {
      ...this.customEnv,
      ...commandEnv,
    }
  }

  /**
   * Execute shell command in scoped directory
   */
  async exec(command: string, options?: ExecOptions): Promise<string | Buffer> {
    const mergedEnv = this.mergeEnv(options?.env)
    const scopedOptions: ExecOptions = {
      ...options,
      cwd: this.rootDir,
      env: mergedEnv,
    }

    return this.parent.exec(command, scopedOptions)
  }

  /**
   * Read file from scoped directory
   */
  async read(relativePath: string, options?: ReadOptions): Promise<string | Buffer> {
    return this.parent.read(this.toParentPath(relativePath), options)
  }

  /**
   * Write content to file in scoped directory
   */
  async write(relativePath: string, content: string | Buffer): Promise<void> {
    return this.parent.write(this.toParentPath(relativePath), content)
  }

  /**
   * Read file from scoped directory (alias for read, matches Node fs.promises API)
   */
  async readFile(relativePath: string, options?: ReadOptions): Promise<string | Buffer> {
    return this.parent.readFile(this.toParentPath(relativePath), options)
  }

  /**
   * Write content to file in scoped directory (alias for write, matches Node fs.promises API)
   */
  async writeFile(relativePath: string, content: string | Buffer): Promise<void> {
    return this.parent.writeFile(this.toParentPath(relativePath), content)
  }

  /**
   * Rename or move a file/directory in scoped directory (matches Node fs.promises API)
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    return this.parent.rename(this.toParentPath(oldPath), this.toParentPath(newPath))
  }

  /**
   * Delete files and directories in scoped directory (matches Node fs.promises API)
   */
  async rm(relativePath: string, options?: { recursive?: boolean, force?: boolean }): Promise<void> {
    return this.parent.rm(this.toParentPath(relativePath), options)
  }

  /**
   * List directory contents in scoped directory
   */
  async readdir(relativePath: string): Promise<string[]> {
    return this.parent.readdir(this.toParentPath(relativePath))
  }

  /**
   * Create directory in scoped directory
   */
  async mkdir(relativePath: string, options?: { recursive?: boolean }): Promise<void> {
    return this.parent.mkdir(this.toParentPath(relativePath), options)
  }

  /**
   * Create empty file in scoped directory
   */
  async touch(relativePath: string): Promise<void> {
    return this.parent.touch(this.toParentPath(relativePath))
  }

  /**
   * Check if path exists in scoped directory
   */
  async exists(relativePath: string): Promise<boolean> {
    return this.parent.exists(this.toParentPath(relativePath))
  }

  /**
   * Get file/directory stats in scoped directory
   */
  async stat(relativePath: string): Promise<Stats> {
    return this.parent.stat(this.toParentPath(relativePath))
  }

  /**
   * Create a nested scoped backend
   */
  scope(nestedPath: string, config?: ScopeConfig): ScopedBackend<T> {
    // Combine scope paths
    const combinedPath = path.join(this.scopePath, nestedPath)

    // Merge environment variables
    const mergedConfig: ScopeConfig = {
      env: {
        ...this.customEnv,
        ...config?.env,
      },
      operationsLogger: config?.operationsLogger ?? this.operationsLogger,
    }

    return new ScopedFilesystemBackend(this.parent, combinedPath, mergedConfig)
  }

  /**
   * List all scopes (subdirectories from scoped root)
   */
  async listScopes(): Promise<string[]> {
    // List subdirectories in the current scope
    const entries = await this.readdir('.')
    const scopes: string[] = []

    for (const entry of entries) {
      const stats = await this.stat(entry)
      if (stats.isDirectory()) {
        scopes.push(entry)
      }
    }

    return scopes
  }

  /**
   * Get MCP client for this scoped backend
   */
  async getMCPClient(additionalScopePath?: string): Promise<Client> {
    const fullScopePath = additionalScopePath
      ? path.join(this.scopePath, additionalScopePath)
      : this.scopePath

    return this.parent.getMCPClient(fullScopePath)
  }

  /**
   * Destroy is not supported on scoped backends.
   * Destroy the parent backend instead.
   * @throws {Error} Always throws - scoped backends cannot be destroyed independently
   */
  async destroy(): Promise<void> {
    throw new Error(
      'Cannot destroy a scoped backend. Destroy the parent backend instead. ' +
      `This scope (${this.scopePath}) is a view into the parent backend.`
    )
  }
}
