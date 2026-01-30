// Re-export from backends module
export { BackendType } from './backends/index.js'
export type {
  Backend,
  FileBasedBackend,
  FileSystemBackend,
  ScopedBackend,
  ScopedFileBasedBackend
} from './backends/index.js'

export {
  BackendConfigSchema,
  validateLocalBackendConfig,
  validateLocalFilesystemBackendConfig,
  validateRemoteFilesystemBackendConfig,
  validateMemoryBackendConfig
} from './backends/index.js'
export type {
  BackendConfig,
  LocalBackendConfig,
  RemoteBackendConfig,
  LocalFilesystemBackendConfig,
  RemoteFilesystemBackendConfig,
  MemoryBackendConfig,
  ScopeConfig,
  ExecOptions,
  ReadOptions
} from './backends/index.js'

/**
 * File metadata information returned by detailed directory listings
 */
export interface FileInfo {
  /** The name of the file or directory */
  name: string
  /** The type of filesystem entry */
  type: 'file' | 'directory' | 'symlink'
  /** Size in bytes */
  size: number
  /** Last modified timestamp */
  modified: Date
}

/**
 * Main interface for filesystem operations
 * Provides a consistent API for executing commands and manipulating files
 * regardless of the underlying backend implementation (local, remote, docker)
 */
export interface FileSystemInterface {
  /**
   * Execute a shell command in the workspace
   * @param command - The shell command to execute
   * @returns Promise resolving to the command output
   * @throws {FileSystemError} When command execution fails
   * @throws {DangerousOperationError} When dangerous operations are blocked
   */
  exec(command: string): Promise<string>

  /**
   * Read the contents of a file
   * @param path - Relative path to the file within the workspace
   * @returns Promise resolving to the file contents as UTF-8 string
   * @throws {FileSystemError} When file cannot be read or doesn't exist
   */
  read(path: string): Promise<string>

  /**
   * Write content to a file
   * @param path - Relative path to the file within the workspace
   * @param content - Content to write to the file as string or Buffer
   * @returns Promise that resolves when the write is complete
   * @throws {FileSystemError} When file cannot be written
   */
  write(path: string, content: string | Buffer): Promise<void>

  /**
   * Create a directory
   * @param path - Relative path to the directory within the workspace
   * @param recursive - Create parent directories if they don't exist (default: true)
   * @returns Promise that resolves when the directory is created
   * @throws {FileSystemError} When directory cannot be created
   */
  mkdir(path: string, recursive?: boolean): Promise<void>

  /**
   * Create an empty file
   * @param path - Relative path to the file within the workspace
   * @returns Promise that resolves when the file is created
   * @throws {FileSystemError} When file cannot be created
   */
  touch(path: string): Promise<void>

}

/**
 * Base error class for all backend operations
 */
export class BackendError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly operation?: string,
  ) {
    super(message)
    this.name = 'BackendError'
  }
}

/**
 * Error thrown when a dangerous operation is blocked
 */
export class DangerousOperationError extends BackendError {
  constructor(command: string) {
    super(
      `Dangerous operation blocked: ${command}`,
      'DANGEROUS_OPERATION',
      command,
    )
    this.name = 'DangerousOperationError'
  }
}

/**
 * Error thrown when an operation is not implemented for a backend type
 */
export class NotImplementedError extends BackendError {
  constructor(operation: string, backendType: string) {
    super(
      `Operation '${operation}' not implemented for ${backendType} backend`,
      'NOT_IMPLEMENTED',
      operation,
    )
    this.name = 'NotImplementedError'
  }
}

/**
 * Error thrown when a path attempts to escape the scope boundary
 */
export class PathEscapeError extends BackendError {
  constructor(path: string) {
    super(
      `Path escapes scope boundary: ${path}`,
      'PATH_ESCAPE_ATTEMPT',
      path,
    )
    this.name = 'PathEscapeError'
  }
}

// Legacy alias for backward compatibility during migration
export const FileSystemError = BackendError
