import { cookies } from 'next/headers'
import { COOKIE_NAME, getDefaultConfig, type BackendConfig } from './backend-config-types'

// Re-export types and constants for convenience
export * from './backend-config-types'

/**
 * Validate config matches expected interface.
 * Returns true if valid, false if should be discarded.
 */
function isValidConfig(config: unknown): config is BackendConfig {
  if (!config || typeof config !== 'object') return false
  const c = config as Record<string, unknown>

  // Must have valid type
  if (c.type !== 'local' && c.type !== 'remote') return false

  // If local, must have valid local config
  if (c.type === 'local') {
    if (!c.local || typeof c.local !== 'object') return false
    const local = c.local as Record<string, unknown>
    if (typeof local.rootDir !== 'string') return false
  }

  // If remote, must have valid remote config (new format)
  if (c.type === 'remote') {
    if (!c.remote || typeof c.remote !== 'object') return false
    const remote = c.remote as Record<string, unknown>
    if (typeof remote.host !== 'string' || !remote.host) return false
    if (typeof remote.port !== 'number') return false
    if (typeof remote.rootDir !== 'string') return false
  }

  return true
}

/**
 * Get backend config from cookie.
 * Must be called within a request context (route handler, server component, etc.)
 */
export async function getBackendConfig(): Promise<BackendConfig> {
  try {
    const cookieStore = await cookies()
    const configCookie = cookieStore.get(COOKIE_NAME)
    if (configCookie) {
      const rawConfig = JSON.parse(configCookie.value)
      if (isValidConfig(rawConfig)) {
        return rawConfig
      }
      console.warn('[getBackendConfig] Invalid config format, using defaults')
    }
  } catch (e) {
    console.warn('[getBackendConfig] Failed to read config from cookie:', e)
  }
  return getDefaultConfig()
}
