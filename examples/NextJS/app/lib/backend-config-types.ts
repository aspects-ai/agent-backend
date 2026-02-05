import type { LocalFilesystemBackendConfig, RemoteFilesystemBackendConfig } from 'agent-backend'

export type BackendConfig = {
  type: 'local' | 'remote'
  local?: LocalFilesystemBackendConfig
  remote?: RemoteFilesystemBackendConfig
  /** Optional scope subdirectory - if set, backend is scoped to this path within rootDir */
  scope?: string
}

// Default configurations matching daemon defaults
export const DEFAULT_LOCAL_CONFIG: LocalFilesystemBackendConfig = {
  rootDir: '/tmp/workspace',
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

export const COOKIE_NAME = 'backend-config'

export function getDefaultConfig(): BackendConfig {
  return {
    type: 'local',
    local: DEFAULT_LOCAL_CONFIG,
    remote: DEFAULT_REMOTE_CONFIG,
  }
}
