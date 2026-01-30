// ============================================================================
// Backend Classes
// ============================================================================

export { LocalFilesystemBackend } from './LocalFilesystemBackend.js'
export { RemoteFilesystemBackend } from './RemoteFilesystemBackend.js'
export { ScopedFilesystemBackend } from './ScopedFilesystemBackend.js'
export { MemoryBackend } from './MemoryBackend.js'
export { ScopedMemoryBackend } from './ScopedMemoryBackend.js'

// ============================================================================
// Core Types & Interfaces
// ============================================================================

export { BackendType } from './types.js'
export type {
  Backend,
  FileBasedBackend,
  ScopedBackend,
  ScopedFileBasedBackend,
  FileSystemBackend // Legacy
} from './types.js'

// ============================================================================
// Configuration Types & Validation
// ============================================================================

export type {
  ScopeConfig,
  ExecOptions,
  ReadOptions,
  BaseFileBackendConfig,
  LocalFilesystemBackendConfig,
  RemoteFilesystemBackendConfig,
  MemoryBackendConfig,
  BackendConfig, // Legacy
  LocalBackendConfig, // Legacy
  RemoteBackendConfig // Legacy
} from './config.js'

export {
  validateLocalFilesystemBackendConfig,
  validateRemoteFilesystemBackendConfig,
  validateMemoryBackendConfig,
  BackendConfigSchema, // Legacy
  validateLocalBackendConfig // Legacy
} from './config.js'
