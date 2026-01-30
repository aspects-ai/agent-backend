/**
 * @deprecated Use BackendPoolManager with Backend interface instead.
 * This class uses the old FileSystem/Workspace API and will be removed in the next major version.
 *
 * @example Migration
 * ```typescript
 * // Old (FileSystemPoolManager):
 * const pool = new FileSystemPoolManager()
 * const { fs, release } = await pool.acquire({ userId: 'user1' })
 * const workspace = await fs.getWorkspace('project')
 * await workspace.execute('npm run build')
 * release()
 *
 * // New (BackendPoolManager):
 * const pool = new BackendPoolManager({
 *   backendClass: LocalFilesystemBackend,
 *   defaultConfig: { rootDir: '/app/workspace' }
 * })
 * await pool.withBackend({ key: 'user1' }, async (backend) => {
 *   const scope = backend.scope('projects/proj1')
 *   await scope.exec('npm run build')
 * })
 * ```
 */

import type { FileSystem } from './FileSystem.js'
import type { Workspace, WorkspaceConfig } from './workspace/Workspace.js'
import { getLogger } from './utils/logger.js'
import type { BackendConfig } from './types.js'
import { BackendFactory } from './backends/BackendFactory.js'

/**
 * Options for acquiring a filesystem from the pool
 * @deprecated Use BackendPoolManager instead
 */
export interface AcquireOptions {
  /**
   * User ID for workspace isolation
   */
  userId: string

  /**
   * Backend configuration (defaults to local backend if not provided)
   */
  backendConfig?: Partial<BackendConfig>
}

/**
 * Internal tracking structure for pooled filesystems
 */
interface ManagedFileSystem {
  /**
   * The FileSystem instance
   */
  fs: FileSystem

  /**
   * User ID this filesystem belongs to
   */
  userId: string

  /**
   * Number of active references to this filesystem
   */
  activeReferences: number

  /**
   * Timestamp of last access (for idle cleanup)
   */
  lastAccessTime: number
}

/**
 * Internal handle for managing pooled filesystem lifecycle
 * Not exposed in public API - use withFileSystem/withWorkspace or acquireFileSystem/acquireWorkspace instead
 */
class FileSystemHandle {
  private released = false
  private readonly releaseCallback: () => void

  constructor(
    public readonly fs: FileSystem,
    releaseCallback: () => void
  ) {
    this.releaseCallback = releaseCallback
  }

  /**
   * Release this handle back to the pool
   * Must be called when done using the filesystem
   */
  release(): void {
    if (this.released) {
      getLogger().warn('[FileSystemPool] Handle already released')
      return
    }
    this.released = true
    this.releaseCallback()
  }

  /**
   * Support for explicit resource management (using keyword)
   */
  [Symbol.asyncDispose](): Promise<void> {
    this.release()
    return Promise.resolve()
  }

  /**
   * Check if this handle has been released
   */
  get isReleased(): boolean {
    return this.released
  }

  async getWorkspace(workspaceName: string, config?: WorkspaceConfig): Promise<Workspace> {
    return this.fs.getWorkspace(workspaceName, config)
  }
}

/**
 * Statistics about the pool state
 */
export interface PoolStats {
  totalFileSystems: number
  activeFileSystems: number
  idleFileSystems: number
  totalActiveReferences: number
  userIds: string[]
}

/**
 * Configuration for the pool manager
 */
export interface PoolManagerConfig {
  /**
   * Time in milliseconds before an idle filesystem is eligible for cleanup
   * Default: 5 minutes
   */
  idleTimeoutMs?: number

  /**
   * Interval in milliseconds for running cleanup checks
   * Default: 1 minute
   */
  cleanupIntervalMs?: number

  /**
   * Whether to run periodic cleanup
   * Default: true
   */
  enablePeriodicCleanup?: boolean

  /**
   * Default backend configuration to use if not provided in acquire options
   * Defaults to local backend
   */
  defaultBackendConfig?: Partial<BackendConfig>

  /**
   * Callback when a new connection is created for a user.
   * Called after the FileSystem is created but before it's returned.
   */
  onConnectionCreated?: (userId: string) => void | Promise<void>

