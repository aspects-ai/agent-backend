import { z } from 'zod'
import type { OperationsLogger } from '../logging/types.js'

/**
 * Configuration for creating a scoped backend
 */
export interface ScopeConfig {
  /** Custom environment variables for this scope */
  env?: Record<string, string>

  /** Operations logger */
  operationsLogger?: OperationsLogger
}

/**
 * Options for exec command
 */
export interface ExecOptions {
  /** Output encoding: 'utf8' for text (default) or 'buffer' for binary data */
  encoding?: 'utf8' | 'buffer'

  /** Working directory (for scoped backends, automatically set) */
  cwd?: string

  /** Custom environment variables for this specific command execution */
  env?: Record<string, string | undefined>
}

/**
 * Options for read command
 */
export interface ReadOptions {
  /** Output encoding: 'utf8' for text (default) or 'buffer' for binary data */
  encoding?: 'utf8' | 'buffer'
}

/**
 * Base configuration for file-based backends
 */
export interface BaseFileBackendConfig {
  /** Root directory or namespace */
  rootDir: string

  /** Isolation level */
  isolation?: 'auto' | 'bwrap' | 'software' | 'none'

  /** Prevent dangerous operations */
  preventDangerous?: boolean

  /** Callback on dangerous operation */
  onDangerousOperation?: (operation: string) => void

  /** Max output length in bytes */
  maxOutputLength?: number
}

/**
 * Configuration for LocalFilesystemBackend
 */
export interface LocalFilesystemBackendConfig extends BaseFileBackendConfig {
  /** Shell to use for command execution */
  shell?: 'bash' | 'sh' | 'auto'

  /** Validate utilities availability */
  validateUtils?: boolean
}

/**
 * Configuration for RemoteFilesystemBackend
 */
export interface RemoteFilesystemBackendConfig extends BaseFileBackendConfig {
  /** Default host for all services (required) */
  host: string

  /**
   * Transport type for SSH operations
   * - 'ssh-ws': SSH over WebSocket (default, recommended) - single port, unified auth
   * - 'ssh': Conventional SSH via sshd - requires separate sshd process
   */
  transport?: 'ssh-ws' | 'ssh'

  /**
   * Unified authentication token (used for both MCP and SSH-WS)
   * Required when transport is 'ssh-ws' (unless server has auth disabled)
   */
  authToken?: string

  /**
   * Port for connection
   * - For 'ssh-ws': WebSocket port (same as MCP, default: 3001)
   * - For 'ssh': SSH daemon port (default: 22)
   */
  port?: number

  /**
   * SSH authentication (required when transport is 'ssh', ignored for 'ssh-ws')
   */
  sshAuth?: {
    type: 'password' | 'key'
    credentials: {
      username: string
      password?: string
      privateKey?: string
    }
  }

  /** SSH port (defaults to 22) - deprecated, use 'port' instead */
  sshPort?: number

  /** Override host for SSH (if different from main host) */
  sshHostOverride?: string

  /** MCP server port (defaults to 3001) */
  mcpPort?: number

  /** Override host for MCP server (if different from main host) */
  mcpServerHostOverride?: string

  /** MCP authentication (for remote MCP server) - deprecated, use 'authToken' instead */
  mcpAuth?: {
    token: string
  }

  /** Operation timeout in milliseconds */
  operationTimeoutMs?: number

  /** SSH keepalive interval in milliseconds */
  keepaliveIntervalMs?: number

  /** Number of missed keepalives before considering connection dead */
  keepaliveCountMax?: number

  /** Auto-reconnection configuration */
  reconnection?: ReconnectionConfig
}

/**
 * Configuration for automatic reconnection
 */
export interface ReconnectionConfig {
  /** Whether auto-reconnection is enabled (default: true) */
  enabled?: boolean

  /** Maximum number of reconnection attempts (default: 5, 0 = infinite) */
  maxRetries?: number

  /** Initial delay before first reconnect in milliseconds (default: 1000) */
  initialDelayMs?: number

  /** Maximum delay between reconnect attempts in milliseconds (default: 30000) */
  maxDelayMs?: number

  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number
}

