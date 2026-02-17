# Vercel AI SDK Integration

Agent Backend provides integration with Vercel's AI SDK through the `VercelAIAdapter`. The adapter wraps any backend and exposes its MCP tools in the format expected by the AI SDK.

## How It Works

The adapter automatically creates the appropriate MCP transport based on your backend type:

- **LocalFilesystemBackend** -- Stdio transport (spawns subprocess)
- **RemoteFilesystemBackend** -- HTTP transport (connects to remote MCP server)
- **MemoryBackend** -- Stdio transport (spawns subprocess)

## Usage

```typescript
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp'
import { LocalFilesystemBackend, VercelAIAdapter } from 'agent-backend'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

// Create backend and adapter
const backend = new LocalFilesystemBackend({ rootDir: '/tmp/agentbe-workspace' })
const adapter = new VercelAIAdapter(backend)

// Get AI SDK MCP client
const mcp = await adapter.getMCPClient()

// Tools are already in AI SDK format - no manual transformation needed
const result = await generateText({
  model: openai('gpt-5'),
  tools: await mcp.tools(),
  prompt: 'List all TypeScript files in src/'
})

// destroy() closes MCP clients, transports, and cleans up resources
await backend.destroy()
```

## Resource Cleanup

The adapter tracks all MCP clients and transports via the backend's closeable tracking. Calling `backend.destroy()` closes everything automatically.

## Installation

The adapter requires the `@ai-sdk/mcp` peer dependency:

```bash
npm install @ai-sdk/mcp ai
```

The `VercelAIAdapter` is available from the `agent-backend/adapters` subpath export to avoid requiring the AI SDK dependency for users who don't need it:

```typescript
import { VercelAIAdapter } from 'agent-backend/adapters'
```

It is also re-exported from the main `agent-backend` entrypoint for convenience.
