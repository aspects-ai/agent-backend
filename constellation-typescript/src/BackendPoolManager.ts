/**
 * Connection pool manager for Backend instances
 * Manages pooled backend connections with automatic cleanup and lifecycle management
 */

import type { Backend } from './backends/index.js'
import { getLogger } from './utils/logger.js'

export interface PoolManagerConfig<T extends Backend> {
  /** Backend class to instantiate */
  backendClass: new (config: any) => T

  /** Default configuration for backends */
  defaultConfig: any

  /** Idle timeout in milliseconds (default: 5 minutes) */
  idleTimeoutMs?: number

  /** Enable periodic cleanup of idle backends (default: false) */
  enablePeriodicCleanup?: boolean

  /** Cleanup interval in milliseconds (default: 1 minute) */
  cleanupIntervalMs?: number
}

export interface PoolStats {
  /** Total number of backends in pool */
  totalBackends: number

  /** Number of backends currently in use */
  activeBackends: number

  /** Number of idle backends */
  idleBackends: number
}

interface PooledBackend<T extends Backend> {
  backend: T
  inUse: number
  lastUsed: number
}

/**
 * Generic backend pool manager
 * Manages pooled connections for any Backend type with automatic cleanup
 *
 * @example
 * ```typescript
 * // Pool remote filesystem backends
 * const pool = new BackendPoolManager({
 *   backendClass: RemoteFilesystemBackend,
 *   defaultConfig: {
 *     rootDir: '/var/workspace',
 *     host: 'server.com',
 *     sshAuth: { type: 'password', credentials: { username: 'agent', password: 'pass' } }
 *   },
 *   idleTimeoutMs: 5 * 60 * 1000,
 *   enablePeriodicCleanup: true
 * })
 *
 * // Use in request handler
 * await pool.withBackend({ key: userId }, async (backend) => {
 *   const scope = backend.scope(`projects/${projectId}`)
 *   return await scope.exec('npm run build')
 * })
 * ```
 */
export class BackendPoolManager<T extends Backend> {
  private backends: Map<string, PooledBackend<T>>
  private readonly config: PoolManagerConfig<T>
  private cleanupInterval?: NodeJS.Timeout

  constructor(config: PoolManagerConfig<T>) {
    this.config = {
      idleTimeoutMs: 5 * 60 * 1000, // 5 minutes default
      cleanupIntervalMs: 60 * 1000, // 1 minute default
      enablePeriodicCleanup: false,
      ...config
    }

    this.backends = new Map()

    if (this.config.enablePeriodicCleanup) {
      this.startPeriodicCleanup()
    }
  }

  /**
   * Acquire a backend from the pool
   * Creates new backend if not exists or disconnected
   *
   * @param options - Options including key for backend identification
   * @returns Backend instance and release function
   *
   * @example
   * ```typescript
   * const { backend, release } = await pool.acquireBackend({ key: 'user1' })
   * try {
   *   await backend.write('file.txt', 'content')
   * } finally {
   *   release()
   * }
   * ```
   */
  async acquireBackend(options?: { key?: string }): Promise<{ backend: T; release: () => void }> {
    const key = options?.key ?? 'default'

    let pooled = this.backends.get(key)

    if (!pooled || !pooled.backend.connected) {
      // Create new backend
      getLogger().debug(`[BackendPool] Creating new backend for key: ${key}`)
      const backend = new this.config.backendClass(this.config.defaultConfig)
      pooled = {
        backend,
        inUse: 0,
        lastUsed: Date.now()
      }
      this.backends.set(key, pooled)
    }

    pooled.inUse++
    pooled.lastUsed = Date.now()

    getLogger().debug(`[BackendPool] Acquired backend for key: ${key} (inUse: ${pooled.inUse})`)

    const release = () => {
      if (pooled) {
        pooled.inUse--
        pooled.lastUsed = Date.now()
        getLogger().debug(`[BackendPool] Released backend for key: ${key} (inUse: ${pooled.inUse})`)
      }
    }

    return { backend: pooled.backend, release }
  }

  /**
   * Execute function with backend from pool (automatic cleanup)
   * Automatically acquires and releases backend
   *
   * @param options - Options including key for backend identification
   * @param fn - Function to execute with backend
   * @returns Result of function execution
   *
   * @example
   * ```typescript
   * const output = await pool.withBackend({ key: 'user1' }, async (backend) => {
   *   return await backend.exec('ls -la')
   * })
   * ```
   */
  async withBackend<R>(
    options: { key?: string },
    fn: (backend: T) => Promise<R>
  ): Promise<R> {
    const { backend, release } = await this.acquireBackend(options)
    try {
      return await fn(backend)
    } finally {
      release()
    }
  }

  /**
   * Get pool statistics
   *
   * @returns Current pool statistics
   */
  getStats(): PoolStats {
    let activeCount = 0
    let idleCount = 0

    for (const pooled of this.backends.values()) {
      if (pooled.inUse > 0) {
        activeCount++
      } else {
        idleCount++
      }
    }

    return {
      totalBackends: this.backends.size,
      activeBackends: activeCount,
      idleBackends: idleCount
    }
  }

  /**
   * Destroy all backends in pool
   * Call this when shutting down the application
   */
  async destroyAll(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }

    getLogger().debug(`[BackendPool] Destroying all ${this.backends.size} backends`)

    for (const [key, pooled] of this.backends.entries()) {
      try {
        await pooled.backend.destroy()
      } catch (error) {
        getLogger().error(`[BackendPool] Error destroying backend for key ${key}:`, error)
      }
      this.backends.delete(key)
    }
  }

  /**
   * Start periodic cleanup of idle backends
   */
  private startPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleBackends()
    }, this.config.cleanupIntervalMs)
  }

  /**
   * Cleanup idle backends that exceed timeout
   */
  private async cleanupIdleBackends(): Promise<void> {
    const now = Date.now()
    const timeout = this.config.idleTimeoutMs ?? 5 * 60 * 1000

    const toCleanup: string[] = []

    for (const [key, pooled] of this.backends.entries()) {
      if (pooled.inUse === 0 && now - pooled.lastUsed > timeout) {
        toCleanup.push(key)
      }
    }

    if (toCleanup.length > 0) {
      getLogger().debug(`[BackendPool] Cleaning up ${toCleanup.length} idle backends`)

      for (const key of toCleanup) {
        const pooled = this.backends.get(key)
        if (pooled) {
          try {
            await pooled.backend.destroy()
          } catch (error) {
            getLogger().error(`[BackendPool] Error destroying backend for key ${key}:`, error)
          }
          this.backends.delete(key)
        }
      }
    }
  }
}