  /**
   * Callback when a connection is destroyed for a user.
   * Called before the FileSystem is destroyed. The FileSystem is passed
   * so cleanup operations can use the existing connection.
   */
  onConnectionDestroyed?: (userId: string, fs: FileSystem) => void | Promise<void>
}

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000 // 1 minute

/**
 * FileSystemPoolManager - Centralized management of FileSystem instances
 *
 * This class manages FileSystem instances to ensure:
 * - One connection per user (not per operation) - reduces overhead for remote backends
 * - Proper resource cleanup when filesystems are idle
 * - Reference counting for safe lifecycle management
 *
 * @example
 * ```typescript
 * const pool = new FileSystemPoolManager({
 *   defaultBackendConfig: {
 *     type: 'remote',
 *     host: 'server.com',
 *     sshAuth: { type: 'password', credentials: { username: 'user', password: 'pass' } }
   * }
 * });
 *
 * // Recommended: Automatic cleanup with callback pattern
 * await pool.withWorkspace({ userId: 'user123', workspace: 'my-project' }, async (workspace) => {
 *   await workspace.exec('npm install');
 * });
 *
 * // Manual cleanup when needed
 * const { workspace, release } = await pool.acquireWorkspace({ userId: 'user123', workspace: 'my-project' });
 * try {
 *   await workspace.exec('npm install');
 * } finally {
 *   release();
 * }
 * ```
 */
export class FileSystemPoolManager {
  private readonly cache = new Map<string, ManagedFileSystem>()
  private readonly idleTimeoutMs: number
  private readonly cleanupIntervalMs: number
  private cleanupTimer: NodeJS.Timeout | null = null
  private readonly onConnectionCreated?: (userId: string) => void | Promise<void>
  private readonly onConnectionDestroyed?: (userId: string, fs: FileSystem) => void | Promise<void>
  private readonly defaultBackendConfig: Partial<BackendConfig>

  /**
   * Track users that are currently being cleaned up.
   * Maps userId to a promise that resolves when cleanup is complete.
   * This prevents creating new filesystems while cleanup is in progress,
   * which could cause conflicts on remote systems.
   */
  private readonly cleanupInProgress = new Map<string, Promise<void>>()

  constructor(config: PoolManagerConfig = {}) {
    this.idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
    this.cleanupIntervalMs = config.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS
    this.onConnectionCreated = config.onConnectionCreated
    this.onConnectionDestroyed = config.onConnectionDestroyed
    this.defaultBackendConfig = config.defaultBackendConfig ?? { type: 'local' }

    if (config.enablePeriodicCleanup !== false) {
      this.startPeriodicCleanup()
    }

    getLogger().info(
      `[FileSystemPool] Initialized with idleTimeout=${this.idleTimeoutMs}ms, cleanupInterval=${this.cleanupIntervalMs}ms`
    )
  }

  /**
   * Generate cache key for a user
   */
  private getCacheKey(userId: string): string {
    return userId
  }

  /**
   * Execute operations with a filesystem (recommended).
   * Resources are automatically released when the callback completes.
   *
   * @param options - Acquisition options
   * @param callback - Async function that receives the FileSystem
   * @returns Promise resolving to callback return value
   */
  async withFileSystem<T>(
    options: AcquireOptions,
    callback: (fs: FileSystem) => Promise<T>
  ): Promise<T> {
    const handle = await this.acquire(options)
    try {
      return await callback(handle.fs)
    } finally {
      handle.release()
    }
  }

  /**
   * Execute operations with a workspace (recommended).
   * Resources are automatically released when the callback completes.
   *
   * @param options - Acquisition options including workspace name
   * @param callback - Async function that receives the Workspace
   * @returns Promise resolving to callback return value
   */
  async withWorkspace<T>(
    options: AcquireOptions & { workspace: string; config?: WorkspaceConfig },
    callback: (workspace: Workspace) => Promise<T>
  ): Promise<T> {
    const handle = await this.acquire(options)
    try {
      const workspace = await handle.getWorkspace(options.workspace, options.config)
      return await callback(workspace)
    } finally {
      handle.release()
    }
  }

  /**
   * Acquire a filesystem with manual lifecycle management.
   *
   * ⚠️ You MUST call release() when done to prevent resource leaks.
   * Consider using withFileSystem() instead for automatic cleanup.
   *
   * @param options - Acquisition options
   * @returns Object with fileSystem and release function
   */
  async acquireFileSystem(options: AcquireOptions): Promise<{
    fileSystem: FileSystem
    release: () => void
  }> {
    const handle = await this.acquire(options)
    return {
      fileSystem: handle.fs,
      release: () => handle.release(),
    }
  }

