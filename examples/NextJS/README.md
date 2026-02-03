# Agent Backend - NextJS Demo

Full-featured demo showcasing agent-backend with AI chat, file management, and direct backend editing.

## Features

- 🤖 **AI Chat** - Streaming responses with Vercel AI SDK (`useChat` hook) and MCP tools
- 📁 **File Explorer** - Real-time file tree with upload/download capabilities
- ✏️ **Code Editor** - Monaco editor for direct file editing with syntax highlighting
- 🔌 **Flexible Backend** - Support for both local and remote (SSH) backends
- 🎨 **Professional UI** - Enterprise-appropriate design with modern aesthetics
- 🔄 **Multi-Step Agentic** - Agent continues using tools until task is complete (`maxSteps: 10`)

## Quick Start

### 1. Install Dependencies (from monorepo root)

```bash
make install
```

This installs dependencies for all packages (TypeScript library + NextJS example).

### 2. Configure Environment

```bash
cd examples/NextJS
cp .env.example .env.local
```

Edit `.env.local`:

```bash
# Required - AI provider API key
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

**Note:** The app's **Settings UI** (gear icon in header) configures how the *client* connects to a backend:
- Backend type (local vs remote)
- For local: workspace directory, isolation mode
- For remote: host, ports, SSH credentials, MCP auth token

This is *client configuration* only. If using a remote daemon, the daemon itself is configured separately via CLI args or Docker environment variables (see [deploy README](../../typescript/deploy/README.md)).

### 3. Create Workspace Directory

```bash
mkdir -p /tmp/agentbe-workspace
```

### 4. Run Development (from monorepo root)

```bash
make dev
```

This uses **mprocs** to run:
- TypeScript watch mode (rebuilds on changes)
- NextJS dev server (hot reload)

Open [http://localhost:3001](http://localhost:3001) in your browser.

**Alternative**: Run individual commands:
```bash
cd typescript && pnpm run dev &      # TypeScript watch
cd examples/NextJS && pnpm run dev & # NextJS dev server
```

### Remote Setup (Optional)

If you want to use a remote backend with agentbe-daemon running on a remote host:

**On the remote host (start Docker container):**

```bash
# Start agentbe-daemon in Docker
agent-backend start-docker --build
```

This starts a Docker container with:
- SSH daemon on port 2222
- MCP server on port 3001
- Default credentials: `root:agents`

**On your local machine:**

1. Start the NextJS app: `make dev` (from monorepo root)
2. Click the **Settings icon** (gear) in the app header
3. Switch backend type to **Remote**
4. Configure connection details:
   - Host: `localhost` (or remote IP)
   - SSH Port: `2222`
   - MCP Port: `3001`
   - Username: `root`
   - Password: `agents`
   - MCP Auth Token: (if configured)
5. Click **Save & Restart**

**Alternative:** For remote testing with mprocs:

```bash
make dev-remote  # Starts Docker container + NextJS configured for remote
```

## Architecture

### Real-Time AI Chat

The app uses **Vercel AI SDK** for streaming AI responses with automatic state management:

**Client** (`useChat` hook):
- Manages messages, input, loading states automatically
- Handles streaming responses and tool invocations
- Provides `handleSubmit` for sending messages

**Server** (`streamText` + MCP tools):
1. Receives messages from client at `POST /api/chat`
2. Converts MCP tools to AI SDK format
3. Streams AI response using `streamText()` with `maxSteps: 10` for agentic behavior
4. Returns data stream with `toDataStreamResponse()`

**Why Vercel AI SDK?**
- ✅ Automatic conversation state management
- ✅ Built-in streaming support
- ✅ Tool invocations handled automatically
- ✅ Multi-step agentic behavior with `maxSteps`
- ✅ Works natively in Next.js App Router
- ✅ Type-safe React hooks

### Local Development

```
NextJS App (localhost:3000)
├── POST /api/chat → streamText() with MCP tools
│   └── backend.getMCPClient()
│       └── Spawns: agent-backend CLI (stdio)
│           └── LocalFilesystemBackend
│               └── Local files
│   Client: useChat() hook manages all state
└── HTTP → File Operations (Direct backend access)
```

**Automatic MCP Server Management**: The MCP server is automatically spawned and managed by `LocalFilesystemBackend.getMCPClient()`. No separate process to start manually!

**Simplified State Management**: `useChat()` hook automatically handles messages, streaming, tool invocations, and loading states.

### Remote Deployment

To connect NextJS app to a remote agentbe-daemon:

**On Remote Machine** (e.g., Docker container):
```bash
# Start agentbe-daemon (agent backend daemon)
agent-backend daemon --rootDir .agentbe-workspace/ \
  --mcp-port 3001 \
  --mcp-auth-token <token>

