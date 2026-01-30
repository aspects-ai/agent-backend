// ============================================================================
// Core Backend Classes
// ============================================================================

export { LocalFilesystemBackend } from './backends/LocalFilesystemBackend.js'
export { RemoteFilesystemBackend } from './backends/RemoteFilesystemBackend.js'
export { MemoryBackend } from './backends/MemoryBackend.js'

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
  ScopedBackend
} from './backends/types.js'

export type {
  ScopeConfig,
  LocalFilesystemBackendConfig,
  RemoteFilesystemBackendConfig,
  MemoryBackendConfig,
  ExecOptions,
  ReadOptions
} from './backends/config.js'

// ============================================================================
// Error Classes
// ============================================================================

export {
  BackendError,
  DangerousOperationError,
  PathEscapeError,
  NotImplementedError
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
  OperationLogEntry,
  OperationsLogger,
  OperationType
} from './logging/index.js'

// ============================================================================
// MCP Integration (Client-side)
// ============================================================================

// TODO Phase 8: MCP Server API moved to agentbe-server package
// export {
//   startMCPServer,
//   type MCPServerOptions
// } from './mcp/server.js'

// TODO Phase 8: registerTools moved to agentbe-server package
// export { registerTools } from './mcp/tools.js'

// MCP Client
export {
  createConstellationMCPClient,
  createConstellationMCPTransport,
  type ConstellationMCPClientOptions,
  type CreateMCPClientOptions
} from './mcp/client.js'

// TODO Phase 8: local-client uses archived Config.js - temporarily excluded
// export {
//   createLocalConstellationMCPClient,
//   createLocalConstellationMCPTransportOptions,
//   type CreateLocalMCPClientOptions,
//   type LocalConstellationMCPClientOptions
// } from './mcp/local-client.js'

// ============================================================================
// Platform Detection & Utilities
// ============================================================================

export {
  detectPlatformCapabilities,
  findNativeLibrary,
  getPlatformGuidance,
  getRemoteBackendLibrary,
  validateNativeLibrary,
  type PlatformCapabilities
} from './utils/nativeLibrary.js'
