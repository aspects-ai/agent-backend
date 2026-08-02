/**
 * Test utilities for verifying mocks and preventing process spawning
 */

import { vi } from 'vitest'
import * as child_process from 'child_process'
import * as fs from 'fs/promises'

/**
 * Verify that no unmocked I/O operations have been called
 *
 * Call this in afterEach to ensure your test didn't accidentally
 * perform real I/O operations.
 *
 * @example
 * afterEach(() => {
 *   verifyNoUnmockedIO()
 * })
 */
export function verifyNoUnmockedIO(): void {
  // This is enforced by the global setup throwing errors
  // But we can add additional verification here if needed
}

/**
 * Assert that spawn was never called without a mock
 *
 * Use this in tests to verify that code paths that shouldn't
 * spawn processes actually don't.
 *
 * @example
 * it('should reject dangerous commands without spawning', async () => {
 *   await expect(backend.exec('rm -rf /')).rejects.toThrow()
 *   assertSpawnNeverCalled()
 * })
 */
export function assertSpawnNeverCalled(): void {
  const spawnMock = vi.mocked(child_process.spawn)

  if (spawnMock.mock.calls.length > 0) {
    throw new Error(
      `❌ Test Assertion Failed: spawn was called ${spawnMock.mock.calls.length} time(s)\n` +
      `Calls: ${JSON.stringify(spawnMock.mock.calls, null, 2)}`
    )
  }
}

/**
 * Assert that exec was never called
 */
export function assertExecNeverCalled(): void {
  const execMock = vi.mocked(child_process.exec)

  if (execMock.mock.calls.length > 0) {
    throw new Error(
      `❌ Test Assertion Failed: exec was called ${execMock.mock.calls.length} time(s)\n` +
      `Calls: ${JSON.stringify(execMock.mock.calls, null, 2)}`
    )
  }
}

/**
 * Assert that execSync was never called
 */
export function assertExecSyncNeverCalled(): void {
  const execSyncMock = vi.mocked(child_process.execSync)

  if (execSyncMock.mock.calls.length > 0) {
    throw new Error(
      `❌ Test Assertion Failed: execSync was called ${execSyncMock.mock.calls.length} time(s)\n` +
      `Calls: ${JSON.stringify(execSyncMock.mock.calls, null, 2)}`
    )
  }
}

/**
 * Assert that no filesystem operations were called
 */
export function assertNoFileSystemOps(): void {
  const fsMethods = [
    'readFile', 'writeFile', 'mkdir', 'readdir', 'stat',
    'access', 'rm', 'unlink', 'rmdir', 'rename'
  ]

  for (const method of fsMethods) {
    const mock = (fs as any)[method]
    if (mock && typeof mock.mock !== 'undefined' && mock.mock.calls.length > 0) {
      throw new Error(
        `❌ Test Assertion Failed: fs.${method} was called ${mock.mock.calls.length} time(s)\n` +
        `Calls: ${JSON.stringify(mock.mock.calls, null, 2)}`
      )
    }
  }
}

/**
 * Create a test that explicitly verifies safeguards are working
 *
 * This test should FAIL if safeguards are not in place.
 *
 * @example
 * describe('Safeguards', () => {
 *   testSafeguardsWork()
 * })
 */
export function testSafeguardsWork() {
  return {
    'should throw on unmocked spawn': async () => {
      try {
        // Try to call spawn without mocking
        child_process.spawn('echo', ['test'])
        throw new Error('Safeguard did not trigger!')
      } catch (error) {
        if ((error as Error).message.includes('Unmocked spawn')) {
          // Good! Safeguard worked
          return
        }
        throw error
      }
    },

    'should throw on unmocked execSync': async () => {
      try {
        child_process.execSync('echo test')
        throw new Error('Safeguard did not trigger!')
      } catch (error) {
        if ((error as Error).message.includes('Unmocked execSync')) {
          // Good! Safeguard worked
          return
        }
        throw error
      }
    },

    'should throw on unmocked mkdir': async () => {
      try {
        await fs.mkdir('/test')
        throw new Error('Safeguard did not trigger!')
      } catch (error) {
        if ((error as Error).message.includes('Unmocked mkdir')) {
          // Good! Safeguard worked
          return
        }
        throw error
      }
    }
  }
}

/**
 * Type guard to check if error is a safeguard error
 */
export function isSafeguardError(error: unknown): boolean {
  return error instanceof Error &&
         (error.message.includes('UNIT TEST VIOLATION') ||
          error.message.includes('Unmocked'))
}

/**
 * Get a summary of all mock calls for debugging
 */
export function getMockCallSummary(): {
  spawn: number
  exec: number
  execSync: number
  fs: Record<string, number>
} {
  const fsMethods = ['readFile', 'writeFile', 'mkdir', 'readdir', 'stat']
  const fsCalls: Record<string, number> = {}

  for (const method of fsMethods) {
    const mock = (fs as any)[method]
    fsCalls[method] = mock && mock.mock ? mock.mock.calls.length : 0
  }

  return {
    spawn: vi.mocked(child_process.spawn).mock.calls.length,
    exec: vi.mocked(child_process.exec).mock.calls.length,
    execSync: vi.mocked(child_process.execSync).mock.calls.length,
    fs: fsCalls
  }
}