# SSH daemon (sshd) should also be running
# Both access the same filesystem: /var/workspace
```

**In NextJS App** (via UI settings):
- Backend Type: Remote
- Host: remote-machine.com
- SSH Port: 2222
- MCP Port: 3001
- Username: agentbe
- Password: <ssh-password>
- MCP Auth Token: <mcp-auth-token>

**Architecture**:
```
NextJS App → RemoteFilesystemBackend
  ├── SSH (port 2222) for direct file operations (exec, read, write)
  └── HTTP (port 3001) for MCP tool execution
```

The app connects via TWO channels to the same remote machine:
- SSH (port 2222) for direct file operations (exec, read, write)
- HTTP (port 3001) for MCP tool execution

## Usage

### Chat with AI

1. Type a message in the chat input (e.g., "Create a Python script that prints hello world")
2. AI responses stream in real-time character-by-character
3. Tool invocations appear as collapsible cards showing:
   - Tool name and parameters
   - Execution status (pending → completed)
   - Tool results/output
4. Agent automatically continues using tools until task is complete (up to 10 steps)
5. Files created by AI automatically appear in the file explorer

**Example prompts:**
- "Create a package.json with express and nodemon"
- "Write a README explaining this project"
- "Run `ls -la` and show me the results"
- "Create a React component called Button.tsx"

### File Management

- **Upload**: Click "Upload" button in file explorer
- **Download**: Click download icon on file hover
- **Edit**: Click file to open in editor
- **Save**: Use Cmd/Ctrl+S or click Save button

### Editing Files

- Monaco editor provides full IDE features
- Syntax highlighting based on file extension
- Format JSON files with Format button
- Auto-save indication when changes are pending

## Technology Stack

### AI & Streaming
- **Vercel AI SDK v6** - `useChat()` hook for automatic conversation state management
- **OpenRouter** - Access to Claude 3.5 Sonnet via unified API
- **Model Context Protocol (MCP)** - Standard protocol for AI tool integration

### Frontend
- **Next.js 15** - App Router with React Server Components
- **TypeScript** - Full type safety across the stack
- **Tailwind CSS** - Utility-first styling
- **Monaco Editor** - VS Code's editor component
- **React Markdown** - Render AI responses with markdown formatting
- **Lucide Icons** - Modern icon library

### Backend
- **agent-backend** - Secure isolated backend for AI agents
  - LocalFilesystemBackend - Direct filesystem access with isolation
  - RemoteFilesystemBackend - SSH-based remote operations
  - MemoryBackend - In-memory key/value storage
- **MCP SDK** - Client/server implementation for tool protocol

### Development
- **mprocs** - Multi-process orchestration (TypeScript watch + NextJS dev)
- **pnpm** - Fast, disk-efficient package manager
- **Vitest** - Fast unit testing for TypeScript library

## Development

### Zero-Build Local Development

This demo is optimized for fast local development with **zero build steps**:

**agent-backend TypeScript transpilation**: Next.js transpiles the `agent-backend` package directly from TypeScript using the `transpilePackages` config. No need to rebuild the backend when you make changes.

```javascript
// next.config.js
transpilePackages: ['agent-backend']
```

**Automatic MCP Server Management**: The MCP server is automatically managed by the backend.

```typescript
// app/lib/mcp-client.ts
const backend = await backendManager.getBackend()
const client = await backend.getMCPClient()  // Spawns CLI automatically for local
```

**Benefits:**
- MCP server automatically spawned and managed
- Works locally and remotely with same API
- Hot reload: Changes to agent-backend source code are picked up automatically on next request
- No manual MCP server management needed

### Daily Development Workflow

```bash
# Just run the dev server
pnpm run dev

# Make changes to:
# - typescript/src/** (agent-backend)
# - examples/NextJS/app/** (NextJS app)

