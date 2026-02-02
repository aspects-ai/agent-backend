# AgentBackend NextJS Demo

Interactive web application showcasing AgentBackend with dual AI routing, real-time streaming, and sophisticated agent orchestration.

🤖 **Dual AI Routing** • 🔄 **Real-time Streaming** • 📁 **Live File Explorer**  
🎨 **Component Sandbox** • 🛡️ **Isolated Workspaces** • 🌐 **Local + Remote Backends**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/agent-backend/agent-backend/tree/main/examples/NextJS)

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Environment Variables](#environment-variables)
- [Features](#features)
- [API Endpoints](#api-endpoints)
- [Try These Prompts](#try-these-prompts)
- [Deployment](#deployment)
- [How It Works](#how-it-works)
- [Usage Patterns](#usage-patterns)
- [Project Structure](#project-structure)
- [Technical Details](#technical-details)
- [Known Issues](#known-issues)
- [Troubleshooting](#troubleshooting)
- [What's Next](#whats-next)
- [Contributing](#contributing)

## Quick Start

### Path A: Local Development (5 minutes)

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.local.example .env.local
# Edit .env.local - set AGENTBE_WORKSPACE_ROOT and API keys

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Path B: Deploy to Vercel (1 click)

1. Click the "Deploy with Vercel" button above
2. Set environment variables in Vercel dashboard:
   - `AGENTBE_WORKSPACE_ROOT=/agentbe`
   - `OPENROUTER_API_KEY=your-key` (for MCP mode)
   - `NEXT_PUBLIC_CODEBUFF_API_KEY=your-key` (for Codebuff mode)
3. Deploy and visit your live demo

### Path C: Docker (Full Testing)

```bash
# Build and start services
docker-compose up --build
```

This starts:
- NextJS demo on `localhost:3000`
- Remote backend SSH service on `localhost:2222`

## Architecture

### Dual Routing System

The demo supports two distinct AI integration paths controlled by the `USE_MCP` environment variable:

```
┌─────────┐
│ Browser │
└────┬────┘
     │
     ▼
┌─────────────────┐
│  Next.js API    │
│  /api/message   │
└────┬────────────┘
     │
     ├─────────────┬──────────────┐
     │             │              │
USE_MCP=false  USE_MCP=true      │
     │             │              │
     ▼             ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Codebuff │  │ Vercel   │  │ Agent    │
│   SDK    │  │ AI + MCP │  │ Backend  │
└──────────┘  └──────────┘  └──────────┘
     │             │              │
     └─────────────┴──────────────┘
                   │
                   ▼
         ┌──────────────────┐
         │ Local/Remote FS  │
         │ /tmp/workspaces  │
         └──────────────────┘
```

### Routing Comparison

| USE_MCP | AI SDK | Integration | Use Case | Status |
|---------|--------|-------------|----------|--------|
| `false` | Codebuff SDK | Direct workspace access | Multi-agent orchestration | ⚠️ Implementation incomplete |
| `true` | Vercel AI SDK | MCP tools protocol | Standard streaming API | ✅ Fully working |

## Environment Variables

### Core Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENTBE_WORKSPACE_ROOT` | ✅ Yes | - | Root directory for agent workspaces (e.g., `/tmp/agent-workspaces`) |
| `NEXT_PUBLIC_AGENTBE_BACKEND_TYPE` | No | `local` | Backend type: `local` or `remote` |
| `USE_MCP` | No | `false` | Routing mode: `false` = Codebuff, `true` = Vercel AI + MCP |

### AI Provider Keys (choose based on USE_MCP)

| Variable | Required | Use When | Description |
|----------|----------|----------|-------------|
| `NEXT_PUBLIC_CODEBUFF_API_KEY` | Conditional | `USE_MCP=false` | Codebuff API key for direct agent orchestration |
| `OPENROUTER_API_KEY` | Conditional | `USE_MCP=true` | OpenRouter API key for Claude via Vercel AI SDK |

### Remote Backend (optional)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REMOTE_VM_HOST` | If remote | - | SSH hostname (e.g., `localhost`, `192.168.1.100`) |
| `REMOTE_VM_USER` | No | `root` | SSH username |
| `REMOTE_VM_PASSWORD` | If remote | - | SSH password |
| `REMOTE_VM_SSH_PORT` | No | `2222` | SSH port number |
| `REMOTE_MCP_AUTH_TOKEN` | No | - | MCP server authentication token |
| `REMOTE_MCP_PORT` | No | `3001` | MCP server HTTP port |

**Note**: The current `.env.local` file uses outdated `CONSTELLATION_*` naming. Use `AGENTBE_*` naming for compatibility with current AgentBackend API.

## Features

### 1. Dual AI Routing

Switch between two AI integration modes without changing frontend code:

**Codebuff SDK Mode** (`USE_MCP=false`):
- Direct workspace access via Codebuff SDK
- Designed for multi-agent orchestration
- Custom event handling for subagent lifecycle
- Currently has implementation gaps (see [Known Issues](#known-issues))

**Vercel AI SDK + MCP Mode** (`USE_MCP=true`):
- Standard MCP tools protocol
- Streaming text responses with tool calls
- Automatic backend selection (local stdio / remote HTTP)
- Production-ready implementation

```typescript
// Routing logic in /api/message
if (isMCPMode()) {
  // Vercel AI SDK path
  const mcpClient = await createMCPToolsClient(sessionId)
  const result = await streamText({
    model: getModel(),
    tools: mcpClient.tools,
    messages: [{ role: 'user', content: message }]
  })
} else {
  // Codebuff SDK path
  const client = await getCodebuffClient(fs, apiKey)
  const result = await client.run({ agent: 'base', prompt: message })
}
```

### 2. Multi-Agent Orchestration

The demo is designed to support sophisticated agent patterns (via Codebuff SDK):

**Planned Agents** (not yet implemented):
- **Orchestrator Agent** - Master coordinator for complex multi-step tasks
- **React TypeScript Builder** - Specialized UI component generator
- **ETL Manager** - Coordinates Extract → Transform → Load pipelines
- **Extract Agent** - Data extraction and web scraping
- **Transform Agent** - Data processing and transformation
- **Load Agent** - Database and file operations

**Current Status**: Multi-agent system architecture defined but not fully integrated. The demo currently uses a single base agent.

### 3. Component Sandbox

Live React component rendering with Sandpack integration:

- Real-time preview of generated React components
- Hot reload on file changes
- Isolated browser execution environment
- Automatic detection of JSX/TSX files

```typescript
// Component auto-detection
if (filename.endsWith('.jsx') || filename.endsWith('.tsx')) {
  // Render in Sandpack preview
  <Sandpack files={sandboxFiles} />
}
```

### 4. Live File Explorer

Real-time workspace visualization:

- Hierarchical file tree with collapsible folders
- Syntax highlighting for 20+ languages
- File upload/download functionality
- Auto-refresh after AI operations
- Inline file viewer with code highlighting

### 5. Cyberpunk UI

Modern interface built with Mantine components:

- Neon color scheme with dark theme
- Animated message transitions
- Matrix-style background effects
- Tabler icons throughout
- Responsive layout for mobile/desktop

### 6. Isolated Workspaces

Security-first session management:

- Unique workspace per session ID
- Scoped file operations (cannot escape workspace)
- Dangerous command blocking (rm -rf, sudo, etc.)
- Ephemeral storage with automatic cleanup
- No cross-session data leakage

## API Endpoints

| Endpoint | Method | Purpose | Key Parameters |
|----------|--------|---------|----------------|
| `/api/message` | POST | Send message to AI, initialize workspace | `message`, `sessionId`, `previousMessages` |
| `/api/stream` | GET | Server-Sent Events stream for AI responses | `sessionId` (query param) |
| `/api/filesystem` | GET | Get workspace file tree | `sessionId` (query param) |
| `/api/file-content` | GET | Read specific file contents | `sessionId`, `path` |
| `/api/upload` | POST | Upload files to workspace | `sessionId`, FormData |
| `/api/download` | GET | Download files from workspace | `sessionId`, `path` |
| `/api/sandbox-files` | GET | List files for component sandbox | `sessionId` |
| `/api/sandbox-render` | GET | Render component in sandbox | `sessionId`, `filename` |
| `/api/check-docker` | GET | Health check for Docker deployment | - |

### Example API Usage

```typescript
// Send message to AI
const response = await fetch('/api/message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: 'unique-session-id',
    message: 'Create a React counter component',
    previousMessages: []
  })
})

// Listen to streaming response
const eventSource = new EventSource(`/api/stream?sessionId=${sessionId}`)
eventSource.addEventListener('assistant_delta', (event) => {
  const data = JSON.parse(event.data)
  console.log('AI response chunk:', data.text)
})
```

## Try These Prompts

### Basic File Operations

```
"Create a README.md file explaining what this workspace is for"
"List all files in the current directory"
"Create a package.json for a Node.js project"
```

### Component Building

```
"Create a React counter component with increment/decrement buttons"
"Build a responsive dashboard layout with sidebar and main content"
"Create a data table component with sorting and filtering"
"Design a login form with email and password validation"
```

### Data Processing (ETL Pipeline)

```
"Find the top 10 coffee shops in San Francisco and save as JSON"
"Research Y Combinator startups in healthcare and create a summary"
"Extract product data from an API and transform it to CSV"
```

### Multi-File Projects

```
"Create a complete Express.js REST API with proper error handling"
"Build a Todo app with HTML, CSS, and vanilla JavaScript"
"Set up a basic Next.js application structure"
"Create a Python Flask app with routes and templates"
```

### Development Tasks

```
"Write a deployment script for a Node.js application"
"Create a GitHub Actions CI/CD pipeline configuration"
"Set up ESLint and Prettier configuration files"
"Generate TypeScript types from a JSON schema"
```

## Deployment

### Local Development

```bash
# Install dependencies
npm install

# Configure environment
cat > .env.local << ENV
AGENTBE_WORKSPACE_ROOT=/tmp/agent-workspaces
NEXT_PUBLIC_AGENTBE_BACKEND_TYPE=local
USE_MCP=true
OPENROUTER_API_KEY=your-openrouter-key
ENV

# Start dev server
npm run dev

# Visit http://localhost:3000
```

**Local Backend Requirements**:
- Node.js 18+ with npm/pnpm
- AgentBackend package installed
- Read/write access to `AGENTBE_WORKSPACE_ROOT`

### Docker Deployment

```bash
# Build images
docker-compose up --build

# Services:
# - web: http://localhost:3000
# - remote-backend: SSH on localhost:2222
```

**Known Issue**: Current `docker-compose.yml` has incorrect path references. The demo expects AgentBackend remote server setup separately.

### Vercel Deployment

**Recommended Configuration**:

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables
vercel env add AGENTBE_WORKSPACE_ROOT
# Enter: /tmp/agent-workspaces

vercel env add USE_MCP
# Enter: true

vercel env add OPENROUTER_API_KEY
# Enter: your-api-key
```

**Important Limitations**:
- 60-second function timeout (affects long AI operations)
- Ephemeral `/tmp` storage only (workspaces don't persist between invocations)
- Cannot use remote backends (no outbound SSH from serverless)
- Cold start latency (3-5 seconds for first request)

**Production Recommendations**:
- Use persistent storage (database, S3) for workspace data
- Implement request queuing for operations exceeding 60s
- Add authentication and rate limiting
- Monitor with Vercel Analytics or custom telemetry

## How It Works

### User Flow

1. **User sends message** via chat interface
2. **Session initialization** - Backend creates/verifies isolated workspace
3. **Routing decision** - Check `USE_MCP` flag to select AI backend
4. **AI processing**:
   - Codebuff mode: Direct workspace manipulation with custom events
   - MCP mode: Tool-based operations via standard protocol
5. **Backend operations** - File reads/writes, command execution in sandboxed environment
6. **Stream response** - SSE events push AI text, tool calls, and results to frontend
7. **UI updates** - File explorer refreshes, sandbox renders new components
8. **Session persistence** - Workspace remains available for follow-up messages

### Security Layers

**Workspace Isolation**:
- Each session gets unique directory: `/workspaces/{sessionId}/`
- Path validation prevents `../` escapes
- All file operations scoped to workspace root

**Command Safety**:
- Dangerous patterns blocked: `rm -rf /`, `sudo`, `eval`, `curl | sh`
- Shell injection prevention: backticks, `&&`, `||`, `;`
- Network tampering blocked: `iptables`, `ifconfig`

**Resource Limits**:
- Request timeouts (60s on Vercel, configurable locally)
- Workspace size limits (optional, not enforced by default)
- Concurrent operation limits via session management

## Usage Patterns

### Pattern 1: Current Demo (Archived API)

The demo uses an older AgentBackend API that's not in the current public release:

```typescript
import { AgentBackend, FileSystem } from 'agent-backend'

// Global config (not in current API)
AgentBackend.setConfig({ workspaceRoot: '/tmp/workspaces' })

// FileSystem wrapper (archived)
const fs = new FileSystem({
  type: 'local',
  userId: sessionId,
  preventDangerous: true
})

const workspace = await fs.getWorkspace('default')
await workspace.write('file.txt', 'content')
```

### Pattern 2: MCP Integration (Vercel AI SDK)

Production-ready approach using standard MCP protocol:

```typescript
import { experimental_createMCPClient } from '@ai-sdk/mcp'
import { streamText } from 'ai'
import { createFileSystem } from './backends-init'

// Create filesystem backend
const fs = createFileSystem(sessionId)

// Get MCP transport (stdio for local, HTTP for remote)
const transport = fs.getMCPTransport('default')

// Create MCP client
const mcpClient = await experimental_createMCPClient({ transport })
const tools = await mcpClient.tools()

// Use with Vercel AI SDK
const result = await streamText({
  model: getModel(),
  tools,
  messages: [{ role: 'user', content: 'Create a file' }]
})
```

### Pattern 3: Future Migration Path

Planned migration to current public AgentBackend API:

```typescript
import { LocalFilesystemBackend } from 'agent-backend'

// Create backend directly
const backend = new LocalFilesystemBackend({
  workspaceRoot: '/tmp/workspaces',
  preventDangerous: true
})

// Scope to user session
const userBackend = backend.scope(sessionId)

// Use MCP tools
const mcpClient = userBackend.getMCPClient()
const tools = await mcpClient.listTools()
```

## Project Structure

```
examples/NextJS/
├── app/
│   ├── api/                        # API routes
│   │   ├── message/route.ts        # AI message processing + dual routing
│   │   ├── stream/route.ts         # Server-Sent Events for responses
│   │   ├── filesystem/route.ts     # File tree retrieval
│   │   ├── file-content/route.ts   # Individual file read
│   │   ├── upload/route.ts         # File upload handling
│   │   ├── download/route.ts       # File download handling
│   │   ├── sandbox-files/route.ts  # Sandbox file listing
│   │   ├── sandbox-render/route.ts # Component rendering
│   │   └── check-docker/route.ts   # Health check
│   ├── components/                 # React components
│   │   ├── Chat.tsx               # Main chat interface with SSE
│   │   ├── FileExplorer.tsx       # File tree viewer
│   │   ├── FileViewer.tsx         # Syntax-highlighted file display
│   │   ├── ComponentSandbox.tsx   # Sandpack integration
│   │   ├── StatusBar.tsx          # Session info display
│   │   └── ApiKeyModal.tsx        # API key configuration
│   ├── page.tsx                   # Main page layout
│   ├── layout.tsx                 # App shell with Mantine provider
│   └── globals.css                # Cyberpunk theme styles
├── lib/                            # Shared utilities
│   ├── backends-init.ts           # AgentBackend configuration
│   ├── vercel-ai-init.ts          # Vercel AI + MCP setup
│   └── streams.ts                 # SSE broadcast utilities
├── public/                         # Static assets
├── .env.local                     # Environment variables (not in git)
├── docker-compose.yml             # Multi-service deployment
├── next.config.js                 # Next.js configuration
├── package.json                   # Dependencies
└── README.md                      # This file
```

## Technical Details

### Dual Routing Implementation

The routing decision happens in `/api/message/route.ts`:

```typescript
if (isMCPMode()) {
  // Vercel AI SDK path
  processWithVercelAI(message, sessionId, previousMessages)
} else {
  // Codebuff SDK path
  processWithCodebuff(fs, message, sessionId, previousRunState)
}
```

**MCP Mode** uses standard tool protocol:
- Tools exposed via MCP server (stdio or HTTP transport)
- Vercel AI SDK handles tool orchestration
- Streaming with built-in tool call/result events

**Codebuff Mode** uses direct integration:
- Custom event handling for `subagent_start`/`subagent_finish`
- Direct workspace access
- Manual streaming via event broadcaster

### Session Management

Sessions are identified by UUID v4:

```typescript
const sessionId = uuidv4() // e.g., "a3f2c1b4-..."
const workspace = `/workspaces/${sessionId}/`
```

Session cleanup strategies:
- **Ephemeral** (Vercel): Workspaces cleared between function invocations
- **TTL-based** (local): Clean up sessions inactive for > 24 hours
- **Manual**: User-initiated workspace deletion

### Server-Sent Events

Custom SSE broadcasting system in `lib/streams.ts`:

```typescript
// In-memory store of active connections
const streams = new Map<string, WritableStreamDefaultWriter>()

// Broadcast to session
broadcastToStream(sessionId, {
  type: 'assistant_delta',
  text: 'Hello '
})

// Client subscription
const eventSource = new EventSource(`/api/stream?sessionId=${sessionId}`)
```

**Event Types**:
- `message_start` - AI begins response
- `assistant_delta` - Text chunk
- `tool_use` - Tool invocation
- `tool_result` - Tool output
- `subagent_start` / `subagent_finish` - Multi-agent events
- `message_end` - Response complete
- `done` - Stream closed

### Safety Features

**Path Validation**:
```typescript
// All paths normalized and checked
const normalizedPath = path.resolve(workspaceRoot, userPath)
if (!normalizedPath.startsWith(workspaceRoot)) {
  throw new PathEscapeError('Path escapes workspace')
}
```

**Command Filtering**:
```typescript
const dangerous = [
  /rm\s+-rf\s+\//,           // Recursive delete from root
  /sudo/,                     // Privilege escalation
  /eval/,                     // Code injection
  /curl.*\|.*sh/,            // Remote execution
  /wget.*\|.*sh/
]
```

## Known Issues

### 1. Codebuff SDK Integration Incomplete

**Issue**: The Codebuff routing path references `getCodebuffClient` from `lib/codebuff-init.ts`, but this file doesn't exist.

**Impact**: `USE_MCP=false` mode will throw module not found error.

**Workaround**: Always use `USE_MCP=true` (Vercel AI + MCP mode).

**Status**: 🔴 Blocks Codebuff functionality

### 2. Archived FileSystem API

**Issue**: Demo uses `FileSystem` class and `AgentBackend.setConfig()` which are not in current public API.

**Code**:
```typescript
// Used in demo (not in public API)
import { AgentBackend, FileSystem } from 'agent-backend'
AgentBackend.setConfig({ workspaceRoot: '/tmp' })
const fs = new FileSystem({ type: 'local', userId: sessionId })
```

**Impact**: Code doesn't match published AgentBackend TypeScript package.

**Status**: 🟡 Works with local development build, breaks with published npm package

### 3. Environment Variable Naming Mismatch

**Issue**: `.env.local` uses old `CONSTELLATION_*` naming instead of `AGENTBE_*`.

**Example**:
```bash
# .env.local (outdated)
CONSTELLATION_WORKSPACE_ROOT=/tmp/workspaces
NEXT_PUBLIC_CONSTELLATION_BACKEND_TYPE=local

# Should be:
AGENTBE_WORKSPACE_ROOT=/tmp/workspaces
NEXT_PUBLIC_AGENTBE_BACKEND_TYPE=local
```

**Impact**: Confusing for new users, requires manual renaming.

**Status**: 🟡 Documentation updated, code still references old names

### 4. Docker Paths Incorrect

**Issue**: `docker-compose.yml` references paths that don't match repository structure.

**Status**: 🟡 Docker deployment not fully tested

### 5. Multi-Agent System Not Implemented

**Issue**: Agent files referenced in documentation (`lib/agents/orchestrator-agent.ts`, etc.) don't exist.

**Impact**: Multi-agent orchestration features are aspirational, not functional.

**Status**: 🔵 Planned feature, not a bug

### 6. No Pooling or MemoryBackend Demos

**Issue**: Demo doesn't showcase AgentBackend's connection pooling or MemoryBackend features.

**Impact**: Users can't learn these patterns from the demo.

**Status**: 🔵 Scope limitation, not a defect

### 7. Vercel Timeout Constraints

**Issue**: 60-second function timeout on Vercel Hobby plan.

**Impact**: Long-running AI operations may timeout.

**Workaround**: 
- Use shorter prompts
- Upgrade to Vercel Pro (300s timeout)
- Deploy to container platform (no timeout)

**Status**: 🟡 Platform limitation

## Troubleshooting

### "Module not found: lib/codebuff-init"

**Cause**: Using `USE_MCP=false` but Codebuff integration file is missing.

**Solution**: Set `USE_MCP=true` in `.env.local`:
```bash
USE_MCP=true
OPENROUTER_API_KEY=your-key
```

### "AGENTBE_WORKSPACE_ROOT is required"

**Cause**: Missing environment variable.

**Solution**: Add to `.env.local`:
```bash
AGENTBE_WORKSPACE_ROOT=/tmp/agent-workspaces
```

### Connection Refused (Remote Backend)

**Cause**: SSH service not running or wrong credentials.

**Diagnostics**:
```bash
# Test SSH connection
ssh -p 2222 constellation@localhost

# Check service
docker ps | grep remote-backend
```

**Solution**: Verify `REMOTE_VM_HOST`, `REMOTE_VM_PASSWORD`, `REMOTE_VM_SSH_PORT` match your SSH server.

### File Explorer Empty

**Cause**: Workspace initialization failed or wrong session ID.

**Diagnostics**: Check browser console and server logs:
```
[WORKSPACE] Checking workspace contents...
[WORKSPACE] Found 0 files
```

**Solution**: 
- Verify `AGENTBE_WORKSPACE_ROOT` has write permissions
- Send an initialization message to create workspace
- Refresh file explorer manually

### Streaming Stops Mid-Response

**Cause**: 
- Network interruption
- Server timeout (60s on Vercel)
- Backend error

**Solution**:
- Check browser console for EventSource errors
- Review server logs for exceptions
- If timeout, simplify prompt or upgrade Vercel plan

### "Invalid API Key"

**Cause**: Missing or incorrect API key for chosen mode.

**Solution**:
- MCP mode: Verify `OPENROUTER_API_KEY`
- Codebuff mode: Verify `NEXT_PUBLIC_CODEBUFF_API_KEY`
- Check key format (no extra spaces/quotes)

## What's Next

### Planned Improvements

- [ ] **Migrate to Public API** - Replace archived FileSystem wrapper with current AgentBackend API
- [ ] **Implement Multi-Agent System** - Add orchestrator and specialized agents
- [ ] **Fix Codebuff Integration** - Create missing `lib/codebuff-init.ts`
- [ ] **Add MemoryBackend Demo** - Show key/value storage patterns
- [ ] **Connection Pooling Example** - Demonstrate BackendPoolManager
- [ ] **Update Environment Variables** - Standardize on `AGENTBE_*` naming
- [ ] **Authentication** - Add user login and session persistence
- [ ] **Persistent Storage** - Save workspaces to database/S3
- [ ] **Workspace Templates** - Pre-configured project starters
- [ ] **Enhanced Logging** - Operation history and audit trails
- [ ] **Docker Fixes** - Correct compose file paths and test deployment
- [ ] **Mobile Optimization** - Improve responsive layout
- [ ] **Accessibility** - ARIA labels, keyboard navigation
- [ ] **Tests** - Unit and integration test coverage

### Feature Ideas

- **Collaborative Workspaces** - Multiple users in same session
- **Workspace Snapshots** - Save/restore workspace state
- **File Diff Viewer** - Show changes made by AI
- **Terminal Emulator** - Interactive shell in browser
- **Git Integration** - Commit, push, pull within workspace
- **Package Manager UI** - Visual npm/pip install interface
- **Cost Tracking** - Monitor API usage and token consumption

## Contributing

This demo is part of the AgentBackend project. Contributions welcome!

**How to Contribute**:

1. **Report Issues** - Use GitHub issues for bugs or feature requests
2. **Submit PRs** - Fork, branch, commit, push, open PR
3. **Improve Docs** - Fix typos, add examples, clarify instructions
4. **Share Feedback** - What works? What's confusing?

See main [Contributing Guide](../../CONTRIBUTING.md) for development guidelines.

**Priority Contributions**:
- Fix Codebuff SDK integration
- Migrate to current public API
- Add missing agent implementations
- Improve Docker deployment

## License

MIT - see [LICENSE](../../LICENSE) file for details.
