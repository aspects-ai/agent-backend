/**
 * Scoped memory backend implementation
 * Restricts operations to keys with a specific prefix
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Stats } from 'fs'
import * as path from 'path'
import type { OperationsLogger } from '../logging/types.js'
import { NotImplementedError } from '../types.js'
import type {
  ExecOptions,
  ReadOptions,
  ScopeConfig
} from './config.js'
import { validateWithinBoundary } from './pathValidation.js'
import type {
  Backend,
  BackendType,
  ConnectionStatus,
  FileBasedBackend,
  ScopedBackend,
  StatusChangeCallback,
  Unsubscribe
} from './types.js'

export class ScopedMemoryBackend<T extends FileBasedBackend = FileBasedBackend> implements ScopedBackend<T> {
  readonly type: BackendType
  readonly parent: T
  readonly scopePath: string
  readonly rootDir: string

  private readonly operationsLogger?: OperationsLogger

  get status(): ConnectionStatus {
    return this.parent.status
  }

  onStatusChange(cb: StatusChangeCallback): Unsubscribe {
    return this.parent.onStatusChange(cb)
  }

  trackCloseable(closeable: { close(): Promise<void> }): void {
    this.parent.trackCloseable(closeable)
  }

  constructor(
    parent: T,
    scopePath: string,
    config?: ScopeConfig
  ) {
    this.parent = parent
    this.type = parent.type
    // Normalize scope path (ensure it ends with / for prefix matching)
    this.scopePath = scopePath.endsWith('/') ? scopePath : `${scopePath}/`
    this.rootDir = path.join(this.parent.rootDir, this.scopePath)
    this.operationsLogger = config?.operationsLogger
  }

  /**
   * Exec not supported for memory backend
   */
  async exec(_command: string, _options?: ExecOptions): Promise<string | Buffer> {
    throw new NotImplementedError('exec', 'memory')
  }

  /**
   * Read value from scoped key
   */
  async read(key: string, options?: ReadOptions): Promise<string | Buffer> {
    const scopedKey = this.scopeKey(key)
    this.logOperation('read', { key: scopedKey, options })
    return this.parent.read(scopedKey, options)
  }

  /**
   * Write value to scoped key
   */
  async write(key: string, value: string | Buffer): Promise<void> {
    const scopedKey = this.scopeKey(key)
    this.logOperation('write', { key: scopedKey })
    return this.parent.write(scopedKey, value)
  }

  /**
   * Read value from scoped key (alias for read, matches Node fs.promises API)
   */
  async readFile(key: string, options?: ReadOptions): Promise<string | Buffer> {
    return this.read(key, options)
  }

  /**
   * Write value to scoped key (alias for write, matches Node fs.promises API)
   */
  async writeFile(key: string, value: string | Buffer): Promise<void> {
    return this.write(key, value)
  }

  /**
   * Rename or move a key in scope (matches Node fs.promises API)
   */
  async rename(oldKey: string, newKey: string): Promise<void> {
    const scopedOldKey = this.scopeKey(oldKey)
    const scopedNewKey = this.scopeKey(newKey)
    this.logOperation('rename', { oldKey: scopedOldKey, newKey: scopedNewKey })
    return this.parent.rename(scopedOldKey, scopedNewKey)
  }

  /**
   * Delete key in scope (matches Node fs.promises API)
   */
  async rm(key: string, options?: { recursive?: boolean, force?: boolean }): Promise<void> {
    const scopedKey = this.scopeKey(key)
    this.logOperation('rm', { key: scopedKey, options })
    return this.parent.rm(scopedKey, options)
  }

  /**
   * List keys in scoped directory
   */
  async readdir(prefix: string): Promise<string[]> {
    const scopedPrefix = this.scopeKey(prefix)
    this.logOperation('readdir', { prefix: scopedPrefix })
    const keys = await this.parent.readdir(scopedPrefix)

    // Parent's readdir already returns relative children (not including prefix)
    // So we return them as-is
    return keys
  }

  /**
   * List keys in scoped directory with stats
   */
  async readdirWithStats(prefix: string): Promise<{ name: string, stats: Stats }[]> {
    const scopedPrefix = this.scopeKey(prefix)
    this.logOperation('readdirWithStats', { prefix: scopedPrefix })
    return this.parent.readdirWithStats(scopedPrefix)
  }

  /**
   * Create directory (no-op for memory)
   */
  async mkdir(_dirPath: string, _options?: { recursive?: boolean }): Promise<void> {
    // No-op for memory backend
  }

  /**
   * Touch key in scope
   */
  async touch(key: string): Promise<void> {
    const scopedKey = this.scopeKey(key)
    this.logOperation('touch', { key: scopedKey })
    return this.parent.touch(scopedKey)
  }

  /**
   * Check if scoped key exists
   */
  async exists(key: string): Promise<boolean> {
    const scopedKey = this.scopeKey(key)
    this.logOperation('exists', { key: scopedKey })
    return this.parent.exists(scopedKey)
  }

  /**
   * Get stats for scoped key
   */
  async stat(key: string): Promise<Stats> {
    const scopedKey = this.scopeKey(key)
    this.logOperation('stat', { key: scopedKey })
    return this.parent.stat(scopedKey)
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
   * Create nested scope
   */
  scope(nestedPath: string, config?: ScopeConfig): ScopedBackend<T> {
    const combinedPath = path.posix.join(this.scopePath, nestedPath)

    // Merge operation loggers
    const mergedConfig: ScopeConfig = {
      operationsLogger: config?.operationsLogger ?? this.operationsLogger
    }

    return new ScopedMemoryBackend(this.parent, combinedPath, mergedConfig) as ScopedBackend<T>
  }

  /**
   * Get MCP transport for scoped memory.
   * Can be used directly with Vercel AI SDK's createMCPClient or raw MCP SDK.
   */
  async getMCPTransport(relativeScopePath?: string): Promise<Transport> {
    const fullScopePath = relativeScopePath
      ? path.posix.join(this.scopePath, relativeScopePath)
      : this.scopePath
    return this.parent.getMCPTransport(fullScopePath)
  }

  /**
   * Get MCP client for scoped memory
   */
  async getMCPClient(relativeScopePath?: string): Promise<Client> {
    const fullScopePath = relativeScopePath
      ? path.posix.join(this.scopePath, relativeScopePath)
      : this.scopePath
    return this.parent.getMCPClient(fullScopePath)
  }

  /**
   * Delete scoped key (memory-specific helper)
   */
  async delete(key: string): Promise<void> {
    const scopedKey = this.scopeKey(key)
    this.logOperation('delete', { key: scopedKey })

    // Cast parent to access delete method (only available on MemoryBackend)
    if ('delete' in this.parent && typeof this.parent.delete === 'function') {
      await this.parent.delete(scopedKey)
    }
  }

  /**
   * Clear all keys in this scope (memory-specific helper)
   */
  async clear(): Promise<void> {
    this.logOperation('clear', {})

    // Delete all keys with this scope prefix
    if ('list' in this.parent && typeof this.parent.list === 'function' &&
        'delete' in this.parent && typeof this.parent.delete === 'function') {
      const allKeys = await this.parent.list(this.scopePath)
      for (const key of allKeys) {
        await this.parent.delete(key)
      }
    }
  }

  /**
   * List all keys in scope matching prefix (memory-specific helper)
   */
  async list(prefix?: string): Promise<string[]> {
    const scopedPrefix = prefix ? this.scopeKey(prefix) : this.scopePath
    this.logOperation('list', { prefix: scopedPrefix })

    if ('list' in this.parent && typeof this.parent.list === 'function') {
      const allKeys = await this.parent.list(scopedPrefix)
      // Strip scope prefix from results
      return allKeys.map((key: string) => key.substring(this.scopePath.length))
    }

    return []
  }

  /**
   * Combine scope path with key and validate scope boundary
   *
   * Path handling:
   * - Relative keys: resolved relative to scope
   * - Absolute keys matching rootDir: used directly
   * - Absolute keys not matching: treated as relative to scope
   */
  private scopeKey(key: string): string {
    // Remove trailing / from scopePath for validation
    const scopeForValidation = this.scopePath.endsWith('/')
      ? this.scopePath.slice(0, -1)
      : this.scopePath

    // Check if absolute key matches our full rootDir
    if (path.posix.isAbsolute(key)) {
      const normalized = path.posix.resolve(key)
      const rootNormalized = path.posix.resolve(this.rootDir)

      // If key starts with our rootDir, extract the relative part
      if (normalized.startsWith(rootNormalized + '/')) {
        const relativePart = normalized.slice(rootNormalized.length + 1)
        return path.posix.join(scopeForValidation, relativePart)
      } else if (normalized === rootNormalized || normalized === rootNormalized + '/') {
        return scopeForValidation
      }
      // Falls through: absolute key doesn't match rootDir, treat as relative
    }

    // Use shared validation utility for relative keys and non-matching absolute keys
    return validateWithinBoundary(key, scopeForValidation, path.posix)
  }

  /**
   * Log operation if logger configured
   * TODO: Implement proper logging with full OperationLogEntry interface
   */
  private logOperation(_operation: string, _args: Record<string, unknown>): void {
    // Logging disabled - OperationsLogger interface requires full OperationLogEntry
    // which includes userId, workspaceName, workspacePath, etc. that scoped backends don't have
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
