'use client'

import { DEFAULT_REMOTE_CONFIG, type BackendConfig } from '@/lib/backend-config-types'
import { Eye, EyeOff, Server, Settings, Wifi, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function BackendSettings() {
  const [isOpen, setIsOpen] = useState(false)
  const [config, setConfig] = useState<BackendConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (isOpen && !config) {
      loadConfig()
    }
  }, [isOpen])

  const loadConfig = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/backend-config')
      const data = await response.json()
      setConfig(data)
    } catch (error) {
      console.error('Failed to load config:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!config) return

    setSaving(true)
    try {
      const response = await fetch('/api/backend-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      if (response.ok) {
        setIsOpen(false)
        // Reload page to reinitialize backend
        window.location.reload()
      } else {
        const data = await response.json()
        alert(`Failed to save: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to save config:', error)
      alert('Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="p-2 hover:bg-bg-elevated rounded-lg transition-colors"
        title="Backend Settings"
      >
        <Settings className="w-5 h-5 text-text-secondary" />
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-surface rounded-lg shadow-xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">Backend Settings</h2>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-bg-elevated rounded transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary-600/30 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : config ? (
          <div className="p-6 space-y-6">
            {/* Backend Type Selection */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-3">
                Backend Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setConfig({ ...config, type: 'local' })}
                  className={`p-4 rounded-lg border-2 transition-colors ${config.type === 'local'
                    ? 'border-primary-600 bg-primary-600/10'
                    : 'border-border-subtle hover:border-border-default'
                    }`}
                >
                  <Server className="w-6 h-6 mx-auto mb-2 text-text-primary" />
                  <div className="text-sm font-medium text-text-primary">Local</div>
                  <div className="text-xs text-text-tertiary mt-1">Run on this machine</div>
                </button>
                <button
                  onClick={() => {
                    // Pre-fill remote defaults if not already set
                    if (!config.remote) {
                      setConfig({
                        ...config,
                        type: 'remote',
                        remote: DEFAULT_REMOTE_CONFIG,
                      })
                    } else {
                      setConfig({ ...config, type: 'remote' })
                    }
                  }}
                  className={`p-4 rounded-lg border-2 transition-colors ${config.type === 'remote'
                    ? 'border-primary-600 bg-primary-600/10'
                    : 'border-border-subtle hover:border-border-default'
                    }`}
                >
                  <Wifi className="w-6 h-6 mx-auto mb-2 text-text-primary" />
                  <div className="text-sm font-medium text-text-primary">Remote</div>
                  <div className="text-xs text-text-tertiary mt-1">Connect to remote daemon</div>
                </button>
              </div>
            </div>

            {/* Local Backend Settings */}
            {config.type === 'local' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Root Directory
                  </label>
                  <input
                    type="text"
                    value={config.local?.rootDir || ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        local: { ...config.local, rootDir: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 bg-bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:border-primary-600"
                    placeholder="/tmp/workspace"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Isolation Mode
                  </label>
                  <select
                    value={config.local?.isolation || 'software'}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        local: {
                          rootDir: config.local?.rootDir || '/tmp/workspace',
                          isolation: e.target.value as any,
                        },
                      })
                    }
                    className="w-full px-3 py-2 bg-bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:border-primary-600"
                  >
                    <option value="auto">Auto (detect best)</option>
                    <option value="bwrap">Bubblewrap (Linux only)</option>
                    <option value="software">Software (validation only)</option>
                    <option value="none">None (trust mode)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Remote Backend Settings (SSH-WS) */}
            {config.type === 'remote' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Host
                  </label>
                  <input
                    type="text"
                    value={config.remote?.host || ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        remote: { ...config.remote!, host: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 bg-bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:border-primary-600"
                    placeholder="localhost"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Port
                  </label>
                  <input
                    type="number"
                    value={config.remote?.port || ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        remote: {
                          ...config.remote!,
                          port: e.target.value ? parseInt(e.target.value) : undefined,
                        },
                      })
                    }
                    className="w-full px-3 py-2 bg-bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:border-primary-600"
                    placeholder="3001"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Auth Token
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={config.remote?.authToken || ''}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          remote: {
                            ...config.remote!,
                            authToken: e.target.value,
                          },
                        })
                      }
                      className="w-full px-3 py-2 pr-10 bg-bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:border-primary-600"
                      placeholder="(optional if server has no auth)"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-secondary transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Root Directory (on remote)
                  </label>
                  <input
                    type="text"
                    value={config.remote?.rootDir || ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        remote: { ...config.remote!, rootDir: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 bg-bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:border-primary-600"
                    placeholder="/var/workspace"
                  />
                </div>
              </div>
            )}

            {/* Scope (optional, applies to both local and remote) */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Scope (optional)
              </label>
              <input
                type="text"
                value={config.scope || ''}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    scope: e.target.value || undefined,
                  })
                }
                className="w-full px-3 py-2 bg-bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:border-primary-600"
                placeholder="e.g., projects/myapp"
              />
              <p className="mt-1 text-xs text-text-tertiary">
                Subdirectory within root to restrict operations to
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-3 p-4 border-t border-border-subtle">
          <button
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg text-white text-sm font-medium transition-colors"
          >
            {saving ? 'Saving...' : 'Save & Restart'}
          </button>
        </div>
      </div>
    </div>
  )
}
