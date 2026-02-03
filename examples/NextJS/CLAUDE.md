# NextJS Agent Backend Demo - Development Guide

Professional demo showcasing agent-backend with AI chat, file management, and code editing.

## Architecture

### AI Chat System

**Technology**: Vercel AI SDK v6 with React hooks

**Client** (`Chat.tsx`):
```typescript
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useMemo, useState } from 'react'

// Manage input state locally
const [input, setInput] = useState('')

// Create transport with API endpoint and session data
const transport = useMemo(
  () =>
    new DefaultChatTransport({
      api: '/api/chat',
      body: { sessionId },
    }),
  [sessionId]
)

// Use chat hook with transport
const { messages, sendMessage, status } = useChat({ transport })

// Messages have a parts-based structure
messages.forEach(msg => {
  // Extract text: msg.parts.filter(p => p.type === 'text')
  // Extract tools: msg.parts.filter(p => p.type.startsWith('tool-'))
})

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!input.trim()) return

  await sendMessage({ text: input })
  setInput('')
}
```

**Server** (`/api/chat/route.ts`):
```typescript
import { streamText } from 'ai'

// Convert MCP tools to AI SDK format
const tools = toolsResult.tools.reduce((acc, tool) => {
  acc[tool.name] = {
    description: tool.description,
    parameters: tool.inputSchema,
    execute: async (params) => {
      const result = await mcpClient.callTool({ name: tool.name, arguments: params })
      return result.content
    },
  }
  return acc
}, {})

// Stream AI response with tools
const result = streamText({
  model: openrouter('anthropic/claude-4.5-sonnet'),
  messages,
  tools,
})

// Returns UI message stream (includes text deltas, tool calls, tool results)
return result.toUIMessageStreamResponse()
```

### Key Benefits

1. **Automatic Message Management**: `useChat()` handles message state, streaming, tool execution, and status
2. **Multi-Step Agentic**: Agent automatically continues using tools until task is complete
3. **Real-Time Streaming**: Character-by-character streaming with automatic retries
4. **Tool Execution**: Tools are automatically tracked in message parts (`tool-${name}` parts)
5. **Type-Safe**: Full TypeScript support with proper types
6. **Simple API**: Call `sendMessage({ text })` to send messages, use `DefaultChatTransport` for API communication
7. **Parts-Based Messages**: Flexible message structure with text, tool, file, and data parts

### Backend Architecture

#### Local Backend (Development)
```
NextJS App → LocalFilesystemBackend
  └── getMCPClient() spawns: agent-backend --rootDir /tmp/workspace (stdio)
      └── agentbe-daemon serves local filesystem via stdio MCP
```

#### Remote Backend (Production)
```
NextJS App → RemoteFilesystemBackend
  ├── SSH client → Remote:2222 (sshd)
  │   └── Direct filesystem operations (exec, read, write)
  └── MCP client → Remote:3001 (HTTP)
      └── agentbe-daemon serves /var/workspace via HTTP MCP

Remote machine runs TWO daemons:
  1. sshd (SSH daemon) - port 2222
  2. agentbe-daemon (agent backend daemon) - port 3001
     Command: agent-backend --rootDir /var/workspace --mcp-port 3001 --mcp-auth-token <token>

Both access the SAME filesystem (/var/workspace).
```

**MCP Client Caching**: MCP clients are cached per session to avoid spawning multiple processes.

## Backend Configuration

### Client Configuration (UI-Driven)

The Settings UI configures how the **client** connects to a backend:

1. **Click the settings icon** in the header (top right)
2. **Choose backend type**: Local or Remote
3. **Configure client settings**:
   - **Local**: Root directory, isolation mode (client spawns daemon subprocess)
   - **Remote**: SSH host, ports, credentials, MCP auth token (client connects to existing daemon)
4. **Click "Save & Restart"** to apply changes

Configuration is stored **in-memory only** and resets on server restart.

### Daemon Configuration (Separate)

When using **remote mode**, the daemon runs separately and has its own configuration:
- CLI args: `agent-backend daemon --rootDir /var/workspace --mcp-auth-token <token>`
- Docker env vars: `MCP_PORT`, `SSH_USERS`, `MCP_AUTH_TOKEN`

See [deploy README](../../typescript/deploy/README.md) for daemon configuration options.

### Switching to Remote Backend

1. Start the daemon (see Remote Backend Testing below)
2. Open backend settings in the UI
3. Switch to "Remote" and configure connection details to match the daemon
4. Save and restart

## Development Workflow

### Local Development (with mprocs)

From monorepo root:
```bash
make dev
```

This runs:
- **TypeScript watch** (`typescript/` package) - Rebuilds on changes
- **NextJS dev server** (`examples/NextJS/`) - Hot reload on http://localhost:3001

**Why mprocs?**
- Language-agnostic process orchestration
- Single command to start everything
- Terminal multiplexer UI with logs
- Automatic dependency ordering (NextJS waits for TypeScript)

### Manual Development

```bash
# Terminal 1: TypeScript library watch mode
cd typescript
pnpm run dev

# Terminal 2: NextJS dev server
cd examples/NextJS
pnpm run dev
```

