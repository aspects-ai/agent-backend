/**
 * TSBasic — Interactive CLI chat with an AI agent backed by agent-backend
 *
 * The agent has full filesystem + exec tools via MCP, just like the NextJS demo
 * but in a minimal terminal interface.
 *
 * Usage:
 *   make tsbasic                           # local backend (default)
 *   BACKEND_TYPE=remote make tsbasic       # remote backend (requires daemon)
 *
 * Environment variables:
 *   OPENROUTER_API_KEY  - Required. OpenRouter API key
 *   BACKEND_TYPE        - "local" (default) or "remote"
 *   ROOT_DIR            - Workspace root (default: /tmp/agent-backend-workspace)
 *   MODEL               - Model ID (default: anthropic/claude-sonnet-4.5)
 *   REMOTE_HOST         - Remote host (default: localhost)
 *   REMOTE_PORT         - Remote port (default: 3001)
 *   AUTH_TOKEN           - Auth token for remote backend
 */

import { openrouter } from '@openrouter/ai-sdk-provider'
import { ConnectionStatus, LocalFilesystemBackend, RemoteFilesystemBackend } from 'agent-backend'
import { VercelAIAdapter } from 'agent-backend/adapters'
import { stepCountIs, streamText, type ModelMessage } from 'ai'
import * as readline from 'node:readline'

const BACKEND_TYPE = process.env.BACKEND_TYPE ?? 'local'
const ROOT_DIR = process.env.ROOT_DIR ?? (BACKEND_TYPE === 'remote' ? '/var/workspace' : '/tmp/agentbe-workspace')
const MODEL = process.env.MODEL ?? 'anthropic/claude-sonnet-4.5'

function createBackend() {
  if (BACKEND_TYPE === 'remote') {
    return new RemoteFilesystemBackend({
      rootDir: ROOT_DIR,
      host: process.env.REMOTE_HOST ?? 'localhost',
      port: Number(process.env.REMOTE_PORT ?? 3001),
      authToken: process.env.AUTH_TOKEN,
    })
  }
  return new LocalFilesystemBackend({
    rootDir: ROOT_DIR,
    isolation: 'none',
    preventDangerous: false,
  })
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('Error: OPENROUTER_API_KEY is required. Set it in .env or export it.')
    process.exit(1)
  }

  console.log(`\nTSBasic — Agent Backend CLI Chat`)
  console.log(`Backend: ${BACKEND_TYPE} | Root: ${ROOT_DIR} | Model: ${MODEL}`)
  if (BACKEND_TYPE === 'local') {
    console.log(`\x1b[2mSwitch to remote: BACKEND_TYPE=remote make tsbasic\x1b[0m\n`)
  } else {
    console.log(`\x1b[2mSwitch to local:  make tsbasic\x1b[0m\n`)
  }

  const backend = createBackend()

  backend.onStatusChange((event) => {
    const labels: Record<string, string> = {
      [ConnectionStatus.CONNECTED]: '\x1b[32m connected\x1b[0m',
      [ConnectionStatus.CONNECTING]: '\x1b[33m connecting...\x1b[0m',
      [ConnectionStatus.DISCONNECTED]: '\x1b[31m disconnected\x1b[0m',
      [ConnectionStatus.RECONNECTING]: '\x1b[33m reconnecting...\x1b[0m',
      [ConnectionStatus.DESTROYED]: '\x1b[90m destroyed\x1b[0m',
    }
    process.stderr.write(`\n[status]${labels[event.to] ?? ` ${event.to}`}`)
    if (event.error) process.stderr.write(` (${event.error.message})`)
    process.stderr.write('\n')
  })

  process.stdout.write('Connecting to backend...')
  const adapter = new VercelAIAdapter(backend)
  const mcpClient = await adapter.getMCPClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = await mcpClient.tools() as any
  const toolNames = Object.keys(tools)
  process.stdout.write(` connected! (${toolNames.length} tools: ${toolNames.join(', ')})\n`)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve))

  const messages: ModelMessage[] = []

  console.log(`Type "exit" to quit.\n`)

  try {
    while (true) {
      const input = await ask('you> ')
      if (input.trim().toLowerCase() === 'exit') break
      if (!input.trim()) continue

      messages.push({ role: 'user', content: input })
      process.stdout.write('\n...\r')

      const result = streamText({
        model: openrouter(MODEL),
        messages,
        tools,
        stopWhen: stepCountIs(15),
      })

      let hasOutput = false
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            if (!hasOutput) {
              process.stdout.write('\x1b[2K\rassistant> ')
              hasOutput = true
            }
            process.stdout.write(part.text)
            break
          case 'tool-call':
            if (!hasOutput) {
              process.stdout.write('\x1b[2K\r')
              hasOutput = true
            }
            process.stdout.write(`  [${part.toolName}] ${JSON.stringify(part.input).slice(0, 120)}\n`)
            break
          case 'tool-result': {
            const text = typeof part.output === 'string' ? part.output : JSON.stringify(part.output)
            if (text.length > 200) {
              process.stdout.write(`\n  => ${text.slice(0, 200)}...`)
            } else {
              process.stdout.write(`\n  => ${text}`)
            }
            break
          }
        }
      }

      // Append response messages (including tool calls/results) to conversation history
      const response = await result.response
      messages.push(...response.messages)
      process.stdout.write('\n\n')
    }
  } finally {
    console.log('\nShutting down...')
    await mcpClient.close()
    await backend.destroy()
    rl.close()
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err)
  process.exit(1)
})
