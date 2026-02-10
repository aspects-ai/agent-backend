'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import BackendSettings from './BackendSettings'

interface HeaderProps {
  sessionId: string
}

export default function Header({ sessionId }: HeaderProps) {
  const [backendType, setBackendType] = useState<'local' | 'remote'>('local')

  useEffect(() => {
    // Load current backend type
    fetch('/api/backend-config')
      .then(res => res.json())
      .then(config => setBackendType(config.type))
      .catch(err => console.error('Failed to load backend type:', err))
  }, [])

  return (
    <header className="h-[60px] border-b border-border bg-background-surface flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <Image src="/assets/icon_logo.png" alt="Logo" width={32} height={32} className="rounded-lg" />
        <div>
          <h1 className="text-lg font-semibold text-foreground">Agent Backend Demo</h1>
          <p className="text-xs text-foreground-muted">Professional AI Development Platform</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Backend Type Indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background-elevated">
          <div className="w-2 h-2 rounded-full bg-success" />
          <span className="text-sm text-foreground-secondary capitalize">{backendType}</span>
        </div>

        {/* Backend Settings */}
        <BackendSettings />

        <div className="text-xs text-foreground-muted">
          Session: {sessionId.slice(0, 8)}
        </div>
      </div>
    </header>
  )
}
