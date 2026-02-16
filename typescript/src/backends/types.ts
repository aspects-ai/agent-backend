import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Stats } from 'fs'
import type { ExecOptions, ReadOptions, ScopeConfig } from './config.js'

/**
 * MCP Transport type - returned by getMCPTransport()
 * Can be StdioClientTransport (local) or StreamableHTTPClientTransport (remote)
 */
export type MCPTransport = Transport

/**
 * Backend type identifier
 */
export enum BackendType {
  LOCAL_FILESYSTEM = 'local-filesystem',
  REMOTE_FILESYSTEM = 'remote-filesystem',
  MEMORY = 'memory',
  DATABASE = 'database',
  API = 'api'
}

/**
 * Connection status for backends
 */
export enum ConnectionStatus {
  CONNECTED = 'connected',
  CONNECTING = 'connecting',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  DESTROYED = 'destroyed',
}

/**
 * Event emitted when connection status changes
 */
export interface StatusChangeEvent {
  from: ConnectionStatus
  to: ConnectionStatus
  timestamp: number
  error?: Error
}

/**
 * Callback for status change events
 */
export type StatusChangeCallback = (event: StatusChangeEvent) => void

/**
 * Function to unsubscribe from status changes
 */
export type Unsubscribe = () => void

/**
 * Base interface for all backend types
 * Generic enough to support filesystems, databases, APIs, etc.
 */
export interface Backend {
  /** Backend type identifier */
  readonly type: BackendType

  /** Current connection status */
  readonly status: ConnectionStatus

  /**
   * Subscribe to connection status changes.
   * Returns an unsubscribe function.
   */
  onStatusChange(cb: StatusChangeCallback): Unsubscribe

  /**
   * Get MCP transport for this backend.
   *
   * Transport type depends on backend:
   * - LocalFilesystemBackend → StdioClientTransport (spawns subprocess)
   * - RemoteFilesystemBackend → StreamableHTTPClientTransport (HTTP)
   * - MemoryBackend → StdioClientTransport (spawns subprocess)
   */
  getMCPTransport(): Promise<MCPTransport>

  /**
   * Get MCP client for this backend
   */
  getMCPClient(): Promise<Client>

  /**
   * Cleanup resources
   */
  destroy(): Promise<void>

  /**
   * Called by child scopes when they are destroyed.
   * Parent should unregister the child and optionally destroy itself if no children remain.
   * @param child - The child backend that was destroyed
   */
  onChildDestroyed(child: Backend): Promise<void>
}

/**
 * Interface for backends that support file-based operations
 * Extends base Backend with filesystem operations and command execution
 *
 * Note: MemoryBackend implements this interface for consistency,
 * but exec() throws NotImplementedError
 */
export interface FileBasedBackend extends Backend {
  /** Root directory or namespace for file-based operations */
  readonly rootDir: string

  /**
   * Get MCP transport for this backend (overrides base to add scopePath)
   * @param scopePath - Optional path to scope transport to
   */
  getMCPTransport(scopePath?: string): Promise<MCPTransport>

  /**
   * Get MCP client for this backend (overrides base to add scopePath)
   * @param scopePath - Optional path to scope MCP client to
   */
  getMCPClient(scopePath?: string): Promise<Client>

  /**
   * Create a scoped backend restricted to a subdirectory
   * @param path - Relative path to scope to
   * @param config - Optional scope configuration
   */
  scope(path: string, config?: ScopeConfig): ScopedBackend<this>

  /**
   * List all active scoped backends created from this backend
   * @returns Array of scope paths for currently active scopes
   */
  listActiveScopes(): Promise<string[]>

  /**
   * Execute a shell command
   * @param command - The shell command to execute
   * @param options - Execution options
   * @throws {NotImplementedError} If backend doesn't support execution (e.g., MemoryBackend)
   */
  exec(command: string, options?: ExecOptions): Promise<string | Buffer>

  /**
   * Read file contents
   * @param path - Relative path to file
   * @param options - Read options including encoding
   */
  read(path: string, options?: ReadOptions): Promise<string | Buffer>

  /**
   * Read file contents (alias for read, matches Node fs.promises API)
   * @param path - Relative path to file
   * @param options - Read options including encoding
   */
  readFile(path: string, options?: ReadOptions): Promise<string | Buffer>

  /**
   * Write content to file
   * @param path - Relative path to file
   * @param content - Content to write
   */
  write(path: string, content: string | Buffer): Promise<void>

  /**
   * Write content to file (alias for write, matches Node fs.promises API)
   * @param path - Relative path to file
   * @param content - Content to write
   */
  writeFile(path: string, content: string | Buffer): Promise<void>

  /**
   * Rename or move a file/directory (matches Node fs.promises API)
   * @param oldPath - Current path
   * @param newPath - New path
   */
  rename(oldPath: string, newPath: string): Promise<void>

