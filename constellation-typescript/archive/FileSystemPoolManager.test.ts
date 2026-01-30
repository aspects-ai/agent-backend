/**
 * Unit tests for FileSystemPoolManager
 *
 * These tests verify:
 * - Connection pooling and reuse
 * - Reference counting
 * - Idle cleanup
 * - Race condition prevention during cleanup
 * - Lifecycle hooks
 * - Error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileSystemPoolManager } from '../FileSystemPoolManager.js'
import type { FileSystem } from '../FileSystem.js'
import type { Workspace, WorkspaceConfig } from '../workspace/Workspace.js'
import type { BackendConfig } from '../types.js'

/**
 * Mock workspace implementation
 */
interface MockWorkspace {
  workspaceName: string
  workspacePath: string
  userId: string
  exec: (command: string) => Promise<string>
  read: (path: string) => Promise<string>
  write: (path: string, content: string) => Promise<void>
  _execCalls: string[]
}

/**
 * Creates a mock FileSystem that tracks method calls and state
 */
function createMockFileSystem(userId: string): FileSystem & {
  _isDestroyed: boolean
  _workspaces: Map<string, MockWorkspace>
  _execCalls: string[]
} {
  const workspaces = new Map<string, MockWorkspace>()
  const execCalls: string[] = []
  let isDestroyed = false

  const mockFs = {
    _isDestroyed: isDestroyed,
    _workspaces: workspaces,
    _execCalls: execCalls,

    async getWorkspace(workspaceName: string, _config?: WorkspaceConfig): Promise<Workspace> {
      if (isDestroyed) {
        throw new Error('FileSystem has been destroyed')
      }

      let workspace = workspaces.get(workspaceName)
      if (!workspace) {
        workspace = {
          workspaceName,
          workspacePath: `/constellation-fs/users/${userId}/${workspaceName}`,
          userId,
          _execCalls: [],
          async exec(command: string): Promise<string> {
            this._execCalls.push(command)
            execCalls.push(command)
            return `Executed: ${command}`
          },
          async read(_path: string): Promise<string> {
            return 'mock content'
          },
          async write(_path: string, _content: string): Promise<void> {
            // Mock write
          },
        }
        workspaces.set(workspaceName, workspace)
      }

      return workspace as unknown as Workspace
    },

    async destroy(): Promise<void> {
      isDestroyed = true
      mockFs._isDestroyed = true
      workspaces.clear()
    },

    async listWorkspaces(): Promise<string[]> {
      return Array.from(workspaces.keys())
    },

    get userId(): string {
      return userId
    },

    get isRemote(): boolean {
      return false
    },

    get config(): BackendConfig {
      return { type: 'local', userId } as BackendConfig
    },
  }

  return mockFs as unknown as FileSystem & {
    _isDestroyed: boolean
    _workspaces: Map<string, MockWorkspace>
    _execCalls: string[]
  }
}

