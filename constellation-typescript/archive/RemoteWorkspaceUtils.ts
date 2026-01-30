import { clearTimeout, setTimeout } from 'node:timers'
import type { Client } from 'ssh2'
import { ConstellationFS } from '../config/Config.js'
import { ERROR_CODES } from '../constants.js'
import { FileSystemError } from '../types.js'
import { getLogger } from './logger.js'

/**
 * Utility functions for managing user workspace directories on remote filesystems via SSH
 */
export class RemoteWorkspaceUtils {
  /**
   * Get the workspace path for a specific user on remote system
   * @param path - The path to the workspace
   * @returns Absolute path to the user's workspace on remote system
   */
  static getUserWorkspacePath(path: string): string {
    // Use POSIX path joining for remote systems (same structure as local)
    return `${ConstellationFS.getWorkspaceRoot()}/${path}`
  }

  /**
   * Ensure a user's workspace directory exists on remote filesystem
   * @param sshClient - SSH client connection to use
   * @param path - The path to the workspace
   * @returns Promise resolving to absolute path of the created/existing workspace
   */
  static async ensureUserWorkspace(sshClient: Client, path: string): Promise<string> {
    const workspacePath = RemoteWorkspaceUtils.getUserWorkspacePath(path)

    // Create directory via SSH if it doesn't exist
    const command = `mkdir -p "${workspacePath}"`

    return new Promise((resolve, reject) => {
      sshClient.exec(command, (err, stream) => {
        if (err) {
          reject(new FileSystemError(
            `Failed to create remote workspace: ${err.message}`,
            ERROR_CODES.EXEC_FAILED,
            command
          ))
          return
        }

        let stderr = ''
        let resolved = false

        // Add timeout as safety measure
        const timeout = setTimeout(() => {
          if (!resolved) {
            getLogger().debug('[RemoteWorkspaceUtils] Timeout waiting for command completion, assuming success')
            resolved = true
            resolve(workspacePath) // Assume success if command was sent
          }
        }, 5000) // 5 second timeout

        const handleCompletion = (code: number, source: string) => {
          if (!resolved) {
            clearTimeout(timeout)
            resolved = true
            getLogger().debug(`[RemoteWorkspaceUtils] Command completed via ${source} with code: ${code}`)
            if (code === 0) {
              getLogger().debug(`Remote workspace ensured: ${workspacePath}`)
              resolve(workspacePath)
            } else {
              reject(new FileSystemError(
                `Failed to create remote workspace (exit code ${code}): ${stderr || 'Unknown error'}`,
                ERROR_CODES.EXEC_FAILED,
                command
              ))
            }
          }
        }

        stream.on('close', (code: number) => handleCompletion(code, 'close'))
        stream.on('exit', (code: number) => handleCompletion(code, 'exit'))

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })
      })
    })
  }

  /**
   * Check if a user workspace exists on remote filesystem
   * @param sshClient - SSH client connection to use
   * @param path - The path to the workspace
   * @returns Promise resolving to true if the workspace exists
   */
  static async workspaceExists(sshClient: Client, path: string): Promise<boolean> {
    const workspacePath = RemoteWorkspaceUtils.getUserWorkspacePath(path)

    // Test if directory exists via SSH
    const command = `test -d "${workspacePath}"`

    return new Promise((resolve, reject) => {
      sshClient.exec(command, (err, stream) => {
        if (err) {
          reject(new FileSystemError(
            `Failed to check remote workspace: ${err.message}`,
            ERROR_CODES.EXEC_FAILED,
            command
          ))
          return
        }

        stream.on('close', (code: number) => {
          // test command returns 0 if directory exists, 1 if it doesn't
          resolve(code === 0)
        })
        .on('data', () => {
          // Consume stdout but ignore it for test command
        })
        .stderr.on('data', () => {
          // Consume stderr but ignore it for test command
        })
      })
    })
  }

  /**
   * Validate a workspace path for safe directory naming
   * @param path - The path to the workspace to validate
   * @throws Error if path is invalid
   */
  static validateWorkspacePath(path: string): void {
    if (!path || path.trim().length === 0) {
      throw new Error('Workspace path cannot be empty')
    }
    
    // Only allow alphanumeric, hyphens, underscores, and periods
    const validChars = /^[a-zA-Z0-9._-]+$/
    if (!validChars.test(path)) {
      throw new Error(`Workspace path '${path}' can only contain letters, numbers, hyphens, underscores, and periods`)
    }
    
    // Prevent directory traversal
    if (path.includes('..') || path.includes('./') || path.includes('/') || path.includes('\\')) {
      throw new Error('Workspace path cannot contain path traversal sequences')
    }
  }

  /**
   * Validate a user ID for safe directory naming
   * This is the same logic as LocalWorkspaceUtils since it doesn't require SSH
   * @param userId - The user identifier to validate
   * @throws Error if userId is invalid
   */
  static validateUserId(userId: string): void {
    if (!userId || userId.trim().length === 0) {
      throw new Error('User ID cannot be empty')
    }

    // Only allow alphanumeric, hyphens, underscores, and periods
    const validChars = /^[a-zA-Z0-9._-]+$/
    if (!validChars.test(userId)) {
      throw new Error(`User ID '${userId}' can only contain letters, numbers, hyphens, underscores, and periods`)
    }

    // Prevent directory traversal
    if (userId.includes('..') || userId.includes('./') || userId.includes('/') || userId.includes('\\')) {
      throw new Error('User ID cannot contain path traversal sequences')
    }
  }
}
