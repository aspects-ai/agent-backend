import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryBackend } from '../../../src/backends/MemoryBackend.js'
import { PathEscapeError } from '../../../src/types.js'

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

  describe('Scoped Path Handling', () => {
    it('should resolve relative paths within scope', async () => {
      const scoped = backend.scope('users/user1')
      await scoped.write('file.txt', 'content')

      // Verify the key is scoped correctly
      const exists = await scoped.exists('file.txt')
      expect(exists).toBe(true)
    })

    it('should treat absolute paths as relative to scope', async () => {
      const scoped = backend.scope('users/user1')
      await scoped.write('/file.txt', 'content')

      // Should be stored under users/user1/file.txt
      const exists = await scoped.exists('file.txt')
      expect(exists).toBe(true)
    })

    it('should reject escape attempts via parent directory', async () => {
      const scoped = backend.scope('users/user1')

      await expect(scoped.write('../user2/secret', 'content'))
        .rejects.toThrow(PathEscapeError)
    })

    it('should reject deep escape attempts', async () => {
      const scoped = backend.scope('users/user1')

      await expect(scoped.read('../../../etc/passwd'))
        .rejects.toThrow(PathEscapeError)
    })

    it('should allow navigation within scope using ..', async () => {
      const scoped = backend.scope('users/user1')

      // Write using normalized path and read using path with ..
      // Both should resolve to the same key
      await scoped.write('dir/file.txt', 'content')

      // dir/subdir/../file.txt should resolve to dir/file.txt
      // This tests that .. within the scope is allowed
      await expect(scoped.read('dir/subdir/../file.txt')).resolves.toBe('content')
    })
  })
})