  /**
   * Acquire a workspace with manual lifecycle management.
   *
   * ⚠️ You MUST call release() when done to prevent resource leaks.
   * Consider using withWorkspace() instead for automatic cleanup.
   *
   * @param options - Acquisition options including workspace name
   * @returns Object with workspace and release function
   */
  async acquireWorkspace(options: AcquireOptions & {
    workspace: string
    config?: WorkspaceConfig
  }): Promise<{
    workspace: Workspace
    release: () => void
  }> {
    const handle = await this.acquire(options)
    const workspace = await handle.getWorkspace(options.workspace, options.config)
    return {
      workspace,
      release: () => handle.release(),
    }
  }

  /**
   * Internal method to acquire a filesystem handle from the pool
   *
   * If a filesystem for this user already exists, it will be reused.
   * Otherwise, a new one will be created.
   *
   * If cleanup is in progress for this user, this method will wait for
   * cleanup to complete before creating a new filesystem.
   *
   * @param options - Acquisition options
   * @returns Promise resolving to FileSystemHandle (internal use only)
   */
  private async acquire(options: AcquireOptions): Promise<FileSystemHandle> {
    const { userId, backendConfig } = options
    const cacheKey = this.getCacheKey(userId)

    // If cleanup is in progress for this user, wait for it to complete
    const cleanupPromise = this.cleanupInProgress.get(cacheKey)
    if (cleanupPromise) {
      getLogger().info(`[FileSystemPool] Waiting for cleanup to complete for user: ${userId}`)
      await cleanupPromise
    }

    let managed = this.cache.get(cacheKey)
    let isNewConnection = false

    if (!managed) {
      // Create new filesystem
      getLogger().info(`[FileSystemPool] Creating new filesystem for user: ${userId}`)
      managed = this.createManagedFileSystem(userId, backendConfig)
      this.cache.set(cacheKey, managed)
      isNewConnection = true
    } else {
      getLogger().debug(`[FileSystemPool] Reusing existing filesystem for user: ${userId}`)
    }

    // Increment reference count and update access time
    managed.activeReferences++
    managed.lastAccessTime = Date.now()

    // Create handle with release callback
    const handle = new FileSystemHandle(managed.fs, () => {
      this.releaseReference(cacheKey)
    })

    // Invoke connection created hook asynchronously (fire-and-forget)
    // This notifies listeners that a new connection was established
    if (isNewConnection && this.onConnectionCreated) {
      Promise.resolve(this.onConnectionCreated(userId)).catch((err) => {
        getLogger().error(`[FileSystemPool] onConnectionCreated hook failed for user ${userId}:`, err)
      })
    }

    return handle
  }

  /**
   * Create a new managed filesystem
   */
  private createManagedFileSystem(
    userId: string,
    backendConfig?: Partial<BackendConfig>
  ): ManagedFileSystem {
    // Merge provided config with defaults
    const finalConfig: BackendConfig = {
      ...this.defaultBackendConfig,
      ...backendConfig,
      userId,
    } as BackendConfig

    // Create backend using factory
    const backend = BackendFactory.create(finalConfig)

    // Import FileSystem class and create instance
    const { FileSystem } = require('./FileSystem.js')
    const fs = new FileSystem(backend)

    return {
      fs,
      userId,
      activeReferences: 0,
      lastAccessTime: Date.now(),
    }
  }

  /**
   * Release a reference to a filesystem
   */
  private releaseReference(cacheKey: string): void {
    const managed = this.cache.get(cacheKey)
    if (!managed) {
      getLogger().warn(`[FileSystemPool] Attempted to release unknown filesystem: ${cacheKey}`)
      return
    }

    managed.activeReferences = Math.max(0, managed.activeReferences - 1)
    managed.lastAccessTime = Date.now()

    getLogger().debug(
      `[FileSystemPool] Released reference for ${cacheKey}, remaining: ${managed.activeReferences}`
    )
  }

