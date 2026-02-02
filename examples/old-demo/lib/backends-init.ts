import { AgentBackend, FileSystem, type LocalBackendConfig, type RemoteBackendConfig } from 'agent-backend'

/**
 * Initialize AgentBackend configuration (call once at startup)
 */
export function initAgentBackend() {
  if (!process.env.AGENTBE_WORKSPACE_ROOT) {
    throw new Error("Missing AGENTBE_WORKSPACE_ROOT environment variable")
  }
  AgentBackend.setConfig({
    workspaceRoot: process.env.AGENTBE_WORKSPACE_ROOT
  })
}

/**
 * Check if MCP mode is enabled
 */
export function isMCPMode(): boolean {
  return process.env.USE_MCP === 'true'
}

/**
 * Create a FileSystem instance with proper backend configuration.
 *
 * For remote backends, also configures MCP auth if REMOTE_MCP_AUTH_TOKEN is set,
 * enabling use of fs.getMCPTransport() for Vercel AI SDK integration.
 */
export function createFileSystem(sessionId: string): FileSystem {
  const backendType = (process.env.NEXT_PUBLIC_AGENTBE_BACKEND_TYPE as 'local' | 'remote') || 'local'

  if (backendType === 'remote') {
    const remoteHost = process.env.REMOTE_VM_HOST
    if (!remoteHost) {
      throw new Error('REMOTE_VM_HOST environment variable is required for remote backend')
    }

    const backendConfig: RemoteBackendConfig = {
      type: 'remote',
      host: remoteHost,
      userId: sessionId,
      preventDangerous: true,
      sshAuth: {
        type: 'password',
        credentials: {
          username: process.env.REMOTE_VM_USER || 'root',
          password: process.env.REMOTE_VM_PASSWORD || 'agents'
        }
      },
      sshPort: process.env.REMOTE_VM_SSH_PORT ? parseInt(process.env.REMOTE_VM_SSH_PORT) : 2222,
      mcpAuth: process.env.REMOTE_MCP_AUTH_TOKEN ? { token: process.env.REMOTE_MCP_AUTH_TOKEN } : undefined,
      mcpPort: process.env.REMOTE_MCP_PORT ? parseInt(process.env.REMOTE_MCP_PORT) : 3001,
    }
    console.log('Using remote backend config:', {
      ...backendConfig,
      sshAuth: {
        ...backendConfig.sshAuth,
        credentials: {
          username: (backendConfig.sshAuth.credentials as Record<string, unknown>).username,
          password: '[REDACTED]'
        }
      },
      mcpAuth: backendConfig.mcpAuth ? { token: '[REDACTED]' } : undefined
    })
    return new FileSystem(backendConfig)
  } else {
    const backendConfig: LocalBackendConfig = {
      type: 'local',
      userId: sessionId,
      shell: 'auto',
      validateUtils: false,
      preventDangerous: true
    }
    console.log('Using local backend config')
    return new FileSystem(backendConfig)
  }
}