/**
 * Configuration for MemoryBackend
 */
export interface MemoryBackendConfig {
  /** Root namespace (default: '/') */
  rootDir?: string

  /** Initial data to populate */
  initialData?: Record<string, string | Buffer>

  /** Enable TTL support */
  enableTTL?: boolean
}

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const LocalFilesystemBackendConfigSchema = z.object({
  rootDir: z.string().min(1),
  isolation: z.enum(['auto', 'bwrap', 'software', 'none']).optional(),
  preventDangerous: z.boolean().optional(),
  onDangerousOperation: z.custom<(operation: string) => void>().optional(),
  maxOutputLength: z.number().positive().optional(),
  shell: z.enum(['bash', 'sh', 'auto']).optional(),
  validateUtils: z.boolean().optional(),
}).passthrough() // Allow functions to pass through without strict validation

const ReconnectionConfigSchema = z.object({
  enabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).optional(),
  initialDelayMs: z.number().positive().optional(),
  maxDelayMs: z.number().positive().optional(),
  backoffMultiplier: z.number().positive().optional(),
})

const RemoteFilesystemBackendConfigSchema = z.object({
  rootDir: z.string().min(1),
  host: z.string().min(1),
  transport: z.enum(['ssh-ws', 'ssh']).optional(),
  authToken: z.string().optional(),
  port: z.number().positive().optional(),
  sshAuth: z.object({
    type: z.enum(['password', 'key']),
    credentials: z.object({
      username: z.string(),
      password: z.string().optional(),
      privateKey: z.string().optional(),
    }),
  }).optional(),
  isolation: z.enum(['auto', 'bwrap', 'software', 'none']).optional(),
  preventDangerous: z.boolean().optional(),
  onDangerousOperation: z.custom<(operation: string) => void>().optional(),
  maxOutputLength: z.number().positive().optional(),
  sshPort: z.number().positive().optional(),
  sshHostOverride: z.string().optional(),
  mcpPort: z.number().positive().optional(),
  mcpServerHostOverride: z.string().optional(),
  mcpAuth: z.object({
    token: z.string(),
  }).optional(),
  operationTimeoutMs: z.number().positive().optional(),
  keepaliveIntervalMs: z.number().positive().optional(),
  keepaliveCountMax: z.number().positive().optional(),
  reconnection: ReconnectionConfigSchema.optional(),
}).passthrough() // Allow functions to pass through without strict validation

const MemoryBackendConfigSchema = z.object({
  rootDir: z.string().optional(),
  initialData: z.record(z.string(), z.union([z.string(), z.instanceof(Buffer)])).optional(),
  enableTTL: z.boolean().optional(),
})

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate LocalFilesystemBackend configuration
 */
export function validateLocalFilesystemBackendConfig(config: unknown): LocalFilesystemBackendConfig {
  return LocalFilesystemBackendConfigSchema.parse(config)
}

/**
 * Validate RemoteFilesystemBackend configuration
 */
export function validateRemoteFilesystemBackendConfig(config: unknown): RemoteFilesystemBackendConfig {
  return RemoteFilesystemBackendConfigSchema.parse(config)
}

/**
 * Validate MemoryBackend configuration
 */
export function validateMemoryBackendConfig(config: unknown): MemoryBackendConfig {
  return MemoryBackendConfigSchema.parse(config)
}

// ============================================================================
// Legacy Exports (for backward compatibility during migration)
// ============================================================================

export type BackendConfig = LocalBackendConfig | RemoteBackendConfig
export type LocalBackendConfig = LocalFilesystemBackendConfig & { type?: 'local'; userId?: string }
export type RemoteBackendConfig = RemoteFilesystemBackendConfig & { type?: 'remote'; userId?: string }

export const BackendConfigSchema = z.discriminatedUnion('type', [
  LocalFilesystemBackendConfigSchema.extend({ type: z.literal('local') }),
  RemoteFilesystemBackendConfigSchema.extend({ type: z.literal('remote') }),
])

export function validateLocalBackendConfig(_config: LocalBackendConfig): void {
  // Legacy validation - no-op for now
}
