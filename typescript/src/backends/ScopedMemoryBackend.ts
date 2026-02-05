/**
 * Scoped memory backend implementation
 * Restricts operations to keys with a specific prefix
 */

import type { Stats } from 'fs'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import * as path from 'path'
import type {
  FileBasedBackend,
  ScopedBackend,
  BackendType
} from './types.js'
import type {
  ScopeConfig,
  ExecOptions,
  ReadOptions
} from './config.js'
import type { OperationsLogger } from '../logging/types.js'
import { NotImplementedError } from '../types.js'
import { validateWithinBoundary } from './pathValidation.js'

export class ScopedMemoryBackend<T extends FileBasedBackend = FileBasedBackend> implements ScopedBackend<T> {
  readonly type: BackendType
  readonly parent: T
  readonly scopePath: string
  readonly rootDir: string
  readonly connected: boolean

  private readonly operationsLogger?: OperationsLogger

  constructor(
    parent: T,
    scopePath: string,
    config?: ScopeConfig
  ) {
    this.parent = parent
    this.type = parent.type
    this.connected = parent.connected
    // Normalize scope path (ensure it ends with / for prefix matching)
    this.scopePath = scopePath.endsWith('/') ? scopePath : `${scopePath}/`
    this.rootDir = this.scopePath
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
   * List scopes within this scope
   */
  async listScopes(): Promise<string[]> {
    // Use list() if available (memory-specific)
    if ('list' in this.parent && typeof this.parent.list === 'function') {
      const allKeys = await this.parent.list(this.scopePath)
      const scopes = new Set<string>()

      for (const key of allKeys) {
        const relativePath = key.substring(this.scopePath.length)
        const parts = relativePath.split('/')
        if (parts.length > 1 && parts[0]) {
          scopes.add(parts[0])
        }
      }

      return Array.from(scopes).sort()
    }

    // Fallback: use readdir
    return this.parent.readdir(this.scopePath.slice(0, -1)) // Remove trailing /
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
   * Uses shared validation utilities for DRY
   */
  private scopeKey(key: string): string {
    // Remove trailing / from scopePath for validation
    const scopeForValidation = this.scopePath.endsWith('/')
      ? this.scopePath.slice(0, -1)
      : this.scopePath

    // Use shared validation utility
    // This validates that key doesn't escape scope boundary
    const combined = validateWithinBoundary(key, scopeForValidation, path.posix)

    // Ensure result ends with / if it's a prefix, otherwise it's a key
    return combined
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
