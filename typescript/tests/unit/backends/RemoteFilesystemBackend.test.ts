import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RemoteFilesystemBackend } from '../../../src/backends/RemoteFilesystemBackend.js'
import { Client } from 'ssh2'
import { DangerousOperationError } from '../../../src/types.js'
import { EventEmitter } from 'events'

// Mock SSH2
vi.mock('ssh2', () => ({
  Client: vi.fn()
}))

// Test constants
const TEST_ROOT_DIR = '/remote/workspace'

// Base config for all tests - uses conventional SSH transport for mocking
const BASE_SSH_CONFIG = {
  transport: 'ssh' as const,  // Use conventional SSH for unit tests (mocked)
}

/**
 * Build the expected full command string that RemoteFilesystemBackend.exec() generates.
 * This mirrors the logic in buildFullCommand() for test assertions.
 */
function expectedCommand(command: string, cwd: string = TEST_ROOT_DIR, env?: Record<string, string>): string {
  const envPrefix = env
    ? Object.entries(env).map(([k, v]) => `${k}='${v}'`).join(' ') + ' '
    : ''
  if (cwd && cwd !== '/') {
    return `HOME='${cwd}' ${envPrefix}cd "${cwd}" && ${command}`
  }
  return `${envPrefix}${command}`
}

// Helper to create a mock SSH client with configurable behavior
function createMockSSHClient(options: {
  connectBehavior?: 'success' | 'error' | 'timeout'
  execResults?: Map<string, { stdout: string, stderr?: string, exitCode: number }>
  sftpMethods?: Partial<{
    readFile: (path: string, encoding: string | undefined, callback: Function) => void
    writeFile: (path: string, content: any, callback: Function) => void
    readdir: (path: string, callback: Function) => void
    mkdir: (path: string, callback: Function) => void
    stat: (path: string, callback: Function) => void
    rename: (oldPath: string, newPath: string, callback: Function) => void
    end: () => void
  }>
} = {}) {
  const mockClient = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
    sftp: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }

  mockClient.connect = vi.fn(() => {
    if (options.connectBehavior === 'error') {
      setTimeout(() => mockClient.emit('error', new Error('Connection refused')), 0)
    } else if (options.connectBehavior === 'timeout') {
      // Don't emit anything - simulates timeout
    } else {
      setTimeout(() => mockClient.emit('ready'), 0)
    }
  })

  mockClient.exec = vi.fn((command: string, callback: Function) => {
    const mockStream = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    mockStream.stderr = new EventEmitter()

    const result = options.execResults?.get(command) || { stdout: '', stderr: '', exitCode: 0 }

    setTimeout(() => {
      if (result.stdout) {
        mockStream.emit('data', Buffer.from(result.stdout))
      }
      if (result.stderr) {
        mockStream.stderr.emit('data', Buffer.from(result.stderr))
      }
      mockStream.emit('close', result.exitCode)
    }, 0)

    callback(null, mockStream)
  })

  const defaultSftpMethods = {
    readFile: (_path: string, _encoding: string | undefined, callback: Function) => {
      callback(null, 'file content')
    },
    writeFile: (_path: string, _content: any, callback: Function) => {
      callback(null)
    },
    readdir: (_path: string, callback: Function) => {
      callback(null, [{ filename: 'file1.txt' }, { filename: 'file2.txt' }])
    },
    mkdir: (_path: string, callback: Function) => {
      callback(null)
    },
    stat: (_path: string, callback: Function) => {
      callback(null, {
        isDirectory: () => false,
        isFile: () => true,
        size: 100,
        mtime: Date.now() / 1000
      })
    },
    rename: (_oldPath: string, _newPath: string, callback: Function) => {
      callback(null)
    },
    end: vi.fn()
  }

  const sftpMethods = { ...defaultSftpMethods, ...options.sftpMethods }

  mockClient.sftp = vi.fn((callback: Function) => {
    callback(null, sftpMethods)
  })

  mockClient.end = vi.fn()

  return mockClient
}

