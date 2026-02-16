// ============================================================================
// Backend Classes
// ============================================================================

export { LocalFilesystemBackend } from './LocalFilesystemBackend.js'
export { MemoryBackend } from './MemoryBackend.js'
export { RemoteFilesystemBackend } from './RemoteFilesystemBackend.js'
export { ScopedFilesystemBackend } from './ScopedFilesystemBackend.js'
export { ScopedMemoryBackend } from './ScopedMemoryBackend.js'

// ============================================================================
// Core Types & Interfaces
// ============================================================================

export { BackendType, ConnectionStatus } from './types.js'
export type {
    Backend,
    FileBasedBackend, // Legacy: FileBasedBackend
    ScopedBackend,
    ScopedFileBasedBackend,
    StatusChangeCallback,
    StatusChangeEvent,
    Unsubscribe
} from './types.js'

// ============================================================================
// Configuration Types & Validation
// ============================================================================

export type {
    BackendConfig, BaseFileBackendConfig, ExecOptions, // Legacy
    LocalBackendConfig, LocalFilesystemBackendConfig, MemoryBackendConfig, ReadOptions, ReconnectionConfig, // Legacy
    RemoteBackendConfig // Legacy
    , RemoteFilesystemBackendConfig, ScopeConfig
} from './config.js'

export {
    BackendConfigSchema, // Legacy
    validateLocalBackendConfig // Legacy
    , validateLocalFilesystemBackendConfig, validateMemoryBackendConfig, validateRemoteFilesystemBackendConfig
} from './config.js'

