import type { LocalFilesystemBackendConfig, RemoteFilesystemBackendConfig } from 'agent-backend'

export type BackendConfig = {
  type: 'local' | 'remote'
  local?: LocalFilesystemBackendConfig
  remote?: RemoteFilesystemBackendConfig
}

// Default configurations matching daemon defaults
export const DEFAULT_LOCAL_CONFIG: LocalFilesystemBackendConfig = {
  rootDir: '/tmp/agentbe-workspace',
  isolation: 'software',
}

export const DEFAULT_REMOTE_CONFIG: RemoteFilesystemBackendConfig = {
  host: 'localhost',
  sshPort: 2222,
  mcpPort: 3001,
  rootDir: '/var/workspace',
  sshAuth: {
    type: 'password',
    credentials: {
      username: 'root',
      password: 'agents',
    },
  },
}

class BackendConfigManager {
  private config: BackendConfig = {
    type: 'local',
    local: DEFAULT_LOCAL_CONFIG,
    remote: DEFAULT_REMOTE_CONFIG,
  }

  getConfig(): BackendConfig {
    return this.config
  }

  setConfig(config: BackendConfig): void {
    this.config = config
  }

  reset(): void {
    this.config = {
      type: 'local',
      local: DEFAULT_LOCAL_CONFIG,
      remote: DEFAULT_REMOTE_CONFIG,
    }
  }
}

export const backendConfig = new BackendConfigManager()
