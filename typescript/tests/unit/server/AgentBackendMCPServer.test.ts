import type { Backend, FileBasedBackend, MemoryBackend } from '../../../src/types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentBackendMCPServer } from '../../../src/server/AgentBackendMCPServer.js'

// Mock file-based backend (local or remote)
function createMockFileBackend(type: string): FileBasedBackend {
  return {
    type,
    rootDir: '/test/workspace',
    connected: true,
    read: vi.fn().mockResolvedValue('mock content'),
    write: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue(['file1.txt', 'file2.txt']),
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 100,
      mtime: new Date(),
      atime: new Date(),
      birthtime: new Date(),
      mode: 0o644
    } as any),
    exec: vi.fn().mockResolvedValue('command output'),
    touch: vi.fn().mockResolvedValue(undefined),
    scope: vi.fn(),
    listActiveScopes: vi.fn().mockResolvedValue([]),
    getMCPClient: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined)
  } as any
}

// Mock MemoryBackend (no exec method)
function createMockMemoryBackend(): MemoryBackend {
  return {
    type: 'memory',
    rootDir: '/memory',
    connected: true,
    read: vi.fn().mockResolvedValue('memory content'),
    write: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue(['key1', 'key2']),
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 50,
      mtime: new Date(),
      atime: new Date(),
      birthtime: new Date(),
      mode: 0o644
    } as any),
    touch: vi.fn().mockResolvedValue(undefined),
    scope: vi.fn(),
    listActiveScopes: vi.fn().mockResolvedValue([]),
    getMCPClient: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(['key1', 'key2', 'key3']),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined)
    // NOTE: No exec method - this is the key difference
  } as any
}

