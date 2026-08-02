import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock ws module
vi.mock('ws', () => {
  const MockWebSocket = vi.fn()
  MockWebSocket.OPEN = 1
  MockWebSocket.CLOSED = 3
  return { default: MockWebSocket, WebSocket: MockWebSocket }
})

// Mock our SSH2 wrapper
vi.mock('../../../src/utils/ssh2.js', () => ({
  SSH2Client: vi.fn()
}))

import { WebSocketSSHTransport } from '../../../src/backends/transports/WebSocketSSHTransport.js'
import WebSocket from 'ws'
import { SSH2Client as SSHClient } from '../../../src/utils/ssh2.js'

// Helper to create a mock WebSocket with configurable behavior
function createMockWebSocket(options: {
  openBehavior?: 'success' | 'error' | 'timeout'
  readyState?: number
} = {}) {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    readyState: number
  }
  ws.send = vi.fn((data, callback) => callback?.())
  ws.close = vi.fn()
  ws.readyState = options.readyState ?? 1 // OPEN

  // Trigger open or error based on behavior
  if (options.openBehavior === 'error') {
    setTimeout(() => ws.emit('error', new Error('Connection refused')), 0)
  } else if (options.openBehavior !== 'timeout') {
    setTimeout(() => ws.emit('open'), 0)
  }

  return ws
}

// Helper to create a mock SSH client
function createMockSSHClient(options: {
  connectBehavior?: 'success' | 'error'
  execResults?: { stdout: string; stderr?: string; code: number }
} = {}) {
  const client = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
    sftp: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }

  client.connect = vi.fn(() => {
    if (options.connectBehavior === 'error') {
      setTimeout(() => client.emit('error', new Error('SSH handshake failed')), 0)
    } else {
      setTimeout(() => client.emit('ready'), 0)
    }
  })

  client.exec = vi.fn((command: string, callback: Function) => {
    const channel = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    channel.stderr = new EventEmitter()
    const result = options.execResults ?? { stdout: '', stderr: '', code: 0 }

    setTimeout(() => {
      if (result.stdout) channel.emit('data', Buffer.from(result.stdout))
      if (result.stderr) channel.stderr.emit('data', Buffer.from(result.stderr))
      channel.emit('close', result.code)
    }, 0)

    callback(null, channel)
  })

  client.sftp = vi.fn((callback) => {
    const sftp = new EventEmitter()
    callback(null, sftp)
  })

  client.end = vi.fn()

  return client
}

describe('WebSocketSSHTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Configuration', () => {
    it('should initialize with config and report disconnected', () => {
      const transport = new WebSocketSSHTransport({
        host: 'remote.example.com',
        port: 3001,
        authToken: 'secret-token'
      })

      expect(transport.connected).toBe(false)
    })

    it('should use default path and timeout values', () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(() => mockSsh as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      // Trigger connection to verify URL construction
      transport.connect().catch(() => {})

      // Should use default /ssh path
      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('/ssh'))
    })
  })

  describe('Connection', () => {
    it('should connect via WebSocket then establish SSH session', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(() => mockSsh as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001,
        authToken: 'test-token'
      })

      await transport.connect()

      expect(transport.connected).toBe(true)
      expect(WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('ws://example.com:3001/ssh?token=test-token')
      )
      expect(mockSsh.connect).toHaveBeenCalled()
    })

    it('should not reconnect if already connected', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(() => mockSsh as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      await transport.connect() // Second call should be no-op

      expect(WebSocket).toHaveBeenCalledTimes(1)
    })

    it('should handle WebSocket connection errors', async () => {
      const mockWs = createMockWebSocket({ openBehavior: 'error' })
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await expect(transport.connect()).rejects.toThrow('Connection refused')
      expect(transport.connected).toBe(false)
    })

    it('should handle SSH handshake errors', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const mockSsh = createMockSSHClient({ connectBehavior: 'error' })
      vi.mocked(SSHClient).mockImplementation(() => mockSsh as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await expect(transport.connect()).rejects.toThrow('SSH handshake failed')
    })

    it('should use wss:// for port 443', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(() => mockSsh as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 443
      })

      await transport.connect()

      expect(WebSocket).toHaveBeenCalledWith(expect.stringContaining('wss://'))
    })
  })

  describe('Command Execution', () => {
    it('should execute command and return stdout/stderr/code', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const mockSsh = createMockSSHClient({
        execResults: { stdout: 'hello world\n', stderr: '', code: 0 }
      })
      vi.mocked(SSHClient).mockImplementation(() => mockSsh as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      const result = await transport.exec('echo hello world')

      expect(result.stdout).toBe('hello world\n')
      expect(result.code).toBe(0)
    })

    it('should capture stderr and non-zero exit codes', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const mockSsh = createMockSSHClient({
        execResults: { stdout: '', stderr: 'error message', code: 1 }
      })
      vi.mocked(SSHClient).mockImplementation(() => mockSsh as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      const result = await transport.exec('false')

      expect(result.stderr).toBe('error message')
      expect(result.code).toBe(1)
    })

    it('should throw when executing without connection', async () => {
      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await expect(transport.exec('echo test')).rejects.toThrow('Not connected')
    })
  })

  describe('SFTP', () => {
    it('should get SFTP session', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(() => mockSsh as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      const sftp = await transport.getSFTP()

      expect(sftp).toBeDefined()
      expect(mockSsh.sftp).toHaveBeenCalled()
    })

    it('should reuse existing SFTP session', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(() => mockSsh as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      await transport.getSFTP()
      await transport.getSFTP()

      expect(mockSsh.sftp).toHaveBeenCalledTimes(1)
    })
  })

  describe('Disconnect', () => {
    it('should clean up resources on disconnect', async () => {
      const mockWs = createMockWebSocket()
      vi.mocked(WebSocket).mockImplementation(() => mockWs as any)

      const mockSsh = createMockSSHClient()
      vi.mocked(SSHClient).mockImplementation(() => mockSsh as any)

      const transport = new WebSocketSSHTransport({
        host: 'example.com',
        port: 3001
      })

      await transport.connect()
      expect(transport.connected).toBe(true)

      await transport.disconnect()
      expect(transport.connected).toBe(false)
      expect(mockSsh.end).toHaveBeenCalled()
      expect(mockWs.close).toHaveBeenCalled()
    })
  })
})
