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

import { ConnectionStatus, LocalFilesystemBackend, RemoteFilesystemBackend } from 'agent-backend'
import { VercelAIAdapter } from 'agent-backend/adapters'
import { runChat } from './chat.js'

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

  // Show backend connection status
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

  // We can now execute file operations simply via ssh-over-websockets
  backend.writeFile("test.txt", "Hello World")

  // Or we can use the MCP client to get tools for our agent
  const adapter = new VercelAIAdapter(backend)
  const mcpClient = await adapter.getMCPClient()
  const tools = await mcpClient.tools()
  
  process.stdout.write(` connected! (tools: ${Object.keys(tools).join(', ')})\n`)

  try {
    await runChat({ model: MODEL, tools })
  } finally {
    console.log('\nShutting down...')
    await backend.destroy()
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err)
  process.exit(1)
})
