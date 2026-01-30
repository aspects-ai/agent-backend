/**
 * In-memory key/value backend implementation
 * Stores data in a Map, directories are implicit from key paths
 */

import type { Stats } from 'fs'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type {
  FileBasedBackend,
  ScopedBackend
} from './types.js'
import type {
  MemoryBackendConfig,
  ScopeConfig,
  ExecOptions,
  ReadOptions
} from './config.js'
import { BackendType } from './types.js'
import { validateMemoryBackendConfig } from './config.js'
import { ScopedMemoryBackend } from './ScopedMemoryBackend.js'
import { BackendError, NotImplementedError } from '../types.js'

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
   * Get MCP client for memory backend.
   * Spawns agentbe-server with this backend's configuration.
   * Note: Memory backend does NOT support exec tool.
   *
   * @param scopePath - Optional scope path to use as rootDir
   * @returns MCP Client connected to a server for this backend
   */
  async getMCPClient(scopePath?: string): Promise<Client> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

    // Build command args
    const args = [
      '--backend', 'memory',
      '--rootDir', scopePath || this.rootDir,
    ]

    // Spawn agentbe-server
    const transport = new StdioClientTransport({
      command: 'agentbe-server',
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
