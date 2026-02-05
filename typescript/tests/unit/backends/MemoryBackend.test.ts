import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryBackend } from '../../../src/backends/MemoryBackend.js'

// Mock the MCP SDK transport to capture options
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation((options) => ({
    type: 'stdio',
    options,
  })),
}))

describe('MemoryBackend (Unit Tests)', () => {
  let backend: MemoryBackend

  beforeEach(() => {
    vi.clearAllMocks()
    backend = new MemoryBackend({ rootDir: '/memory' })
  })

  describe('getMCPTransport scopePath handling', () => {
    it('should include rootDir when no scopePath provided', async () => {
      const transport = await backend.getMCPTransport()

      const args = (transport as any).options.args as string[]
      expect(args).toContain('--backend')
      expect(args).toContain('memory')
      expect(args).toContain('--rootDir')
      expect(args).toContain('/memory')
    })

    it('should pass scopePath as separate arg when provided', async () => {
      const transport = await backend.getMCPTransport('users/user1')

      const args = (transport as any).options.args as string[]
      expect(args).toContain('--rootDir')
      expect(args).toContain('/memory')
      expect(args).toContain('--scopePath')
      expect(args).toContain('users/user1')
    })

    it('should append scopePath to rootDir args, not replace it', async () => {
      const transport = await backend.getMCPTransport('projects')

      // Verify both rootDir and scopePath are present
      const args = (transport as any).options.args as string[]
      const rootDirIndex = args.indexOf('--rootDir')
      const scopePathIndex = args.indexOf('--scopePath')

      expect(rootDirIndex).toBeGreaterThan(-1)
      expect(scopePathIndex).toBeGreaterThan(-1)
      expect(args[rootDirIndex + 1]).toBe('/memory')
      expect(args[scopePathIndex + 1]).toBe('projects')
    })
  })

  describe('Basic Operations', () => {
    it('should have correct type', () => {
      expect(backend.type).toBe('memory')
    })

    it('should be connected by default', () => {
      expect(backend.connected).toBe(true)
    })

    it('should read and write values', async () => {
      await backend.write('key1', 'value1')
      const result = await backend.read('key1')
      expect(result).toBe('value1')
    })

    it('should throw on read of non-existent key', async () => {
      await expect(backend.read('nonexistent')).rejects.toThrow('Key not found')
    })
  })

  describe('Scope Tracking', () => {
    it('should track active scopes', async () => {
      const scope1 = backend.scope('scope1')
      const scope2 = backend.scope('scope2')

      const activeScopes = await backend.listActiveScopes()
      expect(activeScopes).toContain('scope1/')
      expect(activeScopes).toContain('scope2/')
    })

    it('should unregister scope on destroy', async () => {
      const scope1 = backend.scope('scope1')
      await scope1.destroy()

      const activeScopes = await backend.listActiveScopes()
      expect(activeScopes).not.toContain('scope1/')
    })
  })
})
