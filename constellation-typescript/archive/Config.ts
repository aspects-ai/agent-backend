import { getLogger } from '../utils/logger'

/**
 * Library-level configuration interface for ConstellationFS
 */
export interface LibraryConfig {
  /** Base mount directory for all ConstellationFS workspaces. Defaults to /constellationfs */
  workspaceRoot?: string
}

/**
 * Static configuration manager for ConstellationFS library.
 *
 * @example
 * ```typescript
 * // Set config at app startup
 * ConstellationFS.setConfig({ workspaceRoot: '/customWorkspaceRoot' })
 *
 * // Access config anywhere
 * const config = ConstellationFS.getConfig()
 * const workspaceRoot = ConstellationFS.getWorkspaceRoot()
 * ```
 */
export class ConstellationFS {
  private static config: LibraryConfig | null = null

  private constructor() {
    // Prevent instantiation
  }

  /**
   * Set configuration programmatically. Must be called before using ConstellationFS.
   * @param config Configuration to apply
   */
  static setConfig(config: Partial<LibraryConfig>): void {
    ConstellationFS.config = {
      workspaceRoot: config.workspaceRoot || '/constellation-fs',
    }
    getLogger().info('ConstellationFS configuration set:', ConstellationFS.config)
  }

  /**
   * Get the full configuration object.
   * @throws {Error} If setConfig() has not been called
   */
  static getConfig(): Readonly<LibraryConfig> {
    if (!ConstellationFS.config) {
      throw new Error('ConstellationFS.setConfig() must be called before use')
    }
    return { ...ConstellationFS.config }
  }

  /**
   * Get the workspace root directory.
   * @throws {Error} If setConfig() has not been called
   */
  static getWorkspaceRoot(): string {
    if (!ConstellationFS.config) {
      throw new Error('ConstellationFS.setConfig() must be called before use')
    }
    return ConstellationFS.config.workspaceRoot!
  }

  /**
   * Reset configuration (useful for testing)
   */
  static reset(): void {
    ConstellationFS.config = null
  }
}
