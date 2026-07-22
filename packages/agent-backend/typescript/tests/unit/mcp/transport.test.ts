import * as fsSync from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalFilesystemBackend } from '../../../src/backends/LocalFilesystemBackend.js'
import { MemoryBackend } from '../../../src/backends/MemoryBackend.js'
import { RemoteFilesystemBackend } from '../../../src/backends/RemoteFilesystemBackend.js'
import { BackendType } from '../../../src/backends/types.js'
import { createBackendMCPTransport } from '../../../src/mcp/transport.js'
import { BackendError } from '../../../src/types.js'

// Mock the MCP SDK transports
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation((options) => ({
    type: 'stdio',
    options,
  })),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation((url, options) => ({
    type: 'http',
    url,
    options,
  })),
}))

describe('MCP Transport (Unit Tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock mkdirSync for LocalFilesystemBackend constructor
    vi.mocked(fsSync.mkdirSync).mockReturnValue(undefined)
  })

  describe('createBackendMCPTransport', () => {
    describe('LocalFilesystemBackend', () => {
      it('should create StdioClientTransport for local backend', async () => {
        const backend = new LocalFilesystemBackend({
          rootDir: '/test/workspace',
          isolation: 'software',
          shell: 'bash',
        })

        const transport = await createBackendMCPTransport(backend)

        expect(transport).toBeDefined()
        expect((transport as any).type).toBe('stdio')
        expect((transport as any).options.command).toBe('agent-backend')
        expect((transport as any).options.args).toContain('daemon')
        expect((transport as any).options.args).toContain('--rootDir')
        expect((transport as any).options.args).toContain('/test/workspace')
        expect((transport as any).options.args).toContain('--local-only')
      })

      it('should include isolation flag when not auto', async () => {
        const backend = new LocalFilesystemBackend({
          rootDir: '/test/workspace',
          isolation: 'software',
          shell: 'bash',
        })

        const transport = await createBackendMCPTransport(backend)

        expect((transport as any).options.args).toContain('--isolation')
        expect((transport as any).options.args).toContain('software')
      })

      it('should include shell flag when not auto', async () => {
        const backend = new LocalFilesystemBackend({
          rootDir: '/test/workspace',
          isolation: 'software',
          shell: 'sh',
        })

        const transport = await createBackendMCPTransport(backend)

        expect((transport as any).options.args).toContain('--shell')
        expect((transport as any).options.args).toContain('sh')
      })

      it('should use scopePath when provided', async () => {
        const backend = new LocalFilesystemBackend({
          rootDir: '/test/workspace',
          isolation: 'software',
          shell: 'bash',
        })

        const transport = await createBackendMCPTransport(backend, '/custom/scope')

        // scopePath is passed as separate arg, rootDir is still included
        const args = (transport as any).options.args as string[]
        expect(args).toContain('--rootDir')
        expect(args).toContain('/test/workspace')
        expect(args).toContain('--scopePath')
        expect(args).toContain('/custom/scope')
      })
    })

    describe('MemoryBackend', () => {
      it('should create StdioClientTransport for memory backend', async () => {
        const backend = new MemoryBackend({ rootDir: '/memory' })

        const transport = await createBackendMCPTransport(backend)

        expect(transport).toBeDefined()
        expect((transport as any).type).toBe('stdio')
        expect((transport as any).options.command).toBe('agent-backend')
        expect((transport as any).options.args).toContain('--backend')
        expect((transport as any).options.args).toContain('memory')
        expect((transport as any).options.args).toContain('--rootDir')
        expect((transport as any).options.args).toContain('/memory')
      })

      it('should use scopePath when provided', async () => {
        const backend = new MemoryBackend({ rootDir: '/memory' })

        const transport = await createBackendMCPTransport(backend, '/scoped/path')

        // scopePath is passed as separate arg, rootDir is still included
        const args = (transport as any).options.args as string[]
        expect(args).toContain('--rootDir')
        expect(args).toContain('/memory')
        expect(args).toContain('--scopePath')
        expect(args).toContain('/scoped/path')
      })
    })

    describe('RemoteFilesystemBackend', () => {
      it('should create StreamableHTTPClientTransport for remote backend', async () => {
        // Create a mock remote backend with config
        const mockBackend = {
          type: BackendType.REMOTE_FILESYSTEM,
          connected: true,
          rootDir: '/remote/workspace',
          config: {
            host: 'remote.example.com',
            port: 3001,
            authToken: 'test-token',
          },
          getMCPTransport: vi.fn(),
          getMCPClient: vi.fn(),
          destroy: vi.fn(),
        }

        const transport = await createBackendMCPTransport(mockBackend as any)

        expect(transport).toBeDefined()
        expect((transport as any).type).toBe('http')
        expect((transport as any).url.toString()).toBe('http://remote.example.com:3001/mcp')
      })

      it('should throw error when host is not configured', async () => {
        const mockBackend = {
          type: BackendType.REMOTE_FILESYSTEM,
          connected: true,
          rootDir: '/remote/workspace',
          config: {
            // No host configured
          },
          getMCPTransport: vi.fn(),
          getMCPClient: vi.fn(),
          destroy: vi.fn(),
        }

        await expect(createBackendMCPTransport(mockBackend as any)).rejects.toThrow(BackendError)
        await expect(createBackendMCPTransport(mockBackend as any)).rejects.toThrow('host')
      })

      it('should use mcpServerHostOverride when provided', async () => {
        const mockBackend = {
          type: BackendType.REMOTE_FILESYSTEM,
          connected: true,
          rootDir: '/remote/workspace',
          config: {
            host: 'original.example.com',
            mcpServerHostOverride: 'override.example.com',
            port: 4000,
            authToken: 'test-token',
          },
          getMCPTransport: vi.fn(),
          getMCPClient: vi.fn(),
          destroy: vi.fn(),
        }

        const transport = await createBackendMCPTransport(mockBackend as any)

        expect((transport as any).url.toString()).toBe('http://override.example.com:4000/mcp')
      })
    })

    describe('Unsupported backend types', () => {
      it('should throw error for unsupported backend type', async () => {
        const mockBackend = {
          type: 'unsupported-type' as any,
          connected: true,
          getMCPTransport: vi.fn(),
          getMCPClient: vi.fn(),
          destroy: vi.fn(),
        }

        await expect(createBackendMCPTransport(mockBackend as any)).rejects.toThrow(BackendError)
        await expect(createBackendMCPTransport(mockBackend as any)).rejects.toThrow('Unsupported backend type')
      })
    })
  })

  describe('Backend.getMCPTransport()', () => {
    describe('LocalFilesystemBackend', () => {
      it('should return transport via getMCPTransport()', async () => {
        const backend = new LocalFilesystemBackend({
          rootDir: '/test/workspace',
          isolation: 'software',
          shell: 'bash',
        })

        const transport = await backend.getMCPTransport()

        expect(transport).toBeDefined()
        expect((transport as any).type).toBe('stdio')
      })

      it('should pass scopePath to transport', async () => {
        const backend = new LocalFilesystemBackend({
          rootDir: '/test/workspace',
          isolation: 'software',
          shell: 'bash',
        })

        const transport = await backend.getMCPTransport('/scoped/path')

        const args = (transport as any).options.args as string[]
        expect(args).toContain('--scopePath')
        expect(args).toContain('/scoped/path')
      })
    })

    describe('MemoryBackend', () => {
      it('should return transport via getMCPTransport()', async () => {
        const backend = new MemoryBackend({ rootDir: '/memory' })

        const transport = await backend.getMCPTransport()

        expect(transport).toBeDefined()
        expect((transport as any).type).toBe('stdio')
        expect((transport as any).options.args).toContain('memory')
      })

      it('should pass scopePath to transport', async () => {
        const backend = new MemoryBackend({ rootDir: '/memory' })

        const transport = await backend.getMCPTransport('/scoped/memory')

        const args = (transport as any).options.args as string[]
        expect(args).toContain('--scopePath')
        expect(args).toContain('/scoped/memory')
      })
    })

    describe('ScopedFilesystemBackend', () => {
      it('should delegate to parent with combined scope path', async () => {
        const backend = new LocalFilesystemBackend({
          rootDir: '/test/workspace',
          isolation: 'software',
          shell: 'bash',
        })

        const scoped = backend.scope('user123')
        const transport = await scoped.getMCPTransport()

        expect(transport).toBeDefined()
        expect((transport as any).options.args).toContain('user123')
      })

      it('should combine additional scope path', async () => {
        const backend = new LocalFilesystemBackend({
          rootDir: '/test/workspace',
          isolation: 'software',
          shell: 'bash',
        })

        const scoped = backend.scope('user123')
        const transport = await scoped.getMCPTransport('projects')

        // Should combine: user123 + projects
        expect(transport).toBeDefined()
        expect((transport as any).options.args).toContain('user123/projects')
      })
    })

    describe('ScopedMemoryBackend', () => {
      it('should delegate to parent with combined scope path', async () => {
        const backend = new MemoryBackend({ rootDir: '/memory' })

        const scoped = backend.scope('user123')
        const transport = await scoped.getMCPTransport()

        expect(transport).toBeDefined()
        // ScopedMemoryBackend adds trailing slash to scopePath
        expect((transport as any).options.args).toContain('user123/')
      })
    })
  })
})
