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
  /** Remote host */
  host: string

  /** SSH authentication */
  sshAuth: {
    type: 'password' | 'key'
    credentials: {
      username: string
      password?: string
      privateKey?: string
    }
  }

  /** SSH port */
  sshPort?: number

  /** MCP authentication (for remote MCP server) */
  mcpAuth?: {
    token: string
  }

  /** MCP port */
  mcpPort?: number

  /** Operation timeout in milliseconds */
  operationTimeoutMs?: number

  /** SSH keepalive interval in milliseconds */
  keepaliveIntervalMs?: number

  /** Number of missed keepalives before considering connection dead */
  keepaliveCountMax?: number
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
  onDangerousOperation: z.function().optional(),
  maxOutputLength: z.number().positive().optional(),
  shell: z.enum(['bash', 'sh', 'auto']).optional(),
  validateUtils: z.boolean().optional(),
}).passthrough() // Allow functions to pass through without strict validation

const RemoteFilesystemBackendConfigSchema = z.object({
  rootDir: z.string().min(1),
  host: z.string().min(1),
  sshAuth: z.object({
    type: z.enum(['password', 'key']),
    credentials: z.object({
      username: z.string(),
      password: z.string().optional(),
      privateKey: z.string().optional(),
    }),
  }),
  isolation: z.enum(['auto', 'bwrap', 'software', 'none']).optional(),
  preventDangerous: z.boolean().optional(),
  onDangerousOperation: z.function().optional(),
  maxOutputLength: z.number().positive().optional(),
  sshPort: z.number().positive().optional(),
  mcpAuth: z.object({
    token: z.string(),
  }).optional(),
  mcpPort: z.number().positive().optional(),
  operationTimeoutMs: z.number().positive().optional(),
  keepaliveIntervalMs: z.number().positive().optional(),
  keepaliveCountMax: z.number().positive().optional(),
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

export function validateLocalBackendConfig(config: LocalBackendConfig): void {
  // Legacy validation - no-op for now
}
