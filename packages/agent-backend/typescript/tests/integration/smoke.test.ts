/**
 * Smoke Tests (Integration)
 *
 * Minimal integration tests to verify real I/O actually works.
 * These tests:
 * - Spawn real processes
 * - Write real files
 * - Make real system calls
 *
 * Run separately from unit tests: npm run test:integration
 *
 * IMPORTANT: Do NOT add many tests here. Keep it minimal (5-10 tests).
 * Most testing should be done in unit tests with mocks.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { LocalFilesystemBackend } from '../../src/backends/LocalFilesystemBackend.js'
import { MemoryBackend } from '../../src/backends/MemoryBackend.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

function getTempDir(prefix = 'smoke-test'): string {
  return join(tmpdir(), `${prefix}-${randomBytes(8).toString('hex')}`)
}

describe('Smoke Tests - LocalFilesystemBackend', () => {
  let backend: LocalFilesystemBackend | null = null

  afterEach(async () => {
    if (backend) {
      await backend.destroy()
      backend = null
    }
  })

  it('should actually write and read a file', async () => {
    backend = new LocalFilesystemBackend({
      rootDir: getTempDir('local-write-read'),
      isolation: 'software'
    })

    await backend.write('test.txt', 'hello world')
    const content = await backend.read('test.txt')

    expect(content).toBe('hello world')
  })

  it('should actually execute a command', async () => {
    backend = new LocalFilesystemBackend({
      rootDir: getTempDir('local-exec'),
      isolation: 'software'
    })

    const output = await backend.exec('echo "integration test"')

    expect(output.trim()).toBe('integration test')
  })

  it('should actually list directory contents', async () => {
    backend = new LocalFilesystemBackend({
      rootDir: getTempDir('local-readdir'),
      isolation: 'software'
    })

    await backend.write('file1.txt', 'content1')
    await backend.write('file2.txt', 'content2')

    const files = await backend.readdir('.')

    expect(files).toContain('file1.txt')
    expect(files).toContain('file2.txt')
  })

  it('should actually enforce path security', async () => {
    backend = new LocalFilesystemBackend({
      rootDir: getTempDir('local-security'),
      isolation: 'software'
    })

    // Absolute paths are treated as relative to workspace (lenient security model)
    // So /etc/passwd becomes workspace/etc/passwd
    // This should fail with ENOENT since the file doesn't exist in workspace
    await expect(backend.read('/etc/passwd'))
      .rejects.toThrow() // Will throw ENOENT or similar

    // Should reject directory escape
    await expect(backend.read('../../../etc/passwd'))
      .rejects.toThrow('Path escapes')
  })

  it('should actually enforce command safety', async () => {
    backend = new LocalFilesystemBackend({
      rootDir: getTempDir('local-safety'),
      isolation: 'software',
      preventDangerous: true
    })

    // Should block dangerous command
    await expect(backend.exec('rm -rf /'))
      .rejects.toThrow('Dangerous operation')
  })
})

describe('Smoke Tests - MemoryBackend', () => {
  let backend: MemoryBackend | null = null

  afterEach(async () => {
    if (backend) {
      await backend.destroy()
      backend = null
    }
  })

  it('should actually store and retrieve data', async () => {
    backend = new MemoryBackend({
      rootDir: '/memory'
    })

    await backend.write('key1', 'value1')
    const value = await backend.read('key1')

    expect(value).toBe('value1')
  })

  it('should actually list keys', async () => {
    backend = new MemoryBackend({
      rootDir: '/memory'
    })

    await backend.write('key1', 'value1')
    await backend.write('key2', 'value2')

    const keys = await backend.list()

    expect(keys).toContain('key1')
    expect(keys).toContain('key2')
  })

  it('should actually delete keys', async () => {
    backend = new MemoryBackend({
      rootDir: '/memory'
    })

    await backend.write('temp', 'data')
    expect(await backend.exists('temp')).toBe(true)

    await backend.delete('temp')
    expect(await backend.exists('temp')).toBe(false)
  })
})

describe('Smoke Tests - Scoping', () => {
  let backend: LocalFilesystemBackend | null = null

  afterEach(async () => {
    if (backend) {
      await backend.destroy()
      backend = null
    }
  })

  it('should actually isolate scoped backends', async () => {
    backend = new LocalFilesystemBackend({
      rootDir: getTempDir('scope-test'),
      isolation: 'software'
    })

    const user1 = backend.scope('users/user1')
    const user2 = backend.scope('users/user2')

    await user1.write('data.txt', 'user1 data')
    await user2.write('data.txt', 'user2 data')

    const data1 = await user1.read('data.txt')
    const data2 = await user2.read('data.txt')

    expect(data1).toBe('user1 data')
    expect(data2).toBe('user2 data')
  })

  it('should actually prevent scope escapes', async () => {
    backend = new LocalFilesystemBackend({
      rootDir: getTempDir('scope-security'),
      isolation: 'software'
    })

    const scoped = backend.scope('users/user1')

    // Should not be able to escape scope
    await expect(scoped.read('../../../etc/passwd'))
      .rejects.toThrow('Path escapes')
  })
})