  /**
   * Start periodic cleanup of idle filesystems
   */
  private startPeriodicCleanup(): void {
    if (this.cleanupTimer) {
      return
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupIdle().catch((err) => {
        getLogger().error('[FileSystemPool] Cleanup error:', err)
      })
    }, this.cleanupIntervalMs)

    // Don't let the timer prevent process exit
    this.cleanupTimer.unref()
  }

  /**
   * Stop periodic cleanup
   */
  stopPeriodicCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Clean up idle filesystems that have no active references
   * and have been idle longer than the timeout
   */
  async cleanupIdle(): Promise<number> {
    const now = Date.now()
    const toRemove: string[] = []

    for (const [key, managed] of this.cache.entries()) {
      const idleTime = now - managed.lastAccessTime
      if (managed.activeReferences === 0 && idleTime > this.idleTimeoutMs) {
        toRemove.push(key)
      }
    }

    if (toRemove.length > 0) {
      getLogger().info(`[FileSystemPool] Cleaning up ${toRemove.length} idle filesystem(s)`)
    }

    for (const key of toRemove) {
      await this.destroyFileSystem(key)
    }

    return toRemove.length
  }

  /**
   * Destroy a specific filesystem
   */
  private async destroyFileSystem(cacheKey: string): Promise<void> {
    const managed = this.cache.get(cacheKey)
    if (!managed) {
      return
    }

    // Remove from cache FIRST to prevent new acquisitions during cleanup.
    // This ensures that any cleanup operations use the existing filesystem
    // rather than creating new entries in the cache.
    this.cache.delete(cacheKey)

    // Create a promise to track cleanup progress. This allows acquire() to wait
    // for cleanup to complete before creating a new filesystem for this user.
    let resolveCleanup: () => void
    const cleanupPromise = new Promise<void>((resolve) => {
      resolveCleanup = resolve
    })
    this.cleanupInProgress.set(cacheKey, cleanupPromise)

    try {
      // Invoke connection destroyed hook with the filesystem so cleanup operations
      // can use the existing connection. The hook receives the filesystem
      // which is still valid at this point.
      if (this.onConnectionDestroyed) {
        try {
          await Promise.resolve(this.onConnectionDestroyed(managed.userId, managed.fs))
        } catch (err) {
          getLogger().error(`[FileSystemPool] onConnectionDestroyed hook failed for user ${managed.userId}:`, err)
        }
      }

      try {
        await managed.fs.destroy()
        getLogger().info(`[FileSystemPool] Destroyed filesystem for: ${cacheKey}`)
      } catch (err) {
        getLogger().error(`[FileSystemPool] Error destroying filesystem ${cacheKey}:`, err)
      }
    } finally {
      // Always resolve the cleanup promise and remove from tracking
      this.cleanupInProgress.delete(cacheKey)
      resolveCleanup!()
    }
  }

  /**
   * Force destroy a filesystem for a specific user
   * Use with caution - will interrupt any ongoing operations
   */
  async forceDestroy(userId: string): Promise<void> {
    const cacheKey = this.getCacheKey(userId)

    if (this.cache.has(cacheKey)) {
      await this.destroyFileSystem(cacheKey)
    }
  }

  /**
   * Destroy all filesystems and shutdown the pool
   */
  async destroyAll(): Promise<void> {
    this.stopPeriodicCleanup()

    const keys = Array.from(this.cache.keys())
    getLogger().info(`[FileSystemPool] Destroying all ${keys.length} filesystem(s)`)

    for (const key of keys) {
      await this.destroyFileSystem(key)
    }
  }

  /**
   * Get statistics about the pool
   */
  getStats(): PoolStats {
    let totalActiveReferences = 0
    let activeFileSystems = 0
    const userIds: string[] = []

    for (const managed of this.cache.values()) {
      totalActiveReferences += managed.activeReferences
      if (managed.activeReferences > 0) {
        activeFileSystems++
      }
      if (!userIds.includes(managed.userId)) {
        userIds.push(managed.userId)
      }
    }

    return {
      totalFileSystems: this.cache.size,
      activeFileSystems,
      idleFileSystems: this.cache.size - activeFileSystems,
      totalActiveReferences,
      userIds,
    }
  }

  /**
   * Check if a filesystem exists for a user
   */
  hasFileSystem(userId: string): boolean {
    return this.cache.has(this.getCacheKey(userId))
  }
}
