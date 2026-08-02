/**
 * Logging mode for workspace operations
 * - 'standard': Only logs potentially modifying operations (exec, write, writeFile, touch, mkdir, delete)
 * - 'verbose': Logs all operations including reads
 */
export type LoggingMode = 'standard' | 'verbose'

/**
 * Operation types that can be logged
 */
export type OperationType =
  | 'exec'
  | 'write'
  | 'writeFile'
  | 'touch'
  | 'mkdir'
  | 'delete'
  | 'read'
  | 'readFile'
  | 'readdir'
  | 'exists'
  | 'stat'
  | 'list'

/**
 * Operations that modify the workspace state
 * Used to filter operations in standard logging mode
 */
export const MODIFYING_OPERATIONS: readonly OperationType[] = [
  'exec',
  'write',
  'writeFile',
  'touch',
  'mkdir',
  'delete',
] as const

/**
 * Entry representing a logged operation
 */
export interface OperationLogEntry {
  /** Timestamp of the operation */
  timestamp: Date

  /** Type of operation performed */
  operation: OperationType

  /** User ID associated with the workspace */
  userId: string

  /** Name of the workspace */
  workspaceName: string

  /** Absolute path to the workspace */
  workspacePath: string

  /** The command or path that was operated on */
  command: string

  /** Standard output (for exec operations) */
  stdout?: string

  /** Standard error (for exec operations) */
  stderr?: string

  /** Exit code (for exec operations) */
  exitCode?: number

  /** Whether the operation succeeded */
  success: boolean

  /** Error message if operation failed */
  error?: string

  /** Duration of the operation in milliseconds */
  durationMs: number
}

/**
 * Interface for workspace operations logger
 * Implement this interface to receive operation logs from workspaces
 */
export interface OperationsLogger {
  /**
   * Log an operation that was performed on a workspace
   * @param entry - The operation log entry
   */
  log(entry: OperationLogEntry): void | Promise<void>

  /**
   * Logging mode determines which operations are logged
   * - 'standard': Only modifying operations (exec, write, writeFile, touch, mkdir, delete)
   * - 'verbose': All operations including reads
   */
  readonly mode: LoggingMode
}

/**
 * Helper function to determine if an operation should be logged based on mode
 * @param operation - The operation type
 * @param mode - The logging mode
 * @returns true if the operation should be logged
 */
export function shouldLogOperation(operation: OperationType, mode: LoggingMode): boolean {
  if (mode === 'verbose') return true
  return MODIFYING_OPERATIONS.includes(operation)
}
