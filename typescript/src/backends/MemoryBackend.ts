/**
 * In-memory key/value backend implementation
 * All data is stored in the client's memory.
 *
 * Use cases:
 * - Testing
 * - Temporary data storage
 * - No exec support (throws NotImplementedError)
 *
 * Stores data in a Map, directories are implicit from key paths
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Stats } from 'fs'
import { createBackendMCPTransport } from '../mcp/transport.js'
import { BackendError, NotImplementedError } from '../types.js'
import type {
  ExecOptions,
  MemoryBackendConfig,
  ReadOptions,
  ScopeConfig
} from './config.js'
import { validateMemoryBackendConfig } from './config.js'
import { ScopedMemoryBackend } from './ScopedMemoryBackend.js'
import type {
  FileBasedBackend,
  ScopedBackend
} from './types.js'
import { BackendType } from './types.js'

export class MemoryBackend implements FileBasedBackend {
  readonly type = BackendType.MEMORY
  readonly rootDir: string
  readonly connected = true

  private store: Map<string, string | Buffer>

  constructor(config?: MemoryBackendConfig) {
    // Validate config if provided
    if (config) {
      validateMemoryBackendConfig(config)
    }

    this.rootDir = config?.rootDir ?? '/'
    this.store = new Map()

    // Note: enableTTL reserved for future TTL implementation

    // Initialize with initial data if provided
    if (config?.initialData) {
      for (const [key, value] of Object.entries(config.initialData)) {
        this.store.set(key, value)
      }
    }
  }

  /**
   * Command execution not supported for memory backend
   * @throws {NotImplementedError}
   */
  async exec(_command: string, _options?: ExecOptions): Promise<string | Buffer> {
    throw new NotImplementedError('exec', 'memory')
  }

  /**
   * Read value by key
   */
  async read(key: string, options?: ReadOptions): Promise<string | Buffer> {
    const value = this.store.get(key)
    if (value === undefined) {
      throw new BackendError(`Key not found: ${key}`, 'KEY_NOT_FOUND', 'read')
    }

    // Handle encoding if specified
    if (options?.encoding === 'buffer' && typeof value === 'string') {
      return Buffer.from(value, 'utf8')
    }
    if (options?.encoding === 'utf8' && Buffer.isBuffer(value)) {
      return value.toString('utf8')
    }

    return value
  }

  /**
   * Write value by key
   */
  async write(key: string, value: string | Buffer): Promise<void> {
    this.store.set(key, value)
  }

  /**
   * Read value by key (alias for read, matches Node fs.promises API)
   */
  async readFile(key: string, options?: ReadOptions): Promise<string | Buffer> {
    return this.read(key, options)
  }

  /**
   * Write value by key (alias for write, matches Node fs.promises API)
   */
  async writeFile(key: string, value: string | Buffer): Promise<void> {
    return this.write(key, value)
  }

  /**
   * Rename or move a key (matches Node fs.promises API)
   */
  async rename(oldKey: string, newKey: string): Promise<void> {
    const value = this.store.get(oldKey)
    if (value === undefined) {
      throw new BackendError(`Key not found: ${oldKey}`, 'KEY_NOT_FOUND', 'rename')
    }

    this.store.set(newKey, value)
    this.store.delete(oldKey)
  }

  /**
   * Delete key (matches Node fs.promises API)
   * For memory backend, recursive option deletes all keys with matching prefix
   */
  async rm(key: string, options?: { recursive?: boolean, force?: boolean }): Promise<void> {
    if (options?.recursive) {
      // Delete all keys with this prefix
      const keysToDelete: string[] = []
      const prefix = key.endsWith('/') ? key : `${key}/`

      // Delete exact key if exists
      if (this.store.has(key)) {
        keysToDelete.push(key)
      }

      // Delete all keys with prefix
      for (const k of this.store.keys()) {
        if (k.startsWith(prefix)) {
          keysToDelete.push(k)
        }
      }

      for (const k of keysToDelete) {
        this.store.delete(k)
      }

      // If force is false and nothing was deleted, throw error
      if (!options?.force && keysToDelete.length === 0) {
        throw new BackendError(`Key not found: ${key}`, 'KEY_NOT_FOUND', 'rm')
      }
    } else {
      // Non-recursive: only delete exact key
      if (!this.store.has(key)) {
        if (!options?.force) {
          throw new BackendError(`Key not found: ${key}`, 'KEY_NOT_FOUND', 'rm')
        }
      } else {
        this.store.delete(key)
      }
    }
  }

  /**
   * List all keys matching prefix
   * Returns immediate children only (not nested)
   */
  async readdir(prefix: string): Promise<string[]> {
    // Normalize prefix (ensure it ends with /)
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`

    const children = new Set<string>()
    for (const key of this.store.keys()) {
      if (key.startsWith(normalizedPrefix)) {
        // Extract immediate child (first segment after prefix)
        const relativePath = key.substring(normalizedPrefix.length)
        const parts = relativePath.split('/')
        const immediateChild = parts[0]

        if (immediateChild) {
          children.add(immediateChild)
        }
      }
    }

    return Array.from(children).sort()
  }

  /**
   * List all keys matching prefix with stats
   * Returns immediate children only (not nested)
   */
  async readdirWithStats(prefix: string): Promise<{ name: string, stats: Stats }[]> {
    // Normalize prefix (ensure it ends with /)
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`

    // Track children and whether they are directories
    const childrenInfo = new Map<string, { isDir: boolean, size: number }>()

    for (const key of this.store.keys()) {
      if (key.startsWith(normalizedPrefix)) {
        const relativePath = key.substring(normalizedPrefix.length)
        const parts = relativePath.split('/')
        const immediateChild = parts[0]

        if (immediateChild) {
          const existing = childrenInfo.get(immediateChild)
          // It's a directory if there are nested paths
          const isDir = parts.length > 1
          const value = this.store.get(key)
          const size = value ? (Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value)) : 0

          if (!existing) {
            childrenInfo.set(immediateChild, { isDir, size: isDir ? 0 : size })
          } else if (isDir) {
            // If any entry indicates it's a dir, mark as dir
            existing.isDir = true
          }
        }
      }
    }

    const now = new Date()
    const results: { name: string, stats: Stats }[] = []

    for (const [name, info] of childrenInfo) {
      results.push({
        name,
        stats: {
          isFile: () => !info.isDir,
          isDirectory: () => info.isDir,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          dev: 0,
          ino: 0,
          mode: info.isDir ? 0o755 : 0o644,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          size: info.size,
          blksize: 4096,
          blocks: Math.ceil(info.size / 512),
          atimeMs: now.getTime(),
          mtimeMs: now.getTime(),
          ctimeMs: now.getTime(),
          birthtimeMs: now.getTime(),
          atime: now,
          mtime: now,
          ctime: now,
          birthtime: now,
        } as Stats,
      })
    }

    return results.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Create directory - no-op for memory backend (directories are implicit)
   */
  async mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
    // No-op: directories are implicit in memory backend
    // Keys like 'dir/subdir/file' implicitly create the directory structure
  }

  /**
   * Touch file - create empty key if doesn't exist
   */
  async touch(key: string): Promise<void> {
    if (!this.store.has(key)) {
      this.store.set(key, '')
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    return this.store.has(key)
  }

  /**
   * Get stats for key
   * Note: Limited stats for memory backend (no real filesystem metadata)
   */
  async stat(key: string): Promise<Stats> {
    const value = this.store.get(key)
    if (value === undefined) {
      throw new BackendError(`Key not found: ${key}`, 'KEY_NOT_FOUND', 'stat')
    }

    // Create minimal Stats object
    const size = Buffer.isBuffer(value) ? value.length : Buffer.byteLength(value)
    const now = new Date()

    return {
      isFile: () => true,
      isDirectory: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      dev: 0,
      ino: 0,
      mode: 0o644,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size,
      blksize: 4096,
      blocks: Math.ceil(size / 512),
      atimeMs: now.getTime(),
      mtimeMs: now.getTime(),
      ctimeMs: now.getTime(),
      birthtimeMs: now.getTime(),
      atime: now,
      mtime: now,
      ctime: now,
      birthtime: now,
    } as Stats
  }

  /**
   * List all scopes (top-level keys/directories)
   */
  async listScopes(): Promise<string[]> {
    const scopes = new Set<string>()

    for (const key of this.store.keys()) {
      const parts = key.split('/')
      if (parts.length > 1 && parts[0]) {
        scopes.add(parts[0])
      }
    }

    return Array.from(scopes).sort()
  }

  /**
   * Create scoped backend
   */
  scope(scopePath: string, config?: ScopeConfig): ScopedBackend<this> {
    return new ScopedMemoryBackend(this, scopePath, config) as ScopedBackend<this>
  }

  /**
   * Get MCP transport for this backend.
   * Can be used directly with Vercel AI SDK's createMCPClient or raw MCP SDK.
   * Note: Memory backend does NOT support exec tool.
   *
   * @param scopePath - Optional scope path to use as rootDir
   * @returns StdioClientTransport configured for this backend
   */
  async getMCPTransport(scopePath?: string): Promise<Transport> {
    return createBackendMCPTransport(this, scopePath)
  }

  /**
   * Get MCP client for memory backend.
   * Spawns agent-backend CLI with this backend's configuration.
   * Note: Memory backend does NOT support exec tool.
   *
   * @param scopePath - Optional scope path to use as rootDir
   * @returns MCP Client connected to a server for this backend
   */
  async getMCPClient(scopePath?: string): Promise<Client> {
    // Build command args
    const args = [
      '--backend', 'memory',
      '--rootDir', scopePath || this.rootDir,
    ]

    // Spawn agent-backend CLI
    const transport = new StdioClientTransport({
      command: 'agent-backend',
      args,
    })

    const client = new Client(
      {
        name: 'memory-backend-client',
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
   * Cleanup - clear all data
   */
  async destroy(): Promise<void> {
    this.store.clear()
  }

  /**
   * Delete a key (memory-specific helper)
   */
  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  /**
   * Clear all keys (memory-specific helper)
   */
  async clear(): Promise<void> {
    this.store.clear()
  }

  /**
   * List all keys matching prefix (memory-specific helper)
   * Returns all keys, including nested ones
   */
  async list(prefix?: string): Promise<string[]> {
    if (!prefix) {
      return Array.from(this.store.keys()).sort()
    }

    return Array.from(this.store.keys())
      .filter(key => key.startsWith(prefix))
      .sort()
  }
}
