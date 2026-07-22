import { describe, expect, it } from 'vitest'
import { parseDaemonArgs, validateDaemonConfig, type DaemonConfig } from '../../../src/cli/daemon-config.js'

describe('Daemon Config Parsing', () => {
  describe('parseDaemonArgs', () => {
    describe('Required Arguments', () => {
      it('should require --rootDir', () => {
        const result = parseDaemonArgs([])
        expect(result.error).toBe('--rootDir is required')
        expect(result.config).toBeUndefined()
      })

      it('should parse --rootDir correctly', () => {
        const result = parseDaemonArgs(['--rootDir', '/var/workspace'])
        expect(result.error).toBeUndefined()
        expect(result.config?.rootDir).toBe('/var/workspace')
      })

      it('should error if --rootDir has no value', () => {
        const result = parseDaemonArgs(['--rootDir'])
        expect(result.error).toBe('--rootDir requires a value')
      })

      it('should error if --rootDir value looks like a flag', () => {
        const result = parseDaemonArgs(['--rootDir', '--other'])
        expect(result.error).toBe('--rootDir requires a value')
      })
    })

    describe('Default Values', () => {
      it('should use default port of 3001', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp'])
        expect(result.config?.port).toBe(3001)
      })

      it('should use default sshUsers of root:agents', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp'])
        expect(result.config?.sshUsers).toEqual([{ username: 'root', password: 'agents' }])
      })

      it('should default localOnly to false', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp'])
        expect(result.config?.localOnly).toBe(false)
      })
    })

    describe('Server Options', () => {
      it('should parse --port', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--port', '8080'])
        expect(result.config?.port).toBe(8080)
      })

      it('should reject port below 1024', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--port', '80'])
        expect(result.error).toBe('--port must be between 1024-65535')
      })

      it('should reject port above 65535', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--port', '70000'])
        expect(result.error).toBe('--port must be between 1024-65535')
      })

      it('should reject non-numeric port', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--port', 'abc'])
        expect(result.error).toBe('--port must be between 1024-65535')
      })

      it('should parse --auth-token', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--auth-token', 'secret123'])
        expect(result.config?.authToken).toBe('secret123')
      })
    })

    describe('Local-Only Mode', () => {
      it('should parse --local-only flag', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--local-only'])
        expect(result.config?.localOnly).toBe(true)
      })
    })

    describe('Scope Path Options', () => {
      it('should parse --scopePath', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--scopePath', 'users/user1'])
        expect(result.config?.scopePath).toBe('users/user1')
      })

      it('should strip leading slashes from scopePath', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--scopePath', '/users/user1'])
        expect(result.config?.scopePath).toBe('users/user1')
      })

      it('should strip multiple leading slashes from scopePath', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--scopePath', '///users/user1'])
        expect(result.config?.scopePath).toBe('users/user1')
      })

      it('should reject scopePath with path traversal', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--scopePath', 'users/../etc'])
        expect(result.error).toContain('path traversal')
      })

      it('should reject scopePath with double dots', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--scopePath', '..'])
        expect(result.error).toContain('path traversal')
      })

      it('should error if --scopePath has no value', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--scopePath'])
        expect(result.error).toBe('--scopePath requires a value')
      })

      it('should error if --scopePath value looks like a flag', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--scopePath', '--other'])
        expect(result.error).toBe('--scopePath requires a value')
      })
    })

    describe('Isolation Options', () => {
      it('should parse --isolation auto', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--isolation', 'auto'])
        expect(result.config?.isolation).toBe('auto')
      })

      it('should parse --isolation bwrap', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--isolation', 'bwrap'])
        expect(result.config?.isolation).toBe('bwrap')
      })

      it('should parse --isolation software', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--isolation', 'software'])
        expect(result.config?.isolation).toBe('software')
      })

      it('should parse --isolation none', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--isolation', 'none'])
        expect(result.config?.isolation).toBe('none')
      })

      it('should reject invalid isolation mode', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--isolation', 'invalid'])
        expect(result.error).toContain('Invalid isolation mode')
      })
    })

    describe('Shell Options', () => {
      it('should parse --shell bash', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--shell', 'bash'])
        expect(result.config?.shell).toBe('bash')
      })

      it('should parse --shell sh', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--shell', 'sh'])
        expect(result.config?.shell).toBe('sh')
      })

      it('should parse --shell auto', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--shell', 'auto'])
        expect(result.config?.shell).toBe('auto')
      })

      it('should reject invalid shell', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--shell', 'zsh'])
        expect(result.error).toContain('Invalid shell')
      })
    })

    describe('SSH User Options', () => {
      it('should parse --ssh-users with single user', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--ssh-users', 'alice:secret'])
        expect(result.config?.sshUsers).toEqual([{ username: 'alice', password: 'secret' }])
      })

      it('should parse --ssh-users with multiple users', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--ssh-users', 'alice:pass1,bob:pass2'])
        expect(result.config?.sshUsers).toEqual([
          { username: 'alice', password: 'pass1' },
          { username: 'bob', password: 'pass2' }
        ])
      })

      it('should trim whitespace from usernames and passwords', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--ssh-users', ' alice : pass1 '])
        expect(result.config?.sshUsers).toEqual([{ username: 'alice', password: 'pass1' }])
      })

      it('should reject invalid ssh-users format (missing password)', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--ssh-users', 'alice'])
        expect(result.error).toContain('Invalid --ssh-users format')
      })

      it('should reject invalid ssh-users format (missing colon)', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--ssh-users', 'alice,bob'])
        expect(result.error).toContain('Invalid --ssh-users format')
      })

      it('should parse --ssh-public-key', () => {
        const key = 'ssh-rsa AAAAB3... user@host'
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--ssh-public-key', key])
        expect(result.config?.sshPublicKey).toBe(key)
      })

      it('should parse --ssh-authorized-keys', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--ssh-authorized-keys', '/path/to/keys'])
        expect(result.config?.sshAuthorizedKeys).toBe('/path/to/keys')
      })
    })

    describe('Unrecognized Options', () => {
      it('should reject unrecognized options', () => {
        const result = parseDaemonArgs(['--rootDir', '/tmp', '--unknown-option'])
        expect(result.error).toBe('Unrecognized option: --unknown-option')
      })

      it('should ignore non-flag arguments', () => {
        // Non-flag arguments (not starting with --) are silently ignored
        const result = parseDaemonArgs(['--rootDir', '/tmp', 'extra-arg'])
        expect(result.error).toBeUndefined()
        expect(result.config?.rootDir).toBe('/tmp')
      })
    })

    describe('Complex Argument Combinations', () => {
      it('should parse full daemon config', () => {
        const result = parseDaemonArgs([
          '--rootDir', '/var/workspace',
          '--port', '3001',
          '--auth-token', 'secret',
          '--isolation', 'software',
          '--shell', 'bash',
          '--ssh-users', 'root:agents,dev:devpass'
        ])

        expect(result.error).toBeUndefined()
        expect(result.config).toEqual({
          rootDir: '/var/workspace',
          port: 3001,
          authToken: 'secret',
          isolation: 'software',
          shell: 'bash',
          localOnly: false,
          sshUsers: [
            { username: 'root', password: 'agents' },
            { username: 'dev', password: 'devpass' }
          ]
        })
      })

      it('should parse local-only mode config', () => {
        const result = parseDaemonArgs([
          '--rootDir', '/tmp/agentbe-workspace',
          '--local-only',
          '--isolation', 'none'
        ])

        expect(result.error).toBeUndefined()
        expect(result.config?.localOnly).toBe(true)
        expect(result.config?.isolation).toBe('none')
      })

      it('should parse local-only mode with scopePath', () => {
        const result = parseDaemonArgs([
          '--rootDir', '/tmp/agentbe-workspace',
          '--scopePath', 'users/user123',
          '--local-only'
        ])

        expect(result.error).toBeUndefined()
        expect(result.config?.rootDir).toBe('/tmp/agentbe-workspace')
        expect(result.config?.scopePath).toBe('users/user123')
        expect(result.config?.localOnly).toBe(true)
      })
    })
  })

  describe('validateDaemonConfig', () => {
    it('should return null for valid config', () => {
      const config: DaemonConfig = {
        rootDir: '/tmp',
        port: 3001,
        localOnly: false,
        sshUsers: [{ username: 'root', password: 'agents' }]
      }
      expect(validateDaemonConfig(config)).toBeNull()
    })

    it('should error for missing rootDir', () => {
      const config: DaemonConfig = {
        port: 3001,
        localOnly: false,
        sshUsers: []
      }
      expect(validateDaemonConfig(config)).toBe('--rootDir is required')
    })

    it('should error for invalid port', () => {
      const config: DaemonConfig = {
        rootDir: '/tmp',
        port: 80,
        localOnly: false,
        sshUsers: []
      }
      expect(validateDaemonConfig(config)).toBe('--port must be between 1024-65535')
    })

    it('should error for invalid isolation mode', () => {
      const config: DaemonConfig = {
        rootDir: '/tmp',
        port: 3001,
        localOnly: false,
        sshUsers: [],
        isolation: 'invalid' as any
      }
      expect(validateDaemonConfig(config)).toContain('Invalid isolation mode')
    })

    it('should error for invalid shell', () => {
      const config: DaemonConfig = {
        rootDir: '/tmp',
        port: 3001,
        localOnly: false,
        sshUsers: [],
        shell: 'zsh' as any
      }
      expect(validateDaemonConfig(config)).toContain('Invalid shell')
    })
  })
})