### Remote Backend Testing

```bash
# From monorepo root
make dev-remote
```

This runs `REMOTE=1 mprocs` which starts:
1. TypeScript watch mode
2. Docker container with agentbe-daemon (SSH + MCP)
3. NextJS dev server

Configure the client via the Settings UI to connect to the daemon.

## Key Files

### Chat Implementation
- `app/components/Chat.tsx` - Main chat component using `useChat()` hook
- `app/api/chat/route.ts` - AI streaming endpoint with MCP tools
- `app/lib/mcp-client.ts` - MCP client factory and caching

### File Operations
- `app/api/files/list/route.ts` - List directory contents
- `app/api/files/read/route.ts` - Read file contents
- `app/api/files/write/route.ts` - Write file contents
- `app/api/files/exec/route.ts` - Execute shell commands

### UI Components
- `app/components/FileExplorer.tsx` - File tree with upload/download
- `app/components/Editor.tsx` - Monaco editor integration
- `app/lib/backend.ts` - Backend factory (local vs remote)

## Environment Variables

```bash
# Only one required!
OPENROUTER_API_KEY=sk-or-v1-your-key
```

**Note**: All backend configuration (type, workspace root, isolation mode, remote connection details) is managed via the UI (click the settings icon in the header). Configuration is stored in-memory and resets on server restart.

## Dependencies

### AI & Streaming
- `ai@^6.0.0` - Core AI SDK (v6 uses `streamText` with `maxSteps` for agentic behavior)
- `@ai-sdk/react@^3.0.0` - React hooks (`useChat` returns `messages`, `sendMessage`, `status`)
- `@openrouter/ai-sdk-provider@^2.0.0` - OpenRouter integration
- `@modelcontextprotocol/sdk@^1.25.0` - MCP client/server

### Frontend
- `next@^15.5.0` - React framework
- `@monaco-editor/react@^4.6.0` - Code editor
- `react-markdown@^10.1.0` - Markdown rendering
- `lucide-react@^0.469.0` - Icons

### Backend
- `agent-backend@workspace:*` - Core backend library
- `ssh2@^1.17.0` - SSH client for remote backend
- `zod@^3.24.0` - Schema validation

## Common Tasks

### Adding a New MCP Tool

1. Add tool to backend (if custom):
```typescript
// In agent-backend/src/server/tools.ts
server.registerTool('my_tool', {
  description: 'Does something useful',
  inputSchema: { path: z.string() },
}, async ({ path }, { sessionId }) => {
  const backend = await getBackend(sessionId)
  // Implementation
  return { content: [{ type: 'text', text: 'Result' }] }
})
```

2. Tool automatically available in `/api/chat` endpoint via MCP client

### Customizing AI Behavior

Edit `app/api/chat/route.ts`:
```typescript
const result = streamText({
  model: openrouter('anthropic/claude-3.5-sonnet'),
  messages,
  tools,
  maxSteps: 10,        // Increase for more tool usage
  temperature: 0.7,    // Adjust creativity
  maxTokens: 4000,     // Control response length
})
```

### Adding File Operation

1. Create new API route: `app/api/files/myop/route.ts`
2. Use backend from `@/lib/backend`:
```typescript
import { getBackend } from '@/lib/backend'

export async function POST(req: Request) {
  const { path } = await req.json()
  const backend = await getBackend()
  const result = await backend.myOperation(path)
  return Response.json(result)
}
```

## Troubleshooting

### "Module not found: ai/react"

AI SDK v6 moved React hooks to separate package:
```bash
pnpm add @ai-sdk/react
```

Import: `import { useChat } from '@ai-sdk/react'`

### "input is undefined" or "handleInputChange is not a function"

`@ai-sdk/react@3.0.70+` changed the API - `useChat` no longer manages form input state:

**Old API (deprecated):**
```typescript
const { input, handleInputChange, handleSubmit } = useChat({ ... })
```

**New API (v3.0.70+):**
```typescript
const [input, setInput] = useState('')
const { sendMessage, status } = useChat({ ... })

const handleSubmit = async (e) => {
  e.preventDefault()
  await sendMessage({ text: input })
  setInput('')
}
```

### "MCP client failed to connect"

Check:
- Workspace directory exists and has correct permissions
- `agent-backend` CLI is in PATH
- No other process using the MCP stdio connection

### "Tool execution failed"

Check:
- Tool parameters match schema defined in MCP tool
- Backend has necessary permissions for the operation
- Command safety checks not blocking the operation (if using exec)

### NextJS won't start

```bash
# Clean install
rm -rf .next node_modules pnpm-lock.yaml
pnpm install
pnpm run dev
```

## Code Style

- **TypeScript**: Strict mode, explicit return types for exports
- **React**: Functional components with hooks
- **Async**: Always use async/await, never nested promises
- **Error Handling**: Wrap backend calls in try/catch, return proper error responses
- **Comments**: Explain *why*, not *what*

## Testing

Currently manual testing via UI. Future:
- Add E2E tests with Playwright
- Add unit tests for API routes
- Add integration tests for backend operations