describe('RemoteFilesystemBackend (Unit Tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Configuration & Initialization', () => {
    it('should create backend with correct config', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: {
            username: 'testuser',
            password: 'testpass'
          }
        }
      })

      expect(backend.type).toBe('remote-filesystem')
      expect(backend.rootDir).toBe(TEST_ROOT_DIR)
      expect(backend.connected).toBe(false)
    })

    it('should validate required config fields', () => {
      expect(() => new RemoteFilesystemBackend({
        rootDir: '/tmp',
        // @ts-expect-error - testing validation
        host: undefined,
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })).toThrow()
    })

    it('should accept password authentication', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const passwordBackend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(passwordBackend).toBeDefined()
    })

    it('should accept key-based authentication', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const keyBackend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'key',
          credentials: {
            username: 'user',
            privateKey: '-----BEGIN RSA PRIVATE KEY-----\n...'
          }
        }
      })

      expect(keyBackend).toBeDefined()
    })

    it('should use default port 22 when not specified', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const defaultPortBackend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(defaultPortBackend).toBeDefined()
    })

    it('should accept custom port', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const customPortBackend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: '/tmp',
        host: 'example.com',
        sshPort: 2222,
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(customPortBackend).toBeDefined()
    })

    it('should accept custom timeout configuration', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        },
        operationTimeoutMs: 60000,
        keepaliveIntervalMs: 15000,
        keepaliveCountMax: 5
      })

      expect(backend).toBeDefined()
    })
  })

  describe('Type and Properties', () => {
    it('should have type "remote-filesystem"', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(backend.type).toBe('remote-filesystem')
    })

    it('should report not connected initially', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: '/tmp',
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(backend.connected).toBe(false)
    })

    it('should have rootDir property', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(backend.rootDir).toBe(TEST_ROOT_DIR)
    })
  })

  describe('SSH Connection', () => {
    it('should establish connection on first operation', async () => {
      const mockClient = createMockSSHClient({
        execResults: new Map([[expectedCommand('echo test'), { stdout: 'test', exitCode: 0 }]])
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(backend.connected).toBe(false)

      await backend.exec('echo test')

      expect(mockClient.connect).toHaveBeenCalled()
    })

    it('should handle connection errors', async () => {
      const mockClient = createMockSSHClient({ connectBehavior: 'error' })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await expect(backend.exec('echo test')).rejects.toThrow('SSH connection failed')
    })

    it('should reuse existing connection', async () => {
      const mockClient = createMockSSHClient({
        execResults: new Map([
          [expectedCommand('echo test1'), { stdout: 'test1', exitCode: 0 }],
          [expectedCommand('echo test2'), { stdout: 'test2', exitCode: 0 }]
        ])
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await backend.exec('echo test1')
      await backend.exec('echo test2')

      // Should only connect once
      expect(mockClient.connect).toHaveBeenCalledTimes(1)
    })
  })

  describe('Command Execution', () => {
    it('should execute command and return output', async () => {
      const mockClient = createMockSSHClient({
        execResults: new Map([[expectedCommand('echo hello'), { stdout: 'hello\n', exitCode: 0 }]])
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      const result = await backend.exec('echo hello')
      expect(result).toBe('hello')
    })

    it('should reject empty commands', async () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await expect(backend.exec('')).rejects.toThrow('Command cannot be empty')
    })

    it('should reject whitespace-only commands', async () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await expect(backend.exec('   ')).rejects.toThrow('Command cannot be empty')
    })

    it('should handle command failures with non-zero exit code', async () => {
      const mockClient = createMockSSHClient({
        execResults: new Map([[expectedCommand('false'), { stdout: '', stderr: 'error', exitCode: 1 }]])
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await expect(backend.exec('false')).rejects.toThrow('Command failed with exit code 1')
    })
  })

  describe('Command Safety', () => {
    it('should block dangerous commands when preventDangerous=true', async () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        preventDangerous: true,
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await expect(backend.exec('rm -rf /')).rejects.toThrow(DangerousOperationError)
    })

    it('should allow dangerous commands when preventDangerous=false', async () => {
      const mockClient = createMockSSHClient({
        execResults: new Map([[expectedCommand('rm -rf /'), { stdout: '', exitCode: 0 }]])
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        preventDangerous: false,
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      // Should not throw
      await backend.exec('rm -rf /')
      expect(mockClient.exec).toHaveBeenCalled()
    })

    it('should call onDangerousOperation callback if provided', async () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const onDangerous = vi.fn()
      const backend = new RemoteFilesystemBackend({
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        preventDangerous: true,
        onDangerousOperation: onDangerous,
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      const result = await backend.exec('rm -rf /')

      expect(result).toBe('')
      expect(onDangerous).toHaveBeenCalledWith('rm -rf /')
    })
  })

  describe('File Operations', () => {
    it('should read file contents', async () => {
      const mockClient = createMockSSHClient({
        sftpMethods: {
          readFile: (_path, _encoding, callback) => callback(null, 'file content')
        }
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      const content = await backend.read('test.txt')
      expect(content).toBe('file content')
    })

    it('should write file contents', async () => {
      const writtenContent: { path: string, content: string }[] = []
      const mockClient = createMockSSHClient({
        execResults: new Map([[expectedCommand(`mkdir -p "${TEST_ROOT_DIR}"`), { stdout: '', exitCode: 0 }]]),
        sftpMethods: {
          writeFile: (path, content, callback) => {
            writtenContent.push({ path, content })
            callback(null)
          }
        }
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await backend.write('test.txt', 'new content')
      expect(writtenContent).toContainEqual({
        path: `${TEST_ROOT_DIR}/test.txt`,
        content: 'new content'
      })
    })

    it('should read directory contents', async () => {
      const mockClient = createMockSSHClient({
        sftpMethods: {
          readdir: (_path, callback) => callback(null, [
            { filename: 'file1.txt' },
            { filename: 'file2.txt' },
            { filename: 'subdir' }
          ])
        }
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      const files = await backend.readdir('.')
      expect(files).toEqual(['file1.txt', 'file2.txt', 'subdir'])
    })

    it('should read directory contents with stats (readdirWithStats)', async () => {
      const mockClient = createMockSSHClient({
        sftpMethods: {
          readdir: (_path, callback) => callback(null, [
            {
              filename: 'file1.txt',
              attrs: {
                isDirectory: () => false,
                isFile: () => true,
                size: 100,
                mtime: 1704067200
              }
            },
            {
              filename: 'subdir',
              attrs: {
                isDirectory: () => true,
                isFile: () => false,
                size: 4096,
                mtime: 1704153600
              }
            }
          ])
        }
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      const entries = await backend.readdirWithStats('.')
      expect(entries).toHaveLength(2)
      expect(entries[0].name).toBe('file1.txt')
      expect(entries[0].stats.size).toBe(100)
      expect(entries[1].name).toBe('subdir')
      expect(entries[1].stats.isDirectory()).toBe(true)
    })

    it('should check file existence', async () => {
      const mockClient = createMockSSHClient({
        sftpMethods: {
          stat: (path, callback) => {
            if (path === `${TEST_ROOT_DIR}/exists.txt`) {
              callback(null, { isFile: () => true })
            } else {
              callback(new Error('ENOENT'))
            }
          }
        }
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(await backend.exists('exists.txt')).toBe(true)
      expect(await backend.exists('nonexistent.txt')).toBe(false)
    })

    it('should get file stats', async () => {
      const mockStats = {
        isDirectory: () => false,
        isFile: () => true,
        size: 1234,
        mtime: 1234567890
      }
      const mockClient = createMockSSHClient({
        sftpMethods: {
          stat: (_path, callback) => callback(null, mockStats)
        }
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      const stats = await backend.stat('test.txt')
      expect(stats.size).toBe(1234)
      expect(stats.isFile()).toBe(true)
    })

    it('should create directories', async () => {
      const createdDirs: string[] = []
      const mockClient = createMockSSHClient({
        sftpMethods: {
          mkdir: (path, callback) => {
            createdDirs.push(path)
            callback(null)
          }
        }
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await backend.mkdir('newdir')
      expect(createdDirs).toContain(`${TEST_ROOT_DIR}/newdir`)
    })

    it('should create directories recursively', async () => {
      const mockClient = createMockSSHClient({
        execResults: new Map([[expectedCommand(`mkdir -p "${TEST_ROOT_DIR}/deep/nested/dir"`), { stdout: '', exitCode: 0 }]])
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await backend.mkdir('deep/nested/dir', { recursive: true })
      expect(mockClient.exec).toHaveBeenCalled()
    })

    it('should touch (create empty) files', async () => {
      const writtenContent: { path: string, content: string }[] = []
      const mockClient = createMockSSHClient({
        execResults: new Map([[expectedCommand(`mkdir -p "${TEST_ROOT_DIR}"`), { stdout: '', exitCode: 0 }]]),
        sftpMethods: {
          writeFile: (path, content, callback) => {
            writtenContent.push({ path, content })
            callback(null)
          }
        }
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await backend.touch('empty.txt')
      expect(writtenContent).toContainEqual({
        path: `${TEST_ROOT_DIR}/empty.txt`,
        content: ''
      })
    })
  })

  describe('Path Validation', () => {
    it('should treat absolute paths as relative to rootDir', async () => {
      const readPaths: string[] = []
      const mockClient = createMockSSHClient({
        sftpMethods: {
          readFile: (path, _encoding, callback) => {
            readPaths.push(path)
            callback(null, 'content')
          }
        }
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await backend.read('/etc/passwd')
      expect(readPaths).toContain(`${TEST_ROOT_DIR}/etc/passwd`)
    })

    it('should reject path escape attempts', async () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await expect(backend.read('../../../etc/passwd')).rejects.toThrow(/Path escapes/)
    })
  })

  describe('Scoping', () => {
    it('should create scoped backend with correct path', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      const scoped = backend.scope('users/user1')

      expect(scoped.rootDir).toContain('users/user1')
      expect(scoped.type).toBe('remote-filesystem')
    })

    it('should reject scope escape attempts', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(() => backend.scope('../../../etc')).toThrow(/Path escapes/)
    })

    it('should allow valid scope paths', () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      expect(() => backend.scope('valid/scope')).not.toThrow()
    })
  })

  describe('Cleanup', () => {
    it('should close SSH connection on destroy', async () => {
      const mockClient = createMockSSHClient({
        execResults: new Map([[expectedCommand('echo test'), { stdout: 'test', exitCode: 0 }]])
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      // Trigger connection
      await backend.exec('echo test')

      await backend.destroy()

      expect(mockClient.end).toHaveBeenCalled()
    })

    it('should handle destroy when not connected', async () => {
      vi.mocked(Client).mockImplementation(() => createMockSSHClient() as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      // Should not throw when destroying without connecting
      await expect(backend.destroy()).resolves.toBeUndefined()
    })
  })

  describe('Environment Variables', () => {
    it('should pass custom environment variables to commands', async () => {
      let executedCommand = ''
      const mockClient = createMockSSHClient()
      mockClient.exec = vi.fn((command: string, callback: Function) => {
        executedCommand = command
        const mockStream = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
        mockStream.stderr = new EventEmitter()
        setTimeout(() => {
          mockStream.emit('data', Buffer.from(''))
          mockStream.emit('close', 0)
        }, 0)
        callback(null, mockStream)
      })
      vi.mocked(Client).mockImplementation(() => mockClient as any)

      const backend = new RemoteFilesystemBackend({
        ...BASE_SSH_CONFIG,
        rootDir: TEST_ROOT_DIR,
        host: 'example.com',
        sshAuth: {
          type: 'password',
          credentials: { username: 'user', password: 'pass' }
        }
      })

      await backend.exec('echo $MY_VAR', { env: { MY_VAR: 'hello' } })

      expect(executedCommand).toContain("MY_VAR='hello'")
    })
  })
})