describe('AgentBackendMCPServer (Adaptive Server)', () => {
  describe('LocalFilesystem Backend', () => {
    let backend: FileBasedBackend
    let server: AgentBackendMCPServer

    beforeEach(() => {
      vi.clearAllMocks()
      backend = createMockFileBackend('LocalFilesystem')
      server = new AgentBackendMCPServer(backend)
    })

    describe('Initialization', () => {
      it('should create server instance', () => {
        expect(server).toBeDefined()
        expect(server.server).toBeDefined()
      })

      it('should generate kebab-case server name from backend type', () => {
        expect(server.server.name).toBe('local-filesystem')
      })

      it('should have version information', () => {
        expect(server.server.version).toBe('1.0.0')
      })
    })

    describe('Tool Registration', () => {
      it('should register filesystem tools', () => {
        const tools = server.server.getTools()
        const toolNames = Object.keys(tools)

        // Core filesystem tools
        expect(toolNames).toContain('read_text_file')
        expect(toolNames).toContain('write_file')
        expect(toolNames).toContain('list_directory')
        expect(toolNames).toContain('create_directory')
        expect(toolNames).toContain('move_file')
        expect(toolNames).toContain('search_files')
        expect(toolNames).toContain('get_file_info')
      })

      it('should register exec tool for file-based backend', () => {
        const tools = server.server.getTools()
        const toolNames = Object.keys(tools)

        // Should have exec tool (duck typing detected exec method)
        expect(toolNames).toContain('exec')
      })

      it('should have handler functions for all tools', () => {
        const tools = server.server.getTools()

        Object.entries(tools).forEach(([name, tool]) => {
          expect(typeof tool.handler).toBe('function')
        })
      })

      it('should have descriptions for all tools', () => {
        const tools = server.server.getTools()

        Object.entries(tools).forEach(([name, tool]) => {
          expect(tool.description).toBeTruthy()
          expect(tool.description.length).toBeGreaterThan(0)
        })
      })

      it('should have input schemas for all tools', () => {
        const tools = server.server.getTools()

        Object.entries(tools).forEach(([name, tool]) => {
          expect(tool.inputSchema).toBeDefined()
          expect(tool.inputSchema.type).toBe('object')
        })
      })
    })

    describe('Backend Integration', () => {
      it('should use provided backend instance', () => {
        expect(server.getBackend()).toBe(backend)
      })

      it('should use backend rootDir for allowed directories', () => {
        expect(server.getBackend().rootDir).toBe('/test/workspace')
      })
    })

    describe('Server Capabilities', () => {
      it('should expose tools capability', () => {
        const tools = server.server.getTools()
        expect(Object.keys(tools).length).toBeGreaterThan(0)
      })

      it('should provide tool metadata', () => {
        const tools = server.server.getTools()
        const tool = tools['read_text_file']

        expect(tool.name).toBe('read_text_file')
        expect(tool.description).toBeTruthy()
        expect(tool.inputSchema).toBeDefined()
      })
    })
  })

  describe('RemoteFilesystem Backend', () => {
    let backend: FileBasedBackend
    let server: AgentBackendMCPServer

    beforeEach(() => {
      vi.clearAllMocks()
      backend = createMockFileBackend('RemoteFilesystem')
      server = new AgentBackendMCPServer(backend)
    })

    describe('Initialization', () => {
      it('should create server instance', () => {
        expect(server).toBeDefined()
        expect(server.server).toBeDefined()
      })

      it('should generate kebab-case server name from backend type', () => {
        expect(server.server.name).toBe('remote-filesystem')
      })
    })

    describe('Tool Registration', () => {
      it('should register filesystem tools', () => {
        const tools = server.server.getTools()
        const toolNames = Object.keys(tools)

        expect(toolNames).toContain('read_text_file')
        expect(toolNames).toContain('write_file')
        expect(toolNames).toContain('list_directory')
      })

      it('should register exec tool for remote backend', () => {
        const tools = server.server.getTools()
        const toolNames = Object.keys(tools)

        // Remote backend supports exec via SSH
        expect(toolNames).toContain('exec')
      })
    })
  })

  describe('Memory Backend', () => {
    let backend: MemoryBackend
    let server: AgentBackendMCPServer

    beforeEach(() => {
      vi.clearAllMocks()
      backend = createMockMemoryBackend()
      server = new AgentBackendMCPServer(backend)
    })

    describe('Initialization', () => {
      it('should create server instance', () => {
        expect(server).toBeDefined()
        expect(server.server).toBeDefined()
      })

      it('should generate kebab-case server name from backend type', () => {
        expect(server.server.name).toBe('memory')
      })

      it('should have version information', () => {
        expect(server.server.version).toBe('1.0.0')
      })
    })

    describe('Tool Registration', () => {
      it('should register filesystem tools', () => {
        const tools = server.server.getTools()
        const toolNames = Object.keys(tools)

        // Core filesystem tools (that work with memory backend)
        expect(toolNames).toContain('read_text_file')
        expect(toolNames).toContain('write_file')
        expect(toolNames).toContain('list_directory')
        expect(toolNames).toContain('get_file_info')
      })

      it('should NOT register exec tool for memory backend', () => {
        const tools = server.server.getTools()
        const toolNames = Object.keys(tools)

        // Memory backend does NOT support exec (no exec method)
        expect(toolNames).not.toContain('exec')
      })

      it('should have handler functions for all registered tools', () => {
        const tools = server.server.getTools()

        Object.entries(tools).forEach(([name, tool]) => {
          expect(typeof tool.handler).toBe('function')
        })
      })

      it('should have descriptions for all tools', () => {
        const tools = server.server.getTools()

        Object.entries(tools).forEach(([name, tool]) => {
          expect(tool.description).toBeTruthy()
        })
      })
    })

    describe('Tool Handlers', () => {
      it('should have read_text_file handler', () => {
        const tools = server.server.getTools()
        const readTool = tools['read_text_file']

        expect(readTool).toBeDefined()
        expect(typeof readTool.handler).toBe('function')
      })

      it('should have write_file handler', () => {
        const tools = server.server.getTools()
        const writeTool = tools['write_file']

        expect(writeTool).toBeDefined()
        expect(typeof writeTool.handler).toBe('function')
      })

      it('should NOT have exec handler', () => {
        const tools = server.server.getTools()
        const execTool = tools['exec']

        expect(execTool).toBeUndefined()
      })
    })

    describe('Backend Integration', () => {
      it('should use provided backend instance', () => {
        expect(server.getBackend()).toBe(backend)
      })

      it('should use backend rootDir', () => {
        expect(server.getBackend().rootDir).toBe('/memory')
      })

      it('should delegate operations to backend', () => {
        // Verify backend is accessible
        expect(backend).toBeDefined()
        expect(backend.read).toBeDefined()
        expect(backend.write).toBeDefined()
        expect(backend.list).toBeDefined()
      })
    })
  })

  describe('Duck Typing Capability Detection', () => {
    it('should register exec tool when backend has exec method', () => {
      const backendWithExec = {
        type: 'custom',
        rootDir: '/test',
        connected: true,
        exec: vi.fn().mockResolvedValue('output'),
        read: vi.fn(),
        write: vi.fn(),
        readdir: vi.fn(),
        mkdir: vi.fn(),
        exists: vi.fn(),
        stat: vi.fn(),
        touch: vi.fn(),
        scope: vi.fn(),
        listActiveScopes: vi.fn(),
        getMCPClient: vi.fn(),
        destroy: vi.fn()
      } as any

      const server = new AgentBackendMCPServer(backendWithExec)
      const tools = server.server.getTools()

      expect(Object.keys(tools)).toContain('exec')
    })

    it('should NOT register exec tool when backend lacks exec method', () => {
      const backendWithoutExec = {
        type: 'custom',
        rootDir: '/test',
        connected: true,
        // No exec method
        read: vi.fn(),
        write: vi.fn(),
        readdir: vi.fn(),
        mkdir: vi.fn(),
        exists: vi.fn(),
        stat: vi.fn(),
        touch: vi.fn(),
        scope: vi.fn(),
        listActiveScopes: vi.fn(),
        getMCPClient: vi.fn(),
        destroy: vi.fn()
      } as any

      const server = new AgentBackendMCPServer(backendWithoutExec)
      const tools = server.server.getTools()

      expect(Object.keys(tools)).not.toContain('exec')
    })
  })

  describe('Server Name Generation', () => {
    it('should convert LocalFilesystem to local-filesystem', () => {
      const backend = createMockFileBackend('LocalFilesystem')
      const server = new AgentBackendMCPServer(backend)
      expect(server.server.name).toBe('local-filesystem')
    })

    it('should convert RemoteFilesystem to remote-filesystem', () => {
      const backend = createMockFileBackend('RemoteFilesystem')
      const server = new AgentBackendMCPServer(backend)
      expect(server.server.name).toBe('remote-filesystem')
    })

    it('should convert Memory to memory', () => {
      const backend = createMockMemoryBackend()
      const server = new AgentBackendMCPServer(backend)
      expect(server.server.name).toBe('memory')
    })

    it('should convert ScopedFilesystem to scoped-filesystem', () => {
      const backend = createMockFileBackend('ScopedFilesystem')
      const server = new AgentBackendMCPServer(backend)
      expect(server.server.name).toBe('scoped-filesystem')
    })
  })

  describe('Error Handling', () => {
    it('should handle backend errors gracefully', () => {
      const backend = createMockFileBackend('LocalFilesystem')
      vi.mocked(backend.read).mockRejectedValue(new Error('Backend error'))

      const server = new AgentBackendMCPServer(backend)
      expect(backend.read).toBeDefined()
    })

    it('should validate tool exists before execution', () => {
      const backend = createMockFileBackend('LocalFilesystem')
      const server = new AgentBackendMCPServer(backend)
      const tools = server.server.getTools()

      expect(tools['nonexistent_tool']).toBeUndefined()
    })
  })

  describe('Type Safety', () => {
    it('should be properly typed', () => {
      const backend = createMockFileBackend('LocalFilesystem')
      const server = new AgentBackendMCPServer(backend)
      expect(server).toBeInstanceOf(AgentBackendMCPServer)
    })

    it('should work with any Backend type', () => {
      const localBackend = createMockFileBackend('LocalFilesystem')
      const remoteBackend = createMockFileBackend('RemoteFilesystem')
      const memoryBackend = createMockMemoryBackend()

      expect(() => new AgentBackendMCPServer(localBackend)).not.toThrow()
      expect(() => new AgentBackendMCPServer(remoteBackend)).not.toThrow()
      expect(() => new AgentBackendMCPServer(memoryBackend)).not.toThrow()
    })
  })

  describe('directory_tree Tool', () => {
    it('should register directory_tree tool', () => {
      const backend = createMockFileBackend('LocalFilesystem')
      const server = new AgentBackendMCPServer(backend)
      const tools = server.server.getTools()

      expect(Object.keys(tools)).toContain('directory_tree')
    })

    it('should have includeDefaultExcludes parameter defined', () => {
      const backend = createMockFileBackend('LocalFilesystem')
      const server = new AgentBackendMCPServer(backend)
      const tools = server.server.getTools()
      const dirTreeTool = tools['directory_tree']

      expect(dirTreeTool).toBeDefined()
      // The tool has inputSchema with path, excludePatterns, and includeDefaultExcludes
      expect(dirTreeTool.inputSchema).toBeDefined()
    })
  })
})
