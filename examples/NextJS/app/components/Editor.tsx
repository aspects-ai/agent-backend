'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Save, FileCode, CheckCircle, AlertCircle } from 'lucide-react'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

interface EditorProps {
  sessionId: string
  selectedFile: string | null
}

type SaveState = 'idle' | 'saving' | 'success' | 'error'

export default function Editor({ sessionId, selectedFile }: EditorProps) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [isDirty, setIsDirty] = useState(false)
  const [language, setLanguage] = useState('plaintext')
  const [fileSize, setFileSize] = useState(0)

  useEffect(() => {
    if (!selectedFile) {
      setContent('')
      setOriginalContent('')
      setIsDirty(false)
      return
    }

    loadFile()
  }, [selectedFile, sessionId])

  const loadFile = async () => {
    if (!selectedFile) return

    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/files/read?sessionId=${sessionId}&path=${encodeURIComponent(selectedFile)}`)
      const data = await response.json()

      if (response.ok) {
        setContent(data.content)
        setOriginalContent(data.content)
        setFileSize(data.size)
        setIsDirty(false)
        setError(null)
        detectLanguage(selectedFile)
      } else {
        const errorMsg = data.error || 'Failed to load file'
        console.error('Failed to load file:', errorMsg)
        setError(errorMsg)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error loading file'
      console.error('Error loading file:', error)
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  const detectLanguage = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'json': 'json',
      'html': 'html',
      'css': 'css',
      'md': 'markdown',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'sh': 'shell',
      'yaml': 'yaml',
      'yml': 'yaml',
      'xml': 'xml',
      'sql': 'sql',
    }
    setLanguage(langMap[ext || ''] || 'plaintext')
  }

  const handleSave = async () => {
    if (!selectedFile || !isDirty) return

    setSaveState('saving')
    try {
      const response = await fetch('/api/files/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          path: selectedFile,
          content,
        }),
      })

      if (response.ok) {
        setSaveState('success')
        setOriginalContent(content)
        setIsDirty(false)
        setTimeout(() => setSaveState('idle'), 2000)
      } else {
        setSaveState('error')
        setTimeout(() => setSaveState('idle'), 3000)
      }
    } catch (error) {
      console.error('Error saving file:', error)
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 3000)
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    const newContent = value || ''
    setContent(newContent)
    setIsDirty(newContent !== originalContent)
  }

  const formatDocument = () => {
    // Simple JSON formatting for now
    if (language === 'json') {
      try {
        const formatted = JSON.stringify(JSON.parse(content), null, 2)
        setContent(formatted)
        setIsDirty(formatted !== originalContent)
      } catch (error) {
        console.error('Invalid JSON')
      }
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFile, isDirty, content])

  const useLargeFileMode = fileSize > 1024 * 1024 // 1MB

  return (
    <div className="w-[480px] border-l border-border-subtle bg-bg-surface flex flex-col">
      <div className="border-b border-border-subtle p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileCode className="w-4 h-4 text-text-tertiary flex-shrink-0" />
          {selectedFile ? (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{selectedFile}</p>
              <p className="text-xs text-text-tertiary">
                {language} · {(fileSize / 1024).toFixed(1)} KB
                {useLargeFileMode && ' · Large file mode'}
              </p>
            </div>
          ) : (
            <span className="text-sm text-text-tertiary">No file selected</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {language === 'json' && selectedFile && (
            <button
              onClick={formatDocument}
              className="px-3 py-1.5 text-xs bg-bg-elevated hover:bg-border-subtle rounded text-text-secondary transition-colors"
            >
              Format
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty || saveState === 'saving'}
            className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:bg-bg-elevated disabled:text-text-tertiary rounded text-white text-sm font-medium transition-colors flex items-center gap-2"
          >
            {saveState === 'saving' ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : saveState === 'success' ? (
              <>
                <CheckCircle className="w-4 h-4" />
                Saved
              </>
            ) : saveState === 'error' ? (
              <>
                <AlertCircle className="w-4 h-4" />
                Error
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {!selectedFile ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <FileCode className="w-12 h-12 text-text-tertiary mx-auto mb-2" />
              <p className="text-sm text-text-tertiary">Select a file to edit</p>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-primary-600/30 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md px-4">
              <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
              <p className="text-sm font-medium text-text-primary mb-2">Failed to load file</p>
              <p className="text-xs text-text-secondary mb-4">{error}</p>
              <button
                onClick={loadFile}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded text-white text-sm transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : useLargeFileMode ? (
          <textarea
            value={content}
            onChange={(e) => handleEditorChange(e.target.value)}
            className="w-full h-full p-4 bg-bg-app text-text-primary font-mono text-sm resize-none focus:outline-none"
            spellCheck={false}
          />
        ) : (
          <MonacoEditor
            height="100%"
            language={language}
            value={content}
            onChange={handleEditorChange}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
              padding: { top: 16, bottom: 16 },
            }}
          />
        )}
      </div>

      {isDirty && (
        <div className="border-t border-border-subtle px-3 py-2 bg-accent-amber/10">
          <p className="text-xs text-accent-amber">Unsaved changes · Press Cmd/Ctrl+S to save</p>
        </div>
      )}
    </div>
  )
}
