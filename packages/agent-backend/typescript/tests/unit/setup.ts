/**
 * Global test setup for unit tests
 *
 * This file runs BEFORE all tests to:
 * 1. Mock all I/O operations globally
 * 2. Add safeguards to prevent accidental process spawning
 * 3. Ensure tests fail fast if unmocked I/O is attempted
 */

import { vi, beforeEach, afterEach } from 'vitest'
import * as child_process from 'child_process'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'

// Track if we're in a unit test context
let isUnitTest = true

/**
 * Global mock for child_process to prevent ANY process spawning
 *
 * IMPORTANT: These throw errors if called without proper mocking.
 * This ensures tests CANNOT accidentally spawn real processes.
 */
vi.mock('child_process', () => {
  const throwUnmocked = (method: string, args?: any[]) => {
    const error = new Error(
      `❌ UNIT TEST VIOLATION: Unmocked ${method} call detected!\n\n` +
      `This means a unit test is trying to spawn a real process.\n` +
      `Arguments: ${args ? JSON.stringify(args, null, 2) : 'none'}\n\n` +
      `Fix: Ensure vi.mocked(child_process.${method}).mockReturnValue(...) is called BEFORE the code executes.\n\n` +
      `Example:\n` +
      `  const mockSpawn = createMockSpawn({ stdout: 'output', exitCode: 0 })\n` +
      `  vi.mocked(child_process.${method}).mockReturnValue(mockSpawn)\n`
    )
    // Make error very visible
    console.error('\n' + '='.repeat(80))
    console.error(error.message)
    console.error('='.repeat(80) + '\n')
    throw error
  }

  return {
    spawn: vi.fn((...args: any[]) => throwUnmocked('spawn', args)),
    exec: vi.fn((...args: any[]) => throwUnmocked('exec', args)),
    execSync: vi.fn((...args: any[]) => throwUnmocked('execSync', args)),
    execFile: vi.fn((...args: any[]) => throwUnmocked('execFile', args)),
    fork: vi.fn((...args: any[]) => throwUnmocked('fork', args))
  }
})

/**
 * Global mock for fs/promises to prevent ANY filesystem I/O
 */
vi.mock('fs/promises', () => {
  const throwUnmocked = (method: string) => {
    const error = new Error(
      `❌ UNIT TEST VIOLATION: Unmocked fs.${method} call detected!\n` +
      `This means a unit test is trying to perform real filesystem I/O.\n` +
      `Fix: Ensure vi.mocked(fs.${method}).mockResolvedValue(...) is called BEFORE the code executes.`
    )
    // Return rejected promise instead of throwing synchronously
    return Promise.reject(error)
  }

  return {
    readFile: vi.fn(() => throwUnmocked('readFile')),
    writeFile: vi.fn(() => throwUnmocked('writeFile')),
    mkdir: vi.fn(() => throwUnmocked('mkdir')),
    readdir: vi.fn(() => throwUnmocked('readdir')),
    stat: vi.fn(() => throwUnmocked('stat')),
    access: vi.fn(() => throwUnmocked('access')),
    rm: vi.fn(() => throwUnmocked('rm')),
    unlink: vi.fn(() => throwUnmocked('unlink')),
    rmdir: vi.fn(() => throwUnmocked('rmdir')),
    rename: vi.fn(() => throwUnmocked('rename')),
    copyFile: vi.fn(() => throwUnmocked('copyFile')),
    appendFile: vi.fn(() => throwUnmocked('appendFile')),
    chmod: vi.fn(() => throwUnmocked('chmod')),
    chown: vi.fn(() => throwUnmocked('chown'))
  }
})

/**
 * Global mock for fs (sync) to prevent ANY synchronous filesystem I/O
 */
vi.mock('fs', () => {
  const throwUnmocked = (method: string) => {
    throw new Error(
      `❌ UNIT TEST VIOLATION: Unmocked fs.${method} (sync) call detected!\n` +
      `This means a unit test is trying to perform real synchronous filesystem I/O.\n` +
      `Fix: Ensure vi.mocked(fsSync.${method}).mockReturnValue(...) is called BEFORE the code executes.`
    )
  }

  return {
    mkdirSync: vi.fn(() => throwUnmocked('mkdirSync')),
    readFileSync: vi.fn(() => throwUnmocked('readFileSync')),
    writeFileSync: vi.fn(() => throwUnmocked('writeFileSync')),
    existsSync: vi.fn(() => throwUnmocked('existsSync')),
    statSync: vi.fn(() => throwUnmocked('statSync')),
    readdirSync: vi.fn(() => throwUnmocked('readdirSync')),
    unlinkSync: vi.fn(() => throwUnmocked('unlinkSync')),
    rmdirSync: vi.fn(() => throwUnmocked('rmdirSync')),
    renameSync: vi.fn(() => throwUnmocked('renameSync')),
    copyFileSync: vi.fn(() => throwUnmocked('copyFileSync')),
    accessSync: vi.fn(() => throwUnmocked('accessSync')),
    chmodSync: vi.fn(() => throwUnmocked('chmodSync')),
    chownSync: vi.fn(() => throwUnmocked('chownSync'))
  }
})

/**
 * Global mock for ssh2 to prevent ANY SSH connections
 */
vi.mock('ssh2', () => {
  return {
    Client: vi.fn(() => {
      throw new Error(
        `❌ UNIT TEST VIOLATION: Unmocked SSH Client instantiation detected!\n` +
        `This means a unit test is trying to create a real SSH connection.\n` +
        `Fix: Ensure vi.mocked(Client).mockImplementation(...) is called BEFORE the code executes.`
      )
    })
  }
})

/**
 * Reset all mocks before each test to ensure clean state
 */
beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Verify no unmocked I/O happened after each test
 */
afterEach(() => {
  // This will be caught by the throw statements above if any unmocked I/O was attempted
})

console.log('✅ Unit test safeguards enabled: All I/O operations are mocked globally')