  /**
   * Delete files and directories (matches Node fs.promises API)
   * @param path - Path to delete
   * @param options - Options including recursive and force flags
   */
  rm(path: string, options?: { recursive?: boolean, force?: boolean }): Promise<void>

  /**
   * List directory contents
   * @param path - Relative path to directory
   */
  readdir(path: string): Promise<string[]>

  /**
   * List directory contents with stats for each entry.
   * More efficient than calling readdir + stat for each entry,
   * especially for remote backends where SFTP returns stats with readdir.
   * @param path - Relative path to directory
   */
  readdirWithStats(path: string): Promise<{ name: string, stats: Stats }[]>

  /**
   * Create directory
   * @param path - Relative path to directory
   * @param options - Options including recursive flag
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>

  /**
   * Create empty file
   * @param path - Relative path to file
   */
  touch(path: string): Promise<void>

  /**
   * Check if path exists
   * @param path - Relative path to check
   */
  exists(path: string): Promise<boolean>

  /**
   * Get file/directory stats
   * @param path - Relative path
   */
  stat(path: string): Promise<Stats>
}

/**
 * Scoped backend wraps a backend with path restriction
 * Operations are relative to the scope path
 */
export interface ScopedBackend<T extends Backend> extends Backend {
  /** Root directory or namespace for file-based operations */
  readonly rootDir: string

  /** Parent backend this scope was created from */
  readonly parent: T

  /** Relative path of this scope from parent */
  readonly scopePath: string

  /**
   * Get MCP transport for this scoped backend
   * @param scopePath - Optional additional path to scope transport to
   */
  getMCPTransport(scopePath?: string): Promise<MCPTransport>

  /**
   * Get MCP client for this scoped backend
   * @param scopePath - Optional additional path to scope MCP client to
   */
  getMCPClient(scopePath?: string): Promise<Client>

  /**
   * Create a nested scoped backend
   * @param path - Relative path to scope to
   * @param config - Optional scope configuration
   */
  scope(path: string, config?: ScopeConfig): ScopedBackend<T>

  /**
   * List all active scoped backends created from this backend
   * @returns Array of scope paths for currently active scopes
   */
  listActiveScopes(): Promise<string[]>

  /**
   * Execute a shell command
   * @param command - The shell command to execute
   * @param options - Execution options
   * @throws {NotImplementedError} If backend doesn't support execution (e.g., MemoryBackend)
   */
  exec(command: string, options?: ExecOptions): Promise<string | Buffer>

  /**
   * Read file contents
   * @param path - Relative path to file
   * @param options - Read options including encoding
   */
  read(path: string, options?: ReadOptions): Promise<string | Buffer>

  /**
   * Read file contents (alias for read, matches Node fs.promises API)
   * @param path - Relative path to file
   * @param options - Read options including encoding
   */
  readFile(path: string, options?: ReadOptions): Promise<string | Buffer>

  /**
   * Write content to file
   * @param path - Relative path to file
   * @param content - Content to write
   */
  write(path: string, content: string | Buffer): Promise<void>

  /**
   * Write content to file (alias for write, matches Node fs.promises API)
   * @param path - Relative path to file
   * @param content - Content to write
   */
  writeFile(path: string, content: string | Buffer): Promise<void>

  /**
   * Rename or move a file/directory (matches Node fs.promises API)
   * @param oldPath - Current path
   * @param newPath - New path
   */
  rename(oldPath: string, newPath: string): Promise<void>

  /**
   * Delete files and directories (matches Node fs.promises API)
   * @param path - Path to delete
   * @param options - Options including recursive and force flags
   */
  rm(path: string, options?: { recursive?: boolean, force?: boolean }): Promise<void>

  /**
   * List directory contents
   * @param path - Relative path to directory
   */
  readdir(path: string): Promise<string[]>

  /**
   * List directory contents with stats for each entry.
   * More efficient than calling readdir + stat for each entry,
   * especially for remote backends where SFTP returns stats with readdir.
   * @param path - Relative path to directory
   */
  readdirWithStats(path: string): Promise<{ name: string, stats: Stats }[]>

  /**
   * Create directory
   * @param path - Relative path to directory
   * @param options - Options including recursive flag
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>

  /**
   * Create empty file
   * @param path - Relative path to file
   */
  touch(path: string): Promise<void>

  /**
   * Check if path exists
   * @param path - Relative path to check
   */
  exists(path: string): Promise<boolean>

  /**
   * Get file/directory stats
   * @param path - Relative path
   */
  stat(path: string): Promise<Stats>
}

/**
 * Scoped backend for file-based backends
 * Note: ScopedBackend already includes all FileBasedBackend operations
 * This type alias is provided for clarity
 */
export type ScopedFileBasedBackend<T extends FileBasedBackend> = ScopedBackend<T>
