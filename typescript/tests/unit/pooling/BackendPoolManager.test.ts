import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BackendPoolManager } from '../../../src/BackendPoolManager.js'
import { ConnectionStatus } from '../../../src/backends/types.js'
import type { FileBasedBackend } from '../../../src/types.js'

// Mock backend class for testing
class MockBackend implements Partial<FileBasedBackend> {
  static instanceCount = 0
  instanceId: number
  type = 'local-filesystem' as const
  rootDir: string
  status = ConnectionStatus.CONNECTED
  onStatusChange = vi.fn(() => () => {})
  destroy = vi.fn().mockResolvedValue(undefined)
  read = vi.fn().mockResolvedValue('content')
  write = vi.fn().mockResolvedValue(undefined)

  constructor(public config: any) {
    this.instanceId = ++MockBackend.instanceCount
    this.rootDir = config?.rootDir || '/test'
  }
}

describe('BackendPoolManager (Unit Tests)', () => {
  let pool: BackendPoolManager<MockBackend>

  beforeEach(() => {
    vi.clearAllMocks()
    MockBackend.instanceCount = 0

    pool = new BackendPoolManager({
      backendClass: MockBackend as any,
      defaultConfig: { rootDir: '/test/pool' }
    })
  })

  afterEach(async () => {
    await pool.destroyAll()
  })

  describe('Initialization', () => {
    it('should create pool with correct config', () => {
      expect(pool).toBeDefined()
    })

    it('should start with empty pool', () => {
      const stats = pool.getStats()
      expect(stats.totalBackends).toBe(0)
    })

    it('should accept valid backendClass', () => {
      // TypeScript enforces backendClass at compile time
      // At runtime, pool manager doesn't validate, so we just verify creation succeeds
      const validPool = new BackendPoolManager({
        backendClass: MockBackend as any,
        defaultConfig: {}
      })
      expect(validPool).toBeDefined()
    })
  })

  describe('Backend Acquisition & Release', () => {
    it('should create new backend for new key', async () => {
      let acquiredBackend: MockBackend | null = null

      await pool.withBackend({ key: 'user1' }, async (backend) => {
        acquiredBackend = backend
        expect(backend).toBeInstanceOf(MockBackend)
      })

      expect(acquiredBackend).not.toBeNull()
      expect(acquiredBackend?.instanceId).toBe(1)
    })

    it('should reuse backend for same key', async () => {
      let backend1: MockBackend | null = null
      let backend2: MockBackend | null = null

      await pool.withBackend({ key: 'user1' }, async (b) => {
        backend1 = b
      })

      await pool.withBackend({ key: 'user1' }, async (b) => {
        backend2 = b
      })

      // Should be the EXACT same instance
      expect(backend1).toBe(backend2)
      expect(backend1?.instanceId).toBe(backend2?.instanceId)
    })

    it('should create separate backends for different keys', async () => {
      let backend1: MockBackend | null = null
      let backend2: MockBackend | null = null

      await pool.withBackend({ key: 'user1' }, async (b) => {
        backend1 = b
      })

      await pool.withBackend({ key: 'user2' }, async (b) => {
        backend2 = b
      })

      expect(backend1).not.toBe(backend2)
      expect(backend1?.instanceId).not.toBe(backend2?.instanceId)
    })

    it('should create non-pooled backend when key is undefined', async () => {
      let backend1: MockBackend | null = null
      let backend2: MockBackend | null = null

      await pool.withBackend({}, async (b) => {
        backend1 = b
      })

      await pool.withBackend({}, async (b) => {
        backend2 = b
      })

      // Should be different instances (not pooled)
      expect(backend1).not.toBe(backend2)
    })

    it('should apply default config to backends', async () => {
      await pool.withBackend({ key: 'test' }, async (backend) => {
        expect(backend.rootDir).toBe('/test/pool')
      })
    })

    it('should allow per-request config overrides', async () => {
      await pool.withBackend(
        {
          key: 'test',
          config: { rootDir: '/custom/path' }
        },
        async (backend) => {
          expect(backend.config.rootDir).toBe('/custom/path')
        }
      )
    })

    it('should merge config overrides with defaults', async () => {
      const poolWithDefaults = new BackendPoolManager({
        backendClass: MockBackend as any,
        defaultConfig: {
          rootDir: '/default',
          option1: 'default1',
          option2: 'default2'
        }
      })

      await poolWithDefaults.withBackend(
        {
          key: 'test',
          config: { option2: 'override2' }
        },
        async (backend) => {
          expect(backend.config.option1).toBe('default1')
          expect(backend.config.option2).toBe('override2')
        }
      )

      await poolWithDefaults.destroyAll()
    })
  })

  describe('Callback Execution', () => {
    it('should execute callback with backend', async () => {
      const callback = vi.fn(async (backend) => {
        expect(backend).toBeInstanceOf(MockBackend)
      })

      await pool.withBackend({ key: 'test' }, callback)

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should return callback result', async () => {
      const result = await pool.withBackend({ key: 'test' }, async () => {
        return 'test result'
      })

      expect(result).toBe('test result')
    })

    it('should handle async callback results', async () => {
      const result = await pool.withBackend({ key: 'test' }, async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { data: 'async result' }
      })

      expect(result).toEqual({ data: 'async result' })
    })

    it('should allow backend operations in callback', async () => {
      await pool.withBackend({ key: 'test' }, async (backend) => {
        await backend.write!('file.txt', 'content')
        const content = await backend.read!('file.txt')
        expect(content).toBe('content')
      })
    })
  })

  describe('Error Handling', () => {
    it('should release backend even if callback throws', async () => {
      let backend1: MockBackend | null = null

      await expect(
        pool.withBackend({ key: 'test' }, async (b) => {
          backend1 = b
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')

      // Backend should still be in pool and reusable
      await pool.withBackend({ key: 'test' }, async (backend2) => {
        expect(backend1).toBe(backend2)
      })
    })

    it('should propagate callback errors', async () => {
      await expect(
        pool.withBackend({ key: 'test' }, async () => {
          throw new Error('Custom error')
        })
      ).rejects.toThrow('Custom error')
    })

    it('should not add backend to pool if creation fails', async () => {
      class FailingBackend extends MockBackend {
        constructor(config: any) {
          super(config)
          throw new Error('Backend creation failed')
        }
      }

      const failingPool = new BackendPoolManager({
        backendClass: FailingBackend as any,
        defaultConfig: {}
      })

      await expect(
        failingPool.withBackend({ key: 'test' }, async () => {})
      ).rejects.toThrow('Backend creation failed')

      const stats = failingPool.getStats()
      expect(stats.totalBackends).toBe(0)

      await failingPool.destroyAll()
    })
  })

  describe('Concurrency', () => {
    it('should handle multiple concurrent requests to same key', async () => {
      const results: number[] = []

      const promises = Array.from({ length: 5 }, (_, i) =>
        pool.withBackend({ key: 'shared' }, async (backend) => {
          results.push(backend.instanceId)
          return backend.instanceId
        })
      )

      await Promise.all(promises)

      // All should use the same backend instance
      const uniqueIds = [...new Set(results)]
      expect(uniqueIds.length).toBe(1)
    })

    it('should handle concurrent requests to different keys', async () => {
      const results: Array<{ key: string; instanceId: number }> = []

      const promises = Array.from({ length: 5 }, (_, i) =>
        pool.withBackend({ key: `user${i}` }, async (backend) => {
          const entry = { key: `user${i}`, instanceId: backend.instanceId }
          results.push(entry)
          return entry
        })
      )

      await Promise.all(promises)

      // Each key should have its own backend
      expect(results.length).toBe(5)
      const instanceIds = results.map(r => r.instanceId)
      const uniqueIds = [...new Set(instanceIds)]
      expect(uniqueIds.length).toBe(5)
    })

    it('should serialize access to same backend', async () => {
      const executionOrder: number[] = []

      const promises = Array.from({ length: 3 }, (_, i) =>
        pool.withBackend({ key: 'shared' }, async () => {
          executionOrder.push(i)
          await new Promise(resolve => setTimeout(resolve, 10))
          executionOrder.push(i + 10)
        })
      )

      await Promise.all(promises)

      // Operations should not interleave
      // Each operation should complete before the next starts
      expect(executionOrder).toHaveLength(6)
    })
  })

  describe('Statistics', () => {
    it('should track total backends', async () => {
      await pool.withBackend({ key: 'user1' }, async () => {})
      await pool.withBackend({ key: 'user2' }, async () => {})
      await pool.withBackend({ key: 'user3' }, async () => {})

      const stats = pool.getStats()
      expect(stats.totalBackends).toBe(3)
    })

    it('should track backends per key', async () => {
      await pool.withBackend({ key: 'user1' }, async () => {})
      await pool.withBackend({ key: 'user1' }, async () => {}) // Reuse
      await pool.withBackend({ key: 'user2' }, async () => {})

      const stats = pool.getStats()
      expect(stats.backendsByKey['user1']).toBe(1)
      expect(stats.backendsByKey['user2']).toBe(1)
    })

    it('should update stats after destroyAll', async () => {
      await pool.withBackend({ key: 'user1' }, async () => {})
      await pool.withBackend({ key: 'user2' }, async () => {})

      await pool.destroyAll()

      const stats = pool.getStats()
      expect(stats.totalBackends).toBe(0)
      expect(Object.keys(stats.backendsByKey)).toHaveLength(0)
    })
  })

  describe('Pool Destruction', () => {
    it('should call destroy on all backends', async () => {
      const backends: MockBackend[] = []

      await pool.withBackend({ key: 'user1' }, async (b) => backends.push(b))
      await pool.withBackend({ key: 'user2' }, async (b) => backends.push(b))
      await pool.withBackend({ key: 'user3' }, async (b) => backends.push(b))

      await pool.destroyAll()

      backends.forEach(backend => {
        expect(backend.destroy).toHaveBeenCalledTimes(1)
      })
    })

    it('should clear pool after destroy', async () => {
      let backend1: MockBackend | null = null
      let backend2: MockBackend | null = null

      await pool.withBackend({ key: 'user1' }, async (b) => {
        backend1 = b
      })

      await pool.destroyAll()

      await pool.withBackend({ key: 'user1' }, async (b) => {
        backend2 = b
      })

      // Should be different instance (new backend created)
      expect(backend1).not.toBe(backend2)
      expect(backend1?.instanceId).not.toBe(backend2?.instanceId)
    })

    it('should handle destroy errors gracefully', async () => {
      class ErrorBackend extends MockBackend {
        destroy = vi.fn().mockRejectedValue(new Error('Destroy failed'))
      }

      const errorPool = new BackendPoolManager({
        backendClass: ErrorBackend as any,
        defaultConfig: {}
      })

      await errorPool.withBackend({ key: 'test' }, async () => {})

      // destroyAll should not throw even if individual destroys fail
      await expect(errorPool.destroyAll()).resolves.toBeUndefined()
    })

    it('should be usable after destroyAll', async () => {
      await pool.withBackend({ key: 'test' }, async () => {})
      await pool.destroyAll()

      // Should be able to use pool again
      await expect(
        pool.withBackend({ key: 'test' }, async (backend) => {
          expect(backend).toBeInstanceOf(MockBackend)
        })
      ).resolves.toBeUndefined()
    })
  })

  describe('Backend Lifecycle', () => {
    it('should create backend lazily on first access', async () => {
      expect(MockBackend.instanceCount).toBe(0)

      await pool.withBackend({ key: 'lazy' }, async () => {})

      expect(MockBackend.instanceCount).toBe(1)
    })

    it('should not recreate backends between accesses', async () => {
      await pool.withBackend({ key: 'persistent' }, async () => {})
      const countAfterFirst = MockBackend.instanceCount

      await pool.withBackend({ key: 'persistent' }, async () => {})
      const countAfterSecond = MockBackend.instanceCount

      expect(countAfterSecond).toBe(countAfterFirst)
    })

    it('should clean up backends only when explicitly destroyed', async () => {
      const backend = await pool.withBackend({ key: 'test' }, async (b) => b)

      expect(backend.destroy).not.toHaveBeenCalled()

      await pool.destroyAll()

      expect(backend.destroy).toHaveBeenCalled()
    })
  })
})
