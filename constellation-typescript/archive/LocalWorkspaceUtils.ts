import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { ConstellationFS } from '../config/Config.js'

/**
 * Manages user workspace directories for local filesystem operations
 */
export class LocalWorkspaceUtils {
  /**
   * Get the workspace path for a specific user
   * @param path - The path to the workspace
   * @returns Absolute path to the user's workspace
   */
  static getUserWorkspacePath(path: string): string {
    return join(ConstellationFS.getWorkspaceRoot(), path)
  }

  /**
   * Ensure a user's workspace directory exists on local filesystem
   * @param path - The path to the workspace
   * @returns Absolute path to the created/existing workspace
   */
  static ensureUserWorkspace(path: string): string {
    const workspacePath = this.getUserWorkspacePath(path)
    
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true })
    }
    
    return workspacePath
  }

  /**
   * Check if a user workspace exists on local filesystem
   * @param path - The path to the workspace
   * @returns True if the workspace exists
   */
  static workspaceExists(path: string): boolean {
    const workspacePath = this.getUserWorkspacePath(path)
    return existsSync(workspacePath)
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
}
