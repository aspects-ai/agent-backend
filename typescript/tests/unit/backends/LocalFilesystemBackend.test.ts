import * as child_process from 'child_process'
import * as fsSync from 'fs'
import * as fs from 'fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalFilesystemBackend } from '../../../src/backends/LocalFilesystemBackend.js'
import { DangerousOperationError } from '../../../src/types.js'
import { createMockSpawn, TEST_DATA } from '../helpers/mockFactories.js'

describe('LocalFilesystemBackend (Unit Tests)', () => {
  let backend: LocalFilesystemBackend

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock mkdirSync for constructor's ensureRootDir()
    vi.mocked(fsSync.mkdirSync).mockReturnValue(undefined)

    backend = new LocalFilesystemBackend({
      rootDir: '/test/workspace',
      isolation: 'software', // Explicit to avoid execSync in detectIsolation
      shell: 'bash',         // Explicit to avoid execSync in detectShell
      preventDangerous: true
      // validateUtils: false (default) to avoid execSync
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Configuration & Initialization', () => {
    it('should create backend with correct config', () => {
      expect(backend.type).toBe('local-filesystem')
      expect(backend.rootDir).toBe('/test/workspace')
      expect(backend.status).toBe('connected')
    })

    it('should accept explicit shell setting', () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      const defaultBackend = new LocalFilesystemBackend({
        rootDir: '/test',
        shell: 'sh', // Explicit to avoid execSync
        isolation: 'software'
      })
      expect(defaultBackend).toBeDefined()
    })

    it('should accept bwrap isolation mode', () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      const bwrapBackend = new LocalFilesystemBackend({
        rootDir: '/test',
        shell: 'bash',
        isolation: 'bwrap' // Note: In unit tests, this won't actually use bwrap
      })
      expect(bwrapBackend).toBeDefined()
    })

    it('should accept preventDangerous setting', () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      const unsafeBackend = new LocalFilesystemBackend({
        rootDir: '/test',
        shell: 'bash',
        isolation: 'software',
        preventDangerous: false
      })
      expect(unsafeBackend).toBeDefined()
    })
  })

  describe('Path Validation (Security Critical)', () => {
    it('should treat absolute paths as relative to workspace', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('content')

      await backend.read('/etc/passwd')

      // Should read from /test/workspace/etc/passwd, not /etc/passwd
      expect(fs.readFile).toHaveBeenCalledWith(
        '/test/workspace/etc/passwd',
        'utf8'
      )
    })

    it('should reject parent directory escapes', async () => {
      const escapePaths = [
        '../../../etc/passwd',
        '../../etc/passwd',
        '../etc/passwd'
      ]

      for (const path of escapePaths) {
        await expect(backend.read(path))
          .rejects.toThrow(/Path escapes/)

        expect(fs.readFile).not.toHaveBeenCalled()
        vi.clearAllMocks()
      }
    })

    it('should reject complex escape sequences', async () => {
      const complexEscapes = [
        'foo/../../bar/../../../etc/passwd',
        'a/b/c/../../../../etc/passwd',
        'valid/../../../escape'
      ]

      for (const path of complexEscapes) {
        await expect(backend.read(path))
          .rejects.toThrow()

        expect(fs.readFile).not.toHaveBeenCalled()
        vi.clearAllMocks()
      }
    })

    it('should treat tilde as literal character (no expansion)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('content')

      await backend.read('~/secret.txt')

      // Tilde is treated as literal character, not expanded to home directory
      expect(fs.readFile).toHaveBeenCalledWith(
        '/test/workspace/~/secret.txt',
        'utf8'
      )
    })

    it('should allow safe relative paths', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('content')

      const safePaths = [
        'file.txt',
        'subdir/file.txt',
        'deeply/nested/path.txt'
      ]

      for (const path of safePaths) {
        await backend.read(path)
        expect(fs.readFile).toHaveBeenCalled()
        vi.clearAllMocks()
      }
    })

    it('should normalize . and ./ correctly', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('content')

      await backend.read('./file.txt')
      expect(fs.readFile).toHaveBeenCalledWith(
        '/test/workspace/file.txt',
        'utf8'
      )

      vi.clearAllMocks()

      await backend.read('.')
      // Reading '.' resolves to workspace root
      expect(fs.readFile).toHaveBeenCalledWith(
        '/test/workspace',
        'utf8'
      )
    })

    it('should handle edge cases', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('EISDIR'))

      // Empty path resolves to workspace root
      await backend.read('').catch(() => {})
      expect(fs.readFile).toHaveBeenCalled()
    })
  })

  describe('Command Safety (Dangerous Operation Detection)', () => {
    it('should block dangerous commands BEFORE spawning', async () => {
      for (const cmd of TEST_DATA.dangerousCommands) {
        await expect(backend.exec(cmd))
          .rejects.toThrow(DangerousOperationError)

        // Critical: verify spawn was NEVER called
        expect(child_process.spawn).not.toHaveBeenCalled()
        vi.clearAllMocks()
      }
    })

    it('should reject empty commands', async () => {
      await expect(backend.exec(''))
        .rejects.toThrow('Command cannot be empty')

      expect(child_process.spawn).not.toHaveBeenCalled()
    })

    it('should reject whitespace-only commands', async () => {
      await expect(backend.exec('   '))
        .rejects.toThrow('Command cannot be empty')

      expect(child_process.spawn).not.toHaveBeenCalled()
    })

    it('should allow safe commands when preventDangerous=true', async () => {
      const mockSpawn = createMockSpawn({ stdout: 'output', exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await backend.exec('echo hello')
      expect(child_process.spawn).toHaveBeenCalledTimes(1)
    })

    it('should allow dangerous commands when preventDangerous=false', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      const unsafeBackend = new LocalFilesystemBackend({
        rootDir: '/test/workspace',
        shell: 'bash',
        isolation: 'software',
        preventDangerous: false
      })

      const mockSpawn = createMockSpawn({ stdout: '', exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      // Should NOT throw - dangerous commands are allowed
      await unsafeBackend.exec('rm -rf /')
      expect(child_process.spawn).toHaveBeenCalledTimes(1)
    })

    it('should call onDangerousOperation callback if provided', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      const onDangerous = vi.fn()
      const callbackBackend = new LocalFilesystemBackend({
        rootDir: '/test',
        shell: 'bash',
        isolation: 'software',
        preventDangerous: true,
        onDangerousOperation: onDangerous
      })

      // When callback is provided, it returns '' instead of throwing
      const result = await callbackBackend.exec('rm -rf /')

      expect(result).toBe('')
      expect(onDangerous).toHaveBeenCalledWith('rm -rf /')
    })
  })

  describe('Command Execution - Software Isolation', () => {
    it('should call spawn with correct shell and command', async () => {
      const mockSpawn = createMockSpawn({ stdout: 'hello', exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await backend.exec('echo hello')

      expect(child_process.spawn).toHaveBeenCalledWith(
        expect.stringMatching(/bash|sh/),
        ['-c', 'echo hello'],
        expect.objectContaining({
          cwd: '/test/workspace',
          stdio: ['pipe', 'pipe', 'pipe']
        })
      )
    })

    it('should set correct working directory', async () => {
      const mockSpawn = createMockSpawn({ stdout: '', exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await backend.exec('pwd')

      const spawnCall = vi.mocked(child_process.spawn).mock.calls[0]
      expect(spawnCall[2]?.cwd).toBe('/test/workspace')
    })

    it('should merge custom environment variables', async () => {
      const mockSpawn = createMockSpawn({ stdout: '', exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await backend.exec('env', { env: { CUSTOM_VAR: 'value', TEST: '123' } })

      const spawnCall = vi.mocked(child_process.spawn).mock.calls[0]
      expect(spawnCall[2]?.env).toEqual(
        expect.objectContaining({
          CUSTOM_VAR: 'value',
          TEST: '123'
        })
      )
    })

    it('should return stdout as string (default encoding)', async () => {
      const mockSpawn = createMockSpawn({ stdout: 'output\n', exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      const result = await backend.exec('echo output')

      expect(result).toBe('output')
    })

    it('should return stdout as buffer when encoding=buffer', async () => {
      const mockSpawn = createMockSpawn({ stdout: Buffer.from([1, 2, 3]), exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      const result = await backend.exec('command', { encoding: 'buffer' })

      expect(Buffer.isBuffer(result)).toBe(true)
      expect(result).toEqual(Buffer.from([1, 2, 3]))
    })

    it('should throw on non-zero exit code', async () => {
      const mockSpawn = createMockSpawn({
        stdout: '',
        stderr: 'command not found',
        exitCode: 127
      })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await expect(backend.exec('nonexistent-command'))
        .rejects.toThrow('Command execution failed with exit code 127')
    })

    it('should include stderr in error message', async () => {
      const mockSpawn = createMockSpawn({
        stdout: '',
        stderr: 'Error: file not found',
        exitCode: 1
      })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await expect(backend.exec('cat nonexistent'))
        .rejects.toThrow('Error: file not found')
    })

    it('should handle spawn errors (ENOENT)', async () => {
      const mockSpawn = createMockSpawn({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await expect(backend.exec('command')).rejects.toThrow('ENOENT')
    })

    it('should respect maxOutputLength setting', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      const longOutput = 'x'.repeat(10000)
      const mockSpawn = createMockSpawn({ stdout: longOutput, exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      const limitedBackend = new LocalFilesystemBackend({
        rootDir: '/test',
        shell: 'bash',
        isolation: 'software',
        maxOutputLength: 100
      })

      const result = await limitedBackend.exec('command')

      expect(result.length).toBeLessThan(longOutput.length)
      expect(result).toContain('Output truncated')
    })
  })

  describe('Command Execution - Bwrap Isolation', () => {
    beforeEach(() => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      backend = new LocalFilesystemBackend({
        rootDir: '/test/workspace',
        shell: 'bash',
        isolation: 'bwrap',
        preventDangerous: true
      })
    })

    it('should construct correct bwrap arguments', async () => {
      const mockSpawn = createMockSpawn({ stdout: '', exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await backend.exec('echo test')

      expect(child_process.spawn).toHaveBeenCalledWith(
        'bwrap',
        expect.arrayContaining([
          '--bind', '/test/workspace', '/tmp/agentbe-workspace',
          '--chdir', '/tmp/agentbe-workspace',
          '--unshare-all',
          '--share-net',
          '--die-with-parent',
          '--',
          expect.stringMatching(/bash|sh/),
          '-c',
          'echo test'
        ]),
        expect.any(Object)
      )
    })

    it('should set correct sandbox working directory', async () => {
      const mockSpawn = createMockSpawn({ stdout: '', exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await backend.exec('pwd', { cwd: '/test/workspace/subdir' })

      const bwrapArgs = vi.mocked(child_process.spawn).mock.calls[0][1] as string[]
      const chdirIndex = bwrapArgs.indexOf('--chdir')

      expect(chdirIndex).toBeGreaterThan(-1)
      expect(bwrapArgs[chdirIndex + 1]).toBe('/tmp/agentbe-workspace/subdir')
    })

    it('should include system directories as read-only', async () => {
      const mockSpawn = createMockSpawn({ stdout: '', exitCode: 0 })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await backend.exec('ls')

      const bwrapArgs = vi.mocked(child_process.spawn).mock.calls[0][1] as string[]

      expect(bwrapArgs).toContain('--ro-bind')
      expect(bwrapArgs).toContain('/usr')
      expect(bwrapArgs).toContain('/bin')
    })

    it('should handle bwrap not installed error', async () => {
      const enoentError = Object.assign(new Error('spawn bwrap ENOENT'), { code: 'ENOENT' })
      const mockSpawn = createMockSpawn({ error: enoentError })
      vi.mocked(child_process.spawn).mockReturnValue(mockSpawn as any)

      await expect(backend.exec('command'))
        .rejects.toThrow(/bwrap.*(not found|not installed)/i)
    })
  })

  describe('File Operations', () => {
    it('should call writeFile with correct path and content (string)', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      await backend.write('file.txt', 'content')

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/workspace/file.txt',
        'content'
      )
    })

    it('should call writeFile with buffer content', async () => {
      const buffer = Buffer.from([1, 2, 3])
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      await backend.write('image.png', buffer)

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/workspace/image.png',
        buffer
      )
    })

    it('should create parent directories before writing', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      await backend.write('subdir/nested/file.txt', 'content')

      expect(fs.mkdir).toHaveBeenCalledWith(
        '/test/workspace/subdir/nested',
        { recursive: true }
      )
      expect(fs.writeFile).toHaveBeenCalled()
    })

    it('should call readFile with correct path (text)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('content')

      const result = await backend.read('file.txt')

      expect(fs.readFile).toHaveBeenCalledWith(
        '/test/workspace/file.txt',
        'utf8'
      )
      expect(result).toBe('content')
    })

    it('should handle binary reads', async () => {
      const buffer = Buffer.from([1, 2, 3])
      vi.mocked(fs.readFile).mockResolvedValue(buffer)

      const result = await backend.read('image.png', { encoding: 'buffer' })

      expect(fs.readFile).toHaveBeenCalledWith(
        '/test/workspace/image.png'
      )
      expect(result).toBe(buffer)
    })

    it('should call mkdir with correct path', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      await backend.mkdir('subdir')

      expect(fs.mkdir).toHaveBeenCalledWith(
        '/test/workspace/subdir',
        expect.any(Object)
      )
    })

    it('should call mkdir with recursive option', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)

      await backend.mkdir('deep/nested/dir', { recursive: true })

      expect(fs.mkdir).toHaveBeenCalledWith(
        '/test/workspace/deep/nested/dir',
        { recursive: true }
      )
    })

    it('should call readdir with correct path', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['file1.txt', 'file2.txt'] as any)

      const files = await backend.readdir('subdir')

      expect(fs.readdir).toHaveBeenCalledWith('/test/workspace/subdir')
      expect(files).toEqual(['file1.txt', 'file2.txt'])
    })

    it('should call readdirWithStats and return entries with stats', async () => {
      const mockDirents = [
        { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
        { name: 'subdir', isDirectory: () => true, isFile: () => false },
      ]
      const mockStats1 = {
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
        mtime: new Date('2024-01-01'),
      }
      const mockStats2 = {
        isFile: () => false,
        isDirectory: () => true,
        size: 4096,
        mtime: new Date('2024-01-02'),
      }

      vi.mocked(fs.readdir).mockResolvedValue(mockDirents as any)
      vi.mocked(fs.stat)
        .mockResolvedValueOnce(mockStats1 as any)
        .mockResolvedValueOnce(mockStats2 as any)

      const entries = await backend.readdirWithStats('mydir')

      expect(fs.readdir).toHaveBeenCalledWith('/test/workspace/mydir', { withFileTypes: true })
      expect(fs.stat).toHaveBeenCalledWith('/test/workspace/mydir/file1.txt')
      expect(fs.stat).toHaveBeenCalledWith('/test/workspace/mydir/subdir')
      expect(entries).toHaveLength(2)
      expect(entries[0].name).toBe('file1.txt')
      expect(entries[0].stats.size).toBe(100)
      expect(entries[1].name).toBe('subdir')
      expect(entries[1].stats.isDirectory()).toBe(true)
    })

    it('should skip entries that fail to stat in readdirWithStats', async () => {
      const mockDirents = [
        { name: 'file1.txt', isDirectory: () => false },
        { name: 'broken.txt', isDirectory: () => false },
      ]
      const mockStats = { isFile: () => true, size: 100 }

      vi.mocked(fs.readdir).mockResolvedValue(mockDirents as any)
      vi.mocked(fs.stat)
        .mockResolvedValueOnce(mockStats as any)
        .mockRejectedValueOnce(new Error('EACCES'))

      const entries = await backend.readdirWithStats('mydir')

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('file1.txt')
    })

    it('should call stat with correct path', async () => {
      const mockStats = {
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
        mtime: new Date()
      } as any
      vi.mocked(fs.stat).mockResolvedValue(mockStats)

      const stats = await backend.stat('file.txt')

      expect(fs.stat).toHaveBeenCalledWith('/test/workspace/file.txt')
      expect(stats).toBe(mockStats)
    })

    it('should check file existence', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined)

      const exists = await backend.exists('file.txt')

      expect(fs.access).toHaveBeenCalledWith('/test/workspace/file.txt')
      expect(exists).toBe(true)
    })

    it('should return false when file does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'))

      const exists = await backend.exists('nonexistent.txt')

      expect(exists).toBe(false)
    })

    it('should touch file (create empty)', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      await backend.touch('empty.txt')

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/workspace/empty.txt',
        ''
      )
    })
  })

  describe('Scoping', () => {
    it('should create scoped backend with correct path', () => {
      const scoped = backend.scope('users/user1')

      expect(scoped.rootDir).toContain('users/user1')
      expect(scoped.type).toBe(backend.type)
    })

    it('should reject scope paths that escape parent', () => {
      expect(() => backend.scope('../../../etc')).toThrow('Path escapes')
      expect(() => backend.scope('../../etc')).toThrow('Path escapes')
    })

    it('should allow valid scope paths', () => {
      expect(() => backend.scope('valid/scope')).not.toThrow()
      expect(() => backend.scope('deeply/nested/scope')).not.toThrow()
    })

    it('should list active scopes', async () => {
      // Create some scopes
      const scope1 = backend.scope('users/user1')
      const scope2 = backend.scope('projects/proj1')

      const activeScopes = await backend.listActiveScopes()

      expect(activeScopes).toContain('users/user1')
      expect(activeScopes).toContain('projects/proj1')
      expect(activeScopes).toHaveLength(2)
    })

    it('should remove scope from active list when destroyed', async () => {
      const scope1 = backend.scope('users/user1')
      const scope2 = backend.scope('projects/proj1')

      // Destroy one scope
      await scope1.destroy()

      const activeScopes = await backend.listActiveScopes()
      expect(activeScopes).not.toContain('users/user1')
      expect(activeScopes).toContain('projects/proj1')
      expect(activeScopes).toHaveLength(1)
    })
  })

  describe('Type and Connection Properties', () => {
    it('should have type "local-filesystem"', () => {
      expect(backend.type).toBe('local-filesystem')
    })

    it('should be connected by default', () => {
      expect(backend.status).toBe('connected')
    })

    it('should have rootDir property', () => {
      expect(backend.rootDir).toBe('/test/workspace')
    })
  })

  describe('Connection Status', () => {
    it('should start with CONNECTED status', () => {
      expect(backend.status).toBe('connected')
    })

    it('should transition to DESTROYED after destroy()', async () => {
      await backend.destroy()
      expect(backend.status).toBe('destroyed')
    })

    it('should notify listeners on destroy', async () => {
      const listener = vi.fn()
      backend.onStatusChange(listener)

      await backend.destroy()

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        from: 'connected',
        to: 'destroyed',
      }))
    })

    it('should support unsubscribe', async () => {
      const listener = vi.fn()
      const unsub = backend.onStatusChange(listener)
      unsub()

      await backend.destroy()

      expect(listener).not.toHaveBeenCalled()
    })
  })

  // Note: getMCPTransport scopePath handling is tested in tests/unit/mcp/transport.test.ts

  describe('Cleanup', () => {
    it('should destroy without error', async () => {
      await expect(backend.destroy()).resolves.toBeUndefined()
    })
  })

  describe('Closeable Tracking', () => {
    it('should close all tracked closeables on destroy', async () => {
      const closeable1 = { close: vi.fn().mockResolvedValue(undefined) }
      const closeable2 = { close: vi.fn().mockResolvedValue(undefined) }

      backend.trackCloseable(closeable1)
      backend.trackCloseable(closeable2)

      await backend.destroy()

      expect(closeable1.close).toHaveBeenCalledTimes(1)
      expect(closeable2.close).toHaveBeenCalledTimes(1)
      expect(backend.status).toBe('destroyed')
    })

    it('should tolerate errors from closeable.close()', async () => {
      const closeable1 = { close: vi.fn().mockRejectedValue(new Error('close failed')) }
      const closeable2 = { close: vi.fn().mockResolvedValue(undefined) }

      backend.trackCloseable(closeable1)
      backend.trackCloseable(closeable2)

      await expect(backend.destroy()).resolves.toBeUndefined()

      expect(closeable1.close).toHaveBeenCalledTimes(1)
      expect(closeable2.close).toHaveBeenCalledTimes(1)
    })

    it('should clear closeables set after destroy', async () => {
      const closeable = { close: vi.fn().mockResolvedValue(undefined) }
      backend.trackCloseable(closeable)

      await backend.destroy()
      expect(closeable.close).toHaveBeenCalledTimes(1)
    })

    it('should handle destroy with no tracked closeables', async () => {
      await expect(backend.destroy()).resolves.toBeUndefined()
      expect(backend.status).toBe('destroyed')
    })
  })
})
