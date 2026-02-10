'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, ChevronDown, ChevronUp, Send, User } from 'lucide-react'

interface ChatProps {
  sessionId: string
  onAgentFinished?: () => void
}

export default function Chat({ sessionId, onAgentFinished }: ChatProps) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const prevStatusRef = useRef<typeof status>(undefined)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: { sessionId },
      }),
    [sessionId]
  )

  const { messages, sendMessage, status } = useChat({
    transport,
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Detect when agent finishes (streaming -> ready)
  useEffect(() => {
    const wasStreaming = prevStatusRef.current === 'streaming'
    const isNowReady = status === 'ready' || status === undefined

    if (wasStreaming && isNowReady) {
      console.log('[Chat] Agent finished, triggering file refresh')
      onAgentFinished?.()
    }
    prevStatusRef.current = status
  }, [status, onAgentFinished])

  const isLoading = status === 'submitted' || status === 'streaming'
  const isButtonDisabled = !input.trim() || isLoading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    await sendMessage({ text: input })
    setInput('')
  }

  const toggleToolExpand = (toolKey: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev)
      if (next.has(toolKey)) {
        next.delete(toolKey)
      } else {
        next.add(toolKey)
      }
      return next
    })
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Welcome to Agent Backend</h2>
            <p className="text-foreground-secondary max-w-md">
              Ask me to create files, run commands, or help with your project. I have direct access to your workspace.
            </p>
          </div>
        )}

        {messages.map((message) => {
          // Extract text parts
          const textParts = message.parts.filter((p: any) => p.type === 'text')
          const textContent = textParts.map((p: any) => p.text).join('')

          // Extract tool parts
          const toolParts = message.parts.filter(
            (p: any) => p.type.startsWith('tool-') || p.type === 'dynamic-tool'
          )

          return (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-white" />
                </div>
              )}

              <div className={`max-w-[70%] ${message.role === 'user' ? 'order-first' : ''}`}>
                {textContent && (
                  <div
                    className={`rounded-lg px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-gradient-to-r from-primary to-primary/90 text-white'
                        : 'bg-background-surface text-foreground'
                    }`}
                  >
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>{textContent}</ReactMarkdown>
                    </div>
                  </div>
                )}

                {toolParts.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {toolParts.map((tool: any, index: number) => {
                      const toolKey = `${message.id}-${index}`
                      const toolName = tool.type === 'dynamic-tool' ? tool.toolName : tool.type.replace('tool-', '')
                      const hasOutput = tool.state === 'output-available'
                      const isStreaming = tool.state === 'input-streaming' || tool.state === 'output-streaming'

                      return (
                        <div key={toolKey} className="bg-background-surface rounded-lg border border-border overflow-hidden">
                          <button
                            onClick={() => toggleToolExpand(toolKey)}
                            className="w-full flex items-center justify-between p-3 hover:bg-background-elevated transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  hasOutput ? 'bg-success' : isStreaming ? 'bg-warning animate-pulse' : 'bg-accent'
                                }`}
                              />
                              <span className="text-sm font-medium text-foreground">{toolName}</span>
                              {hasOutput && <span className="text-xs text-foreground-muted">(completed)</span>}
                              {isStreaming && <span className="text-xs text-foreground-muted">(streaming)</span>}
                            </div>
                            {expandedTools.has(toolKey) ? (
                              <ChevronUp className="w-4 h-4 text-foreground-muted" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-foreground-muted" />
                            )}
                          </button>

                          {expandedTools.has(toolKey) && (
                            <div className="border-t border-border p-3 space-y-2 overflow-hidden">
                              {tool.input && (
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-foreground-muted mb-1">Input:</p>
                                  <pre className="text-xs bg-background rounded p-2 overflow-x-auto text-foreground-secondary whitespace-pre-wrap break-all">
                                    {JSON.stringify(tool.input, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {tool.output && (
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-foreground-muted mb-1">Output:</p>
                                  <pre className="text-xs bg-background rounded p-2 overflow-x-auto text-foreground-secondary whitespace-pre-wrap break-all max-h-64">
                                    {JSON.stringify(tool.output, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {tool.errorText && (
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-error mb-1">Error:</p>
                                  <pre className="text-xs bg-background rounded p-2 overflow-x-auto text-error whitespace-pre-wrap break-all">
                                    {tool.errorText}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-background-elevated flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-foreground-secondary" />
                </div>
              )}
            </div>
          )
        })}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me to create files, run commands..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 bg-background-surface border border-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-primary disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isButtonDisabled}
            className="px-6 py-3 bg-primary hover:bg-primary/90 disabled:bg-background-elevated disabled:text-foreground-muted rounded-lg text-white font-medium transition-colors flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