# Changes are picked up automatically!
```

### What Happens When You Edit Code

**Editing agent-backend** (`typescript/src/`):
1. Save file in `typescript/src/backends/LocalFilesystemBackend.ts`
2. Next request to API route triggers re-transpilation
3. New code is used immediately
4. No manual build step needed

**Editing NextJS app** (`app/`):
1. Save file in `app/components/Chat.tsx`
2. Next.js Fast Refresh updates browser automatically
3. No restart needed (standard Next.js behavior)

### Package Dependencies

The demo uses a pnpm workspace dependency:

```json
{
  "dependencies": {
    "agent-backend": "workspace:*"
  }
}
```

During `pnpm install`, this package is linked from the workspace, making source changes immediately available.

## Tech Stack

### Frontend
- **Next.js 15** - App Router with React Server Components
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Monaco Editor** - VS Code editor component
- **React Markdown** - Message formatting

### Backend
- **agent-backend** - Core backend library (local file reference)
- **MCP SDK** - Model Context Protocol for AI tools
- **Server-Sent Events (SSE)** - Real-time streaming communication
- **OpenRouter** - AI model provider

## Project Structure

```
examples/NextJS/
├── app/
│   ├── api/
│   │   ├── chat/
│   │   │   ├── route.ts             # POST endpoint for messages
│   │   │   └── stream/route.ts      # SSE streaming endpoint
│   │   └── files/
│   │       ├── tree/route.ts        # List files
│   │       ├── read/route.ts        # Read file
│   │       ├── write/route.ts       # Write file
│   │       ├── upload/route.ts      # Upload file
│   │       └── download/route.ts    # Download file
│   ├── components/
│   │   ├── Header.tsx               # Top bar with status
│   │   ├── FileExplorer.tsx         # File tree panel
│   │   ├── Chat.tsx                 # Chat interface
│   │   └── Editor.tsx               # Monaco editor panel
│   ├── lib/
│   │   ├── backend.ts               # Backend manager
│   │   ├── mcp-client.ts            # MCP client setup (in-process)
│   │   └── types.ts                 # TypeScript types
│   ├── page.tsx                     # Main app layout
│   └── layout.tsx                   # Root layout
├── package.json
├── next.config.js
└── tsconfig.json
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | ✅ Yes | OpenRouter API key for AI |

**Client configuration** (how the app connects to a backend) is managed via the **Settings UI** in the app header. This includes backend type, workspace directory, and remote connection details. Configuration is stored in-memory and resets on server restart.

**Daemon configuration** (if using remote mode) is separate - see [deploy README](../../typescript/deploy/README.md) for daemon CLI args and Docker environment variables.

## Troubleshooting

### "Cannot find module 'agent-backend'"

**Cause**: pnpm install not run, or symlink broken

**Fix**:
```bash
cd examples/NextJS
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### MCP Connection Failed (Local)

**Symptom**: "Failed to spawn agent-backend CLI" or "MCP tools not available"

**Causes**:
1. `agent-backend` CLI not in PATH
2. TypeScript package not built

**Fix**:
```bash
# Build agent-backend package
cd ../../typescript
pnpm run build
pnpm link --global

# Verify CLI is available
agent-backend --help
```

### MCP Connection Failed (Remote)

**Symptom**: "Connection refused" or "MCP connection timed out"

**Causes**:
1. MCP server not running on remote host
2. Wrong URL in `REMOTE_MCP_URL`
3. Firewall blocking port 3001

**Fix**:
```bash
# On remote host, check if MCP server is running
curl http://localhost:3001/health
# Expected: {"status":"ok","backend":"local"}

# If not running, start it
agent-backend daemon --rootDir /tmp/agentbe-workspace

# Check if port is accessible from local machine
curl http://remote-server.com:3001/health
```

### SSE Connection Failed

**Symptom**: "Stream not found" or "Failed to send message"

**Fix**:
- Ensure dev server is running on expected port
- Check browser console for errors
- Verify POST to `/api/chat` completes successfully
- Check Network tab for SSE connection to `/api/chat/stream`

### Backend Connection Failed

- Verify `AGENTBE_WORKSPACE_ROOT` exists and is writable
- For remote: check SSH credentials and connectivity
- Check server logs for detailed error messages

### AI Not Responding

- Verify `OPENROUTER_API_KEY` is set correctly
- Check OpenRouter API status
- Review browser network tab for API errors

### Changes to agent-backend not appearing

**Cause**: Next.js cache issue

**Fix**:
```bash
rm -rf .next
pnpm run dev
```

## License

Part of the agent-backend project. See root LICENSE for details.
