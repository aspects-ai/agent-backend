'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type BackendType = 'local' | 'remote'

interface BackendContextType {
  backendType: BackendType
  switchBackend: (type: BackendType) => Promise<void>
  status: string
  isConnected: boolean
  isSwitching: boolean
  error: string | null
}

const BackendContext = createContext<BackendContextType | undefined>(undefined)

export function BackendProvider({ children }: { children: ReactNode }) {
  const [backendType, setBackendType] = useState<BackendType>(
    (process.env.NEXT_PUBLIC_BACKEND_TYPE as BackendType) || 'local'
  )
  const [status, setStatus] = useState<string>('disconnected')
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isConnected = status === 'connected'

  async function fetchStatus() {
    try {
      const response = await fetch('/api/backend/status')
      const data = await response.json()
      setStatus(data.status ?? (data.connected ? 'connected' : 'disconnected'))
      setError(null)
    } catch (err) {
      setStatus('disconnected')
      setError(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  // Poll connection status on mount, when backend type changes, and every 10s
  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 10_000)
    return () => clearInterval(interval)
  }, [backendType])

  async function switchBackend(type: BackendType) {
    setIsSwitching(true)
    setError(null)

    try {
      const response = await fetch('/api/backend/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to switch backend')
      }

      setBackendType(type)

      // Force page reload to reset all sessions and connections
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch backend')
      throw err
    } finally {
      setIsSwitching(false)
    }
  }

  return (
    <BackendContext.Provider
      value={{
        backendType,
        switchBackend,
        status,
        isConnected,
        isSwitching,
        error
      }}
    >
      {children}
    </BackendContext.Provider>
  )
}

export function useBackend() {
  const context = useContext(BackendContext)
  if (!context) {
    throw new Error('useBackend must be used within BackendProvider')
  }
  return context
}
