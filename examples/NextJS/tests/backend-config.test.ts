import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
    COOKIE_NAME,
    DEFAULT_LOCAL_CONFIG,
    DEFAULT_REMOTE_CONFIG,
    getDefaultConfig,
    type BackendConfig
} from '../app/lib/backend-config-types'

describe('Backend Config Types', () => {
  describe('Constants', () => {
    it('should have correct COOKIE_NAME', () => {
      expect(COOKIE_NAME).toBe('backend-config')
    })

    it('should have correct DEFAULT_LOCAL_CONFIG', () => {
      expect(DEFAULT_LOCAL_CONFIG).toEqual({
        rootDir: '/tmp/agentbe-workspace',
        isolation: 'software',
      })
    })

    it('should have correct DEFAULT_REMOTE_CONFIG', () => {
      expect(DEFAULT_REMOTE_CONFIG).toEqual({
        host: 'localhost',
        port: 3001,
        rootDir: '/var/workspace',
        transport: 'ssh-ws',
        authToken: '',
      })
    })
  })

  describe('getDefaultConfig', () => {
    it('should return default config with type "local"', () => {
      const config = getDefaultConfig()
      expect(config.type).toBe('local')
    })

    it('should include local config', () => {
      const config = getDefaultConfig()
      expect(config.local).toEqual(DEFAULT_LOCAL_CONFIG)
    })

    it('should include remote config', () => {
      const config = getDefaultConfig()
      expect(config.remote).toEqual(DEFAULT_REMOTE_CONFIG)
    })

    it('should return a new object each time (not same reference)', () => {
      const config1 = getDefaultConfig()
      const config2 = getDefaultConfig()
      expect(config1).not.toBe(config2)
      expect(config1).toEqual(config2)
    })
  })

  describe('BackendConfig type', () => {
    it('should allow local type config', () => {
      const config: BackendConfig = {
        type: 'local',
        local: DEFAULT_LOCAL_CONFIG
      }
      expect(config.type).toBe('local')
    })

    it('should allow remote type config', () => {
      const config: BackendConfig = {
        type: 'remote',
        remote: DEFAULT_REMOTE_CONFIG
      }
      expect(config.type).toBe('remote')
    })

    it('should allow config with both local and remote', () => {
      const config: BackendConfig = {
        type: 'local',
        local: DEFAULT_LOCAL_CONFIG,
        remote: DEFAULT_REMOTE_CONFIG
      }
      expect(config.local).toBeDefined()
      expect(config.remote).toBeDefined()
    })
  })
})

// Mock next/headers for testing getBackendConfig
vi.mock('next/headers', () => ({
  cookies: vi.fn()
}))

describe('Backend Config (with Next.js mocks)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset module cache to get fresh imports
    vi.resetModules()
  })

  describe('getBackendConfig', () => {
    it('should return default config when no cookie exists', async () => {
      const { cookies } = await import('next/headers')
      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined)
      } as any)

      const { getBackendConfig } = await import('../app/lib/backend-config')
      const config = await getBackendConfig()

      expect(config.type).toBe('local')
      expect(config.local).toEqual(DEFAULT_LOCAL_CONFIG)
    })

    it('should return config from cookie when it exists', async () => {
      const storedConfig: BackendConfig = {
        type: 'remote',
        local: DEFAULT_LOCAL_CONFIG,
        remote: DEFAULT_REMOTE_CONFIG
      }

      const { cookies } = await import('next/headers')
      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue({
          value: JSON.stringify(storedConfig)
        })
      } as any)

      const { getBackendConfig } = await import('../app/lib/backend-config')
      const config = await getBackendConfig()

      expect(config.type).toBe('remote')
    })

    it('should return default config when cookie contains invalid JSON', async () => {
      const { cookies } = await import('next/headers')
      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue({
          value: 'invalid-json'
        })
      } as any)

      const { getBackendConfig } = await import('../app/lib/backend-config')
      const config = await getBackendConfig()

      // Should fall back to default
      expect(config.type).toBe('local')
    })

    it('should return default config when cookies() throws', async () => {
      const { cookies } = await import('next/headers')
      vi.mocked(cookies).mockRejectedValue(new Error('Not in request context'))

      const { getBackendConfig } = await import('../app/lib/backend-config')
      const config = await getBackendConfig()

      // Should fall back to default
      expect(config.type).toBe('local')
    })
  })
})

describe('Cookie serialization', () => {
  it('should round-trip config through JSON serialization', () => {
    const config: BackendConfig = {
      type: 'remote',
      local: {
        rootDir: '/custom/local',
        isolation: 'none'
      },
      remote: {
        host: 'custom-host.com',
        sshPort: 3333,
        port: 4444,
        rootDir: '/custom/remote',
        sshAuth: {
          type: 'key',
          credentials: {
            username: 'customuser',
            privateKey: '-----BEGIN RSA PRIVATE KEY-----'
          }
        }
      }
    }

    const serialized = JSON.stringify(config)
    const deserialized = JSON.parse(serialized) as BackendConfig

    expect(deserialized).toEqual(config)
  })

  it('should handle special characters in passwords', () => {
    const config: BackendConfig = {
      type: 'remote',
      remote: {
        host: 'example.com',
        rootDir: '/workspace',
        sshAuth: {
          type: 'password',
          credentials: {
            username: 'user',
            password: 'p@ss"word\'with<special>chars&stuff'
          }
        }
      }
    }

    const serialized = JSON.stringify(config)
    const deserialized = JSON.parse(serialized) as BackendConfig

    expect(deserialized.remote?.sshAuth.credentials.password).toBe('p@ss"word\'with<special>chars&stuff')
  })
})
