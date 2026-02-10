'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { BackendProvider } from './lib/backend-context'
import Header from './components/Header'
import FileExplorer, { FileExplorerRef } from './components/FileExplorer'
import Chat from './components/Chat'
import Editor from './components/Editor'

export default function Home() {
  const [sessionId, setSessionId] = useState<string>('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const fileExplorerRef = useRef<FileExplorerRef>(null)

  useEffect(() => {
    // Generate session ID on mount
    setSessionId(uuidv4())
  }, [])

  const handleAgentFinished = useCallback(() => {
    fileExplorerRef.current?.refresh()
  }, [])

  if (!sessionId) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <BackendProvider>
      <div className="h-screen flex flex-col bg-background">
        <Header sessionId={sessionId} />

        <div className="flex-1 flex overflow-hidden">
          <FileExplorer
            ref={fileExplorerRef}
            sessionId={sessionId}
            onFileSelect={setSelectedFile}
            selectedFile={selectedFile}
          />

          <Chat sessionId={sessionId} onAgentFinished={handleAgentFinished} />

          <Editor
            sessionId={sessionId}
            selectedFile={selectedFile}
          />
        </div>
      </div>
    </BackendProvider>
  )
}