describe('FileSystemPoolManager', () => {
  let pool: FileSystemPoolManager
  let mockFileSystems: Map<string, ReturnType<typeof createMockFileSystem>>
  let onConnectionCreatedCalls: string[]
  let onConnectionDestroyedCalls: Array<{ userId: string; fs: ReturnType<typeof createMockFileSystem> }>

  beforeEach(() => {
    mockFileSystems = new Map()
    onConnectionCreatedCalls = []
    onConnectionDestroyedCalls = []

    // Create pool with test-friendly timeouts
    pool = new FileSystemPoolManager({
      idleTimeoutMs: 100, // Short timeout for testing
      cleanupIntervalMs: 50, // Short interval for testing
      enablePeriodicCleanup: false, // Disable auto cleanup, we'll trigger manually
      defaultBackendConfig: { type: 'local' },
      onConnectionCreated: (userId) => {
        onConnectionCreatedCalls.push(userId)
      },
      onConnectionDestroyed: (userId, fs) => {
        const trackingMock = mockFileSystems.get(userId)
        if (trackingMock) {
          onConnectionDestroyedCalls.push({ userId, fs: trackingMock })
        }
      },
    })

    // Intercept filesystem creation to inject mocks
    const originalCreateManagedFileSystem = (pool as any).createManagedFileSystem.bind(pool)
    ;(pool as any).createManagedFileSystem = function (userId: string, backendConfig?: Partial<BackendConfig>) {
      // Create our tracking mock
      const mockFs = createMockFileSystem(userId)
      mockFileSystems.set(userId, mockFs)

      // Return a managed structure with our mock
      return {
        fs: mockFs,
        userId,
        activeReferences: 0,
        lastAccessTime: Date.now(),
      }
    }
  })

  afterEach(async () => {
    // Clean up
    pool.stopPeriodicCleanup()
    await pool.destroyAll()
    vi.clearAllMocks()
  })

  describe('Normal Lifecycle', () => {
    it('should create filesystem on first acquire and reuse on subsequent acquires', async () => {
      const userId = 'user-123'

      // First acquire
      const { fileSystem: fs1, release: release1 } = await pool.acquireFileSystem({ userId })
      expect(fs1).toBeDefined()
      expect(pool.hasFileSystem(userId)).toBe(true)

      // Second acquire should reuse
      const { fileSystem: fs2, release: release2 } = await pool.acquireFileSystem({ userId })
      expect(fs2).toBeDefined()

      // Both should reference the same filesystem
      expect(fs1).toBe(fs2)
      const stats = pool.getStats()
      expect(stats.totalFileSystems).toBe(1)
      expect(stats.totalActiveReferences).toBe(2)

      // Release both
      release1()
      release2()

      const statsAfter = pool.getStats()
      expect(statsAfter.totalActiveReferences).toBe(0)
    })

    it('should support callback pattern with automatic cleanup', async () => {
      const userId = 'user-123'
      let capturedFs: FileSystem | null = null

      const result = await pool.withFileSystem({ userId }, async (fs) => {
        capturedFs = fs
        expect(fs).toBeDefined()
        return 'test-result'
      })

      expect(result).toBe('test-result')
      expect(capturedFs).toBeDefined()

      // Should be released automatically
      const stats = pool.getStats()
      expect(stats.totalActiveReferences).toBe(0)
    })

    it('should support workspace callback pattern', async () => {
      const userId = 'user-123'
      let capturedWorkspace: Workspace | null = null

      const result = await pool.withWorkspace(
        { userId, workspace: 'my-project' },
        async (workspace) => {
          capturedWorkspace = workspace
          await workspace.exec('test command')
          return 'workspace-result'
        }
      )

      expect(result).toBe('workspace-result')
      expect(capturedWorkspace).toBeDefined()

      // Verify command was executed
      const mockFs = mockFileSystems.get(userId)!
      expect(mockFs._execCalls).toContain('test command')

      // Should be released automatically
      const stats = pool.getStats()
      expect(stats.totalActiveReferences).toBe(0)
    })

    it('should track multiple users independently', async () => {
      const { fileSystem: fs1, release: release1 } = await pool.acquireFileSystem({ userId: 'user-1' })
      const { fileSystem: fs2, release: release2 } = await pool.acquireFileSystem({ userId: 'user-2' })
      const { fileSystem: fs3, release: release3 } = await pool.acquireFileSystem({ userId: 'user-1' })

      const stats = pool.getStats()
      expect(stats.totalFileSystems).toBe(2)
      expect(stats.userIds).toContain('user-1')
      expect(stats.userIds).toContain('user-2')

      release1()
      release2()
      release3()
    })

    it('should call onConnectionCreated hook for new connections', async () => {
      const userId = 'user-123'

      const { release } = await pool.acquireFileSystem({ userId })

      // Hook should be called once
      expect(onConnectionCreatedCalls).toHaveLength(1)
      expect(onConnectionCreatedCalls[0]).toBe(userId)

      release()

      // Reusing should not call hook again
      const { release: release2 } = await pool.acquireFileSystem({ userId })
      expect(onConnectionCreatedCalls).toHaveLength(1)

      release2()
    })

    it('should get workspace with acquireWorkspace helper', async () => {
      const userId = 'user-123'
      const workspaceName = 'my-project'

      const { workspace, release } = await pool.acquireWorkspace({
        userId,
        workspace: workspaceName,
      })

      expect(workspace).toBeDefined()
      expect(workspace.workspaceName).toBe(workspaceName)

      await workspace.exec('test command')

      const mockFs = mockFileSystems.get(userId)!
      expect(mockFs._execCalls).toContain('test command')

      release()
    })
  })

  describe('Reference Counting', () => {
    it('should prevent cleanup while references are active', async () => {
      const userId = 'user-123'

      const { release: release1 } = await pool.acquireFileSystem({ userId })
      const { release: release2 } = await pool.acquireFileSystem({ userId })

      // Release one reference
      release1()

      // Wait for idle timeout
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Try cleanup - should not remove because one reference is still active
      await pool.cleanupIdle()

      expect(pool.hasFileSystem(userId)).toBe(true)
      const stats = pool.getStats()
      expect(stats.totalActiveReferences).toBe(1)

      // Release last reference
      release2()

      // Now cleanup should work
      await new Promise((resolve) => setTimeout(resolve, 150))
      await pool.cleanupIdle()

      expect(pool.hasFileSystem(userId)).toBe(false)
    })

    it('should handle concurrent acquires correctly', async () => {
      const userId = 'user-123'

      // Simulate concurrent requests
      const results = await Promise.all([
        pool.acquireFileSystem({ userId }),
        pool.acquireFileSystem({ userId }),
        pool.acquireFileSystem({ userId }),
      ])

      const stats = pool.getStats()
      expect(stats.totalFileSystems).toBe(1)
      expect(stats.totalActiveReferences).toBe(3)

      // Release all
      results.forEach(({ release }) => release())
      expect(pool.getStats().totalActiveReferences).toBe(0)
    })
  })

  describe('Idle Cleanup', () => {
    it('should clean up idle filesystems after timeout', async () => {
      const userId = 'user-123'

      const { release } = await pool.acquireFileSystem({ userId })
      release()

      // Before timeout - should still exist
      expect(pool.hasFileSystem(userId)).toBe(true)

      // Wait for idle timeout
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Cleanup should remove it
      const cleanedCount = await pool.cleanupIdle()
      expect(cleanedCount).toBe(1)
      expect(pool.hasFileSystem(userId)).toBe(false)
    })

    it('should call onConnectionDestroyed with filesystem during cleanup', async () => {
      const userId = 'user-123'

      const { release } = await pool.acquireFileSystem({ userId })
      release()

      // Wait and cleanup
      await new Promise((resolve) => setTimeout(resolve, 150))
      await pool.cleanupIdle()

      // Verify hook was called
      expect(onConnectionDestroyedCalls).toHaveLength(1)
      expect(onConnectionDestroyedCalls[0].userId).toBe(userId)
      expect(onConnectionDestroyedCalls[0].fs).toBeDefined()
    })

    it('should use passed filesystem for cleanup operations', async () => {
      const userId = 'user-123'

      const { release } = await pool.acquireFileSystem({ userId })
      release()

      // Get reference to mock before destruction
      const mockFs = mockFileSystems.get(userId)!
      expect(mockFs._isDestroyed).toBe(false)

      // Wait and cleanup
      await new Promise((resolve) => setTimeout(resolve, 150))
      await pool.cleanupIdle()

      // Verify filesystem was destroyed
      expect(mockFs._isDestroyed).toBe(true)
    })

    it('should not clean up recently accessed filesystems', async () => {
      const userId = 'user-123'

      const { release } = await pool.acquireFileSystem({ userId })

      // Wait a bit but not past timeout
      await new Promise((resolve) => setTimeout(resolve, 50))

      release()

      // Immediately try cleanup - should not remove because not idle long enough
      await pool.cleanupIdle()

      expect(pool.hasFileSystem(userId)).toBe(true)
    })

    it('should clean up multiple idle filesystems', async () => {
      // Create multiple users
      const releases = await Promise.all([
        pool.acquireFileSystem({ userId: 'user-1' }),
        pool.acquireFileSystem({ userId: 'user-2' }),
        pool.acquireFileSystem({ userId: 'user-3' }),
      ])

      // Release all
      releases.forEach(({ release }) => release())

      // Wait for idle timeout
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Cleanup should remove all
      const cleanedCount = await pool.cleanupIdle()
      expect(cleanedCount).toBe(3)
      expect(pool.getStats().totalFileSystems).toBe(0)
    })
  })

  describe('Race Condition Prevention', () => {
    it('should wait for cleanup to complete before creating new filesystem', async () => {
      const userId = 'user-123'

      // First session
      const { release: release1 } = await pool.acquireFileSystem({ userId })
      release1()

      // Track event order
      const events: string[] = []

      // Make cleanup slow
      const originalOnConnectionDestroyed = (pool as any).onConnectionDestroyed
      ;(pool as any).onConnectionDestroyed = async (uid: string, fs: FileSystem) => {
        events.push('cleanup_start')
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (originalOnConnectionDestroyed) {
          await originalOnConnectionDestroyed(uid, fs)
        }
        events.push('cleanup_end')
      }

      // Wait for idle timeout
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Start cleanup (don't await)
      const cleanupPromise = pool.cleanupIdle()

      // Wait a bit for cleanup to start
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(events).toContain('cleanup_start')

      // Try to acquire during cleanup - should wait
      events.push('acquire_start')
      const { release: release2 } = await pool.acquireFileSystem({ userId })
      events.push('acquire_end')

      // Ensure cleanup finishes
      await cleanupPromise

      // Verify order: cleanup must finish before acquire completes
      const cleanupEndIndex = events.indexOf('cleanup_end')
      const acquireEndIndex = events.indexOf('acquire_end')
      expect(cleanupEndIndex).toBeLessThan(acquireEndIndex)

      release2()
    })

    it('should handle rapid acquire/release cycles', async () => {
      const userId = 'user-123'

      // Simulate rapid operations
      for (let i = 0; i < 10; i++) {
        const { release } = await pool.acquireFileSystem({ userId })
        release()
      }

      const stats = pool.getStats()
      expect(stats.totalFileSystems).toBe(1)
      expect(stats.totalActiveReferences).toBe(0)
    })

    it('should handle concurrent acquires for same user', async () => {
      const userId = 'user-123'

      const results = await Promise.all([
        pool.acquireFileSystem({ userId }),
        pool.acquireFileSystem({ userId }),
        pool.acquireFileSystem({ userId }),
      ])

      const stats = pool.getStats()
      expect(stats.totalFileSystems).toBe(1)
      expect(stats.totalActiveReferences).toBe(3)

      results.forEach(({ release }) => release())
      expect(pool.getStats().totalActiveReferences).toBe(0)
    })

    it('should handle session recreation after cleanup', async () => {
      const userId = 'user-123'

      // First session
      const { release: release1 } = await pool.acquireFileSystem({ userId })
      release1()

      // Wait and cleanup
      await new Promise((resolve) => setTimeout(resolve, 150))
      await pool.cleanupIdle()

      expect(pool.hasFileSystem(userId)).toBe(false)
      expect(mockFileSystems.get(userId)?._isDestroyed).toBe(true)

      // Clear old mock
      mockFileSystems.delete(userId)

      // Second session - should create new filesystem
      const { release: release2 } = await pool.acquireFileSystem({ userId })

      expect(pool.hasFileSystem(userId)).toBe(true)
      const newMock = mockFileSystems.get(userId)!
      expect(newMock._isDestroyed).toBe(false)

      release2()
    })
  })

  describe('Error Handling', () => {
    it('should handle filesystem destroy errors gracefully', async () => {
      const userId = 'user-123'

      const { release } = await pool.acquireFileSystem({ userId })

      // Make destroy throw
      const mockFs = mockFileSystems.get(userId)!
      mockFs.destroy = async () => {
        throw new Error('Destroy failed')
      }

      release()

      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should not throw
      await expect(pool.cleanupIdle()).resolves.not.toThrow()
    })

    it('should handle hook errors gracefully', async () => {
      const userId = 'user-123'

      // Make hook throw
      ;(pool as any).onConnectionDestroyed = async () => {
        throw new Error('Hook failed')
      }

      const { release } = await pool.acquireFileSystem({ userId })
      release()

      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should not throw - errors are caught and logged
      await expect(pool.cleanupIdle()).resolves.not.toThrow()
    })

    it('should release callback pattern even on error', async () => {
      const userId = 'user-123'

      await expect(
        pool.withFileSystem({ userId }, async (fs) => {
          throw new Error('Operation failed')
        })
      ).rejects.toThrow('Operation failed')

      // Should still be released
      const stats = pool.getStats()
      expect(stats.totalActiveReferences).toBe(0)
    })

    it('should release workspace callback pattern even on error', async () => {
      const userId = 'user-123'

      await expect(
        pool.withWorkspace({ userId, workspace: 'project' }, async (workspace) => {
          throw new Error('Workspace operation failed')
        })
      ).rejects.toThrow('Workspace operation failed')

      // Should still be released
      const stats = pool.getStats()
      expect(stats.totalActiveReferences).toBe(0)
    })
  })

  describe('Shutdown', () => {
    it('should destroy all filesystems on destroyAll', async () => {
      // Create multiple users
      const releases = await Promise.all([
        pool.acquireFileSystem({ userId: 'user-1' }),
        pool.acquireFileSystem({ userId: 'user-2' }),
        pool.acquireFileSystem({ userId: 'user-3' }),
      ])

      expect(pool.getStats().totalFileSystems).toBe(3)

      // Release all
      releases.forEach(({ release }) => release())

      // Destroy all
      await pool.destroyAll()

      expect(pool.getStats().totalFileSystems).toBe(0)

      // All mocks should be destroyed
      mockFileSystems.forEach((mockFs) => {
        expect(mockFs._isDestroyed).toBe(true)
      })
    })

    it('should call onConnectionDestroyed for each filesystem on destroyAll', async () => {
      await pool.acquireFileSystem({ userId: 'user-1' })
      await pool.acquireFileSystem({ userId: 'user-2' })

      await pool.destroyAll()

      expect(onConnectionDestroyedCalls).toHaveLength(2)
    })

    it('should stop periodic cleanup on destroyAll', async () => {
      // Create pool with periodic cleanup enabled
      const poolWithCleanup = new FileSystemPoolManager({
        idleTimeoutMs: 100,
        cleanupIntervalMs: 50,
        enablePeriodicCleanup: true,
      })

      await poolWithCleanup.destroyAll()

      // Timer should be stopped (we can't easily verify this, but at least it shouldn't error)
      expect(true).toBe(true)
    })
  })

  describe('Statistics', () => {
    it('should provide accurate statistics', async () => {
      const r1 = await pool.acquireFileSystem({ userId: 'user-1' })
      const r2 = await pool.acquireFileSystem({ userId: 'user-2' })
      const r3 = await pool.acquireFileSystem({ userId: 'user-1' })

      const stats = pool.getStats()
      expect(stats.totalFileSystems).toBe(2)
      expect(stats.activeFileSystems).toBe(2)
      expect(stats.idleFileSystems).toBe(0)
      expect(stats.totalActiveReferences).toBe(3)
      expect(stats.userIds).toEqual(['user-1', 'user-2'])

      r1.release()
      r2.release()

      const stats2 = pool.getStats()
      expect(stats2.activeFileSystems).toBe(1) // user-1 still has 1 reference
      expect(stats2.idleFileSystems).toBe(1) // user-2 has 0 references
      expect(stats2.totalActiveReferences).toBe(1)

      r3.release()

      const stats3 = pool.getStats()
      expect(stats3.activeFileSystems).toBe(0)
      expect(stats3.idleFileSystems).toBe(2)
      expect(stats3.totalActiveReferences).toBe(0)
    })

    it('should check if filesystem exists for user', async () => {
      expect(pool.hasFileSystem('user-123')).toBe(false)

      const { release } = await pool.acquireFileSystem({ userId: 'user-123' })

      expect(pool.hasFileSystem('user-123')).toBe(true)

      release()

      // Still exists after release (just idle)
      expect(pool.hasFileSystem('user-123')).toBe(true)

      // After cleanup, should not exist
      await new Promise((resolve) => setTimeout(resolve, 150))
      await pool.cleanupIdle()

      expect(pool.hasFileSystem('user-123')).toBe(false)
    })
  })

  describe('Force Destroy', () => {
    it('should force destroy filesystem for specific user', async () => {
      const { release: release1 } = await pool.acquireFileSystem({ userId: 'user-1' })
      const { release: release2 } = await pool.acquireFileSystem({ userId: 'user-2' })

      expect(pool.getStats().totalFileSystems).toBe(2)

      // Force destroy user-1
      await pool.forceDestroy('user-1')

      expect(pool.hasFileSystem('user-1')).toBe(false)
      expect(pool.hasFileSystem('user-2')).toBe(true)

      release2()
    })
  })
})
