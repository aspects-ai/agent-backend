// ============================================================================
// Core Backend Classes
// ============================================================================

export { LocalFilesystemBackend } from './backends/LocalFilesystemBackend.js'
export { MemoryBackend } from './backends/MemoryBackend.js'
export { RemoteFilesystemBackend } from './backends/RemoteFilesystemBackend.js'

// ============================================================================
// Scoped Backend Classes
// ============================================================================

export { ScopedFilesystemBackend } from './backends/ScopedFilesystemBackend.js'
export { ScopedMemoryBackend } from './backends/ScopedMemoryBackend.js'

// ============================================================================
// Backend Pool Manager
// ============================================================================

export {
    BackendPoolManager
} from './BackendPoolManager.js'

export type {
    PoolManagerConfig,
    PoolStats
} from './BackendPoolManager.js'

// ============================================================================
// Types & Interfaces
// ============================================================================

export { BackendType } from './backends/types.js'

export type {
    Backend,
    FileBasedBackend,
    MCPTransport,
    ScopedBackend
} from './backends/types.js'

export type {
    ExecOptions, LocalFilesystemBackendConfig, MemoryBackendConfig, ReadOptions, RemoteFilesystemBackendConfig, ScopeConfig
} from './backends/config.js'

// ============================================================================
// Error Classes
// ============================================================================

export {
    BackendError,
    DangerousOperationError, NotImplementedError, PathEscapeError
} from './types.js'

// ============================================================================
// Operations Logging
// ============================================================================

export {
    ArrayOperationsLogger,
    ConsoleOperationsLogger,
    MODIFYING_OPERATIONS,
    shouldLogOperation
} from './logging/index.js'

export type {
    LoggingMode,
    OperationLogEntry, OperationsLogger, OperationType
} from './logging/index.js'

// ============================================================================
// MCP Integration (Client-side)
// ============================================================================

// MCP Client for connecting to MCP servers
export {
    createAgentBeMCPClient,
    createAgentBeMCPTransport,
    type AgentBeMCPClientOptions,
    type CreateMCPClientOptions
} from './mcp/client.js'

// Local/memory transport helpers
export {
    createLocalMCPTransportOptions,
    createMemoryMCPTransportOptions,
    type LocalMCPTransportOptions,
    type MemoryMCPTransportOptions,
} from './mcp/local-transport.js'

// Centralized backend transport creation
export { createBackendMCPTransport } from './mcp/transport.js'

// ============================================================================
// Adapters
// ============================================================================

export { VercelAIAdapter } from './adapters/index.js'

// ============================================================================
// Type Guards & Utilities
// ============================================================================

export {
    getProperty,
    getRootBackend,
    hasRemoteConfig,
    isFileBasedBackend,
    isScopedBackend,
} from './typing.js'

// ============================================================================
// Constants
// ============================================================================

// Default patterns for excluding directories from tree listings
export { DEFAULT_EXCLUDE_PATTERNS } from './server/tools.js'
