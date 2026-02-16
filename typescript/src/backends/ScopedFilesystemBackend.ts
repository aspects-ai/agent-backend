import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Stats } from 'fs'
import * as path from 'path'
import type { OperationsLogger } from '../logging/types.js'
import type { ExecOptions, ReadOptions, ScopeConfig } from './config.js'
import { validateWithinBoundary } from './pathValidation.js'
import type { Backend, BackendType, ConnectionStatus, FileBasedBackend, ScopedBackend, StatusChangeCallback, Unsubscribe } from './types.js'

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
  private _rootEnsured = false
  private _rootEnsurePromise: Promise<void> | null = null

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
   * Ensure the scope root directory exists.
   * Called lazily on first write operation.
   */
  private async ensureRoot(): Promise<void> {
    if (this._rootEnsured) return

    // Use a promise to prevent concurrent mkdir calls
    if (!this._rootEnsurePromise) {
      this._rootEnsurePromise = (async () => {
        try {
          const exists = await this.parent.exists(this.scopePath)
          if (!exists) {
            await this.parent.mkdir(this.scopePath, { recursive: true })
          }
          this._rootEnsured = true
        } finally {
          this._rootEnsurePromise = null
        }
      })()
    }

    await this._rootEnsurePromise
  }

  /**
   * Get connection status from parent backend
   */
  get status(): ConnectionStatus {
    return this.parent.status
  }

  /**
   * Subscribe to status changes from parent backend
   */
  onStatusChange(cb: StatusChangeCallback): Unsubscribe {
    return this.parent.onStatusChange(cb)
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
   *
   * Path handling:
   * - Relative paths: resolved relative to scope
   * - Absolute paths matching rootDir (e.g., /var/workspace/users/user1/file): used directly
   * - Absolute paths not matching: treated as relative to scope
   */
  private toParentPath(relativePath: string): string {
    // Check if absolute path matches our full rootDir (parent.rootDir + scopePath)
    if (path.isAbsolute(relativePath)) {
      const normalized = path.resolve(relativePath)
      const rootNormalized = path.resolve(this.rootDir)

      // If path starts with our rootDir, extract the relative part
      if (normalized.startsWith(rootNormalized + path.sep)) {
        const relativePart = normalized.slice(rootNormalized.length + 1)
        return path.join(this.scopePath, relativePart)
      } else if (normalized === rootNormalized) {
        return this.scopePath
      }
      // Falls through: absolute path doesn't match rootDir, treat as relative
    }

    // Use shared validation for relative paths and non-matching absolute paths
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
    await this.ensureRoot()
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
    await this.ensureRoot()
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
    await this.ensureRoot()
    return this.parent.writeFile(this.toParentPath(relativePath), content)
  }

  /**
   * Rename or move a file/directory in scoped directory (matches Node fs.promises API)
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.ensureRoot()
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
    await this.ensureRoot()
    return this.parent.readdir(this.toParentPath(relativePath))
  }

  /**
   * List directory contents with stats in scoped directory
   */
  async readdirWithStats(relativePath: string): Promise<{ name: string, stats: Stats }[]> {
    await this.ensureRoot()
    return this.parent.readdirWithStats(this.toParentPath(relativePath))
  }

  /**
   * Create directory in scoped directory
   */
  async mkdir(relativePath: string, options?: { recursive?: boolean }): Promise<void> {
    await this.ensureRoot()
    return this.parent.mkdir(this.toParentPath(relativePath), options)
  }

  /**
   * Create empty file in scoped directory
   */
  async touch(relativePath: string): Promise<void> {
    await this.ensureRoot()
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
   * List all active scoped backends created from this backend
   * Delegates to parent since scopes register with the root parent.
   * @returns Array of scope paths for currently active scopes
   */
  async listActiveScopes(): Promise<string[]> {
    return this.parent.listActiveScopes()
  }

  /**
   * Get MCP transport for this scoped backend.
   * Can be used directly with Vercel AI SDK's createMCPClient or raw MCP SDK.
   */
  async getMCPTransport(additionalScopePath?: string): Promise<Transport> {
    const fullScopePath = additionalScopePath
      ? path.join(this.scopePath, additionalScopePath)
      : this.scopePath

    return this.parent.getMCPTransport(fullScopePath)
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
   * Destroy this scoped backend.
   * Notifies parent so it can unregister and optionally self-destruct.
   */
  async destroy(): Promise<void> {
    await this.parent.onChildDestroyed(this)
  }

  /**
   * Called by child scopes when they are destroyed.
   * Delegates to parent backend.
   * @param child - The child backend that was destroyed
   */
  async onChildDestroyed(child: Backend): Promise<void> {
    await this.parent.onChildDestroyed(child)
  }
}
