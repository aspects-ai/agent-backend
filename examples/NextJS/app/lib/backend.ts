import type { FileBasedBackend } from 'agent-backend'
import { LocalFilesystemBackend, RemoteFilesystemBackend, ScopedFilesystemBackend } from 'agent-backend'
import { getBackendConfig } from './backend-config'

class BackendManager {
  private backend: FileBasedBackend | null = null
  private connecting: Promise<void> | null = null
  private currentType: 'local' | 'remote' | null = null
  private currentScope: string | undefined = undefined

  async getBackend(): Promise<FileBasedBackend> {
    const config = await getBackendConfig()
    console.log('[BackendManager] getBackend called, config type:', config.type, 'scope:', config.scope, 'current cached type:', this.currentType, 'cached scope:', this.currentScope)

    if (this.backend && this.currentType === config.type && this.currentScope === config.scope) {
      console.log('[BackendManager] Returning cached backend')
      return this.backend
    }

    // Config type or scope changed, need to reinitialize
    if (this.backend && (this.currentType !== config.type || this.currentScope !== config.scope)) {
      console.log('[BackendManager] Config changed, reinitializing...')
      await this.disconnect()
    }

    if (this.connecting) {
      await this.connecting
      return this.backend!
    }

    this.connecting = this.initializeBackend()
    await this.connecting
    this.connecting = null

    return this.backend!
  }

  getCurrentType(): 'local' | 'remote' {
    return this.currentType || 'local'
  }

  async switchBackend(type: 'local' | 'remote'): Promise<void> {
    // Disconnect current backend
    await this.disconnect()

    // Force reinitialization with new type
    this.currentType = type
    await this.getBackend()
  }

  private async initializeBackend(): Promise<void> {
    const config = await getBackendConfig()
    console.log('[BackendManager] initializeBackend, config:', JSON.stringify(config, null, 2))
    this.currentType = config.type
    this.currentScope = config.scope

    if (config.type === 'remote' && config.remote) {
      const remote = config.remote
      console.log('[BackendManager] Creating RemoteFilesystemBackend')

      if (!remote.host) {
        throw new Error('Remote backend requires host')
      }

      // SSH-WS transport with unified auth
      this.backend = new RemoteFilesystemBackend({
        ...remote,
        transport: 'ssh-ws',
      })
    } else {
      const local = config.local || {
        rootDir: '/tmp/workspace',
        isolation: 'software',
      }
      console.log('[BackendManager] Creating LocalFilesystemBackend with rootDir:', local.rootDir)

      this.backend = new LocalFilesystemBackend({
        rootDir: local.rootDir,
        isolation: local.isolation || 'software',
      })
    }

    console.log('[BackendManager] Backend created, type:', this.backend.type)

    // LocalFilesystemBackend doesn't need explicit connect
    if ('connect' in this.backend && typeof this.backend.connect === 'function') {
      console.log('[BackendManager] Connecting to backend...')
      await this.backend.connect()
      console.log('[BackendManager] Connected')
    }

    // Apply scope if configured
    if (config.scope) {
      console.log('[BackendManager] Applying scope:', config.scope)
      // ScopedFilesystemBackend lazily creates root directory on first write operation
      this.backend = this.backend.scope(config.scope)
      console.log('[BackendManager] Backend scoped to:', config.scope)
    }
  }

  async disconnect(): Promise<void> {
    if (this.backend) {
      await this.backend.destroy()
      // Since we only have a single backend instance, we should destroy the parent backend if it exists as well.
      if (this.backend instanceof ScopedFilesystemBackend) {
        await this.backend.parent.destroy()
      }
      this.backend = null
      this.currentScope = undefined
    }
  }
}

export const backendManager = new BackendManager()
