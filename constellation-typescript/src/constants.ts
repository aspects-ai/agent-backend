/**
 * Application-wide constants and configuration
 */

/**
 * Supported backend types
 */
export const BACKEND_TYPES = ['local', 'remote'] as const
export type BackendType = typeof BACKEND_TYPES[number]

/**
 * Supported shell types for local backend
 */
export const SHELL_TYPES = ['bash', 'sh', 'auto'] as const
export type ShellType = typeof SHELL_TYPES[number]

/**
 * Authentication types for remote backend
 */
export const AUTH_TYPES = ['key', 'password'] as const
export type AuthType = typeof AUTH_TYPES[number]

/**
 * Default values for configuration
 */
export const DEFAULTS = {
  PREVENT_DANGEROUS: true,
  SHELL: 'auto' as ShellType,
  VALIDATE_UTILS: false,
} as const

/**
 * Error codes used throughout the application
 */
export const ERROR_CODES = {
  // Backend errors
  BACKEND_NOT_IMPLEMENTED: 'BACKEND_NOT_IMPLEMENTED',
  UNSUPPORTED_BACKEND: 'UNSUPPORTED_BACKEND',
  UNKNOWN_BACKEND: 'UNKNOWN_BACKEND',
  INVALID_CONFIGURATION: 'INVALID_CONFIGURATION',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',

  // Filesystem errors
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  MISSING_UTILITIES: 'MISSING_UTILITIES',
  ABSOLUTE_PATH_REJECTED: 'ABSOLUTE_PATH_REJECTED',
  PATH_ESCAPE_ATTEMPT: 'PATH_ESCAPE_ATTEMPT',

  // Operation errors
  EXEC_FAILED: 'EXEC_FAILED',
  EXEC_ERROR: 'EXEC_ERROR',
  READ_FAILED: 'READ_FAILED',
  WRITE_FAILED: 'WRITE_FAILED',
  LS_FAILED: 'LS_FAILED',

  // Validation errors
  EMPTY_COMMAND: 'EMPTY_COMMAND',
  EMPTY_PATH: 'EMPTY_PATH',
  DANGEROUS_OPERATION: 'DANGEROUS_OPERATION',
} as const

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]
