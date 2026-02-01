# AgentBackend Web Demo

An interactive web demo showcasing AgentBackend with the Codebuff SDK. Chat with AI agents and watch as they create files, run commands, and build projects using AgentBackend.

## Features

- 🤖 **AI Chat Interface**: Chat with AI agents powered by AgentBackend and Codebuff SDK
- 📁 **Live File Explorer**: See filesystem changes in real-time
- 🔄 **Streaming Responses**: Watch AI responses stream in like ChatGPT
- 🛡️ **Safe Sandboxing**: Each session gets an isolated workspace
- ⚡ **Server-Sent Events**: Real-time updates without WebSockets

## Quick Start

### Local Development (Local Backend Only)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) - you'll have access to the local backend filesystem.

### Docker Development (Full Remote Backend Testing)

For testing remote backend functionality on macOS/Windows:

1. **Build native library first**:
   ```bash
   npx agent-backend build-native
   ```

2. **Start both services with Docker Compose**:
   ```bash
   docker-compose up --build
   ```

This starts:
- **NextJS** on `localhost:3000` (Linux container with LD_PRELOAD support)
- **agent-backend-remote** backend on `localhost:2222` (SSH service)

The web demo runs with LD_PRELOAD intercepting commands and routing them to the SSH backend.

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/agent-backend/agent-backend/tree/main/examples/NextJS)

1. **One-click deploy** using the button above
2. **Set environment variable**: Add your `ANTHROPIC_API_KEY` in Vercel dashboard
3. **Deploy**: Your demo will be live at `your-project.vercel.app`

### Manual Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variable
vercel env add ANTHROPIC_API_KEY
```

## How It Works

### Architecture

```
Browser ←→ Next.js API Routes ←→ AgentBackend ←→ Filesystem
   ↓              ↓                     ↓
Chat UI    AI Processing         File Operations
   ↑              ↑                     ↑
Server-Sent  Anthropic API      Isolated Workspace
Events       (Claude 3.5)        (/tmp/demo-${sessionId})
```

### API Endpoints

- `POST /api/message` - Send user message to AI
- `GET /api/stream` - Server-Sent Events for AI responses  
- `GET /api/filesystem` - Get current workspace file tree

### User Flow

1. User sends message via chat interface
2. Backend creates isolated AgentBackend workspace
3. AI processes message and performs filesystem operations
4. Response streams to frontend in real-time
5. File explorer updates when AI completes

## Try These Commands

Start a conversation with the AI assistant:

**Basic File Operations**:
- "Create a README.md file for a Python project"
- "List all files in the workspace"
- "Create a simple Node.js package.json"

**Development Tasks**:
- "Build a simple Express.js server"
- "Create a Python Flask hello world app"
- "Set up a basic React component"
- "Write a shell script to automate deployments"

**Project Building**:
- "Create a complete Todo app with HTML, CSS, and JavaScript"
- "Build a REST API with proper error handling"
- "Set up a basic CI/CD pipeline configuration"

## Technical Details

### Claude Code SDK Integration

The demo now uses the official Claude Code SDK with custom AgentBackend tools:

```typescript
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-code'
import { FileSystem } from 'agent-backend'

// Create AgentBackend tools for Claude
const agentBackendServer = createSdkMcpServer({
  name: "agent-backend",
  tools: [
    tool("fs_read", "Read file contents", /* ... */),
    tool("fs_write", "Write content to files", /* ... */),
    tool("fs_exec", "Execute shell commands", /* ... */),
    tool("fs_ls", "List files and directories", /* ... */)
  ]
})

// Query Claude with filesystem access
for await (const message of query({
  prompt: userMessage,
  options: {
    mcpServers: { agent-backend: agentBackendServer },
    allowedTools: ["mcp__agent-backend__fs_read", /* ... */]
  }
})) {
  // Stream responses to client
}
```

### Safety Features

- **Workspace Isolation**: Each session gets a unique `/tmp` directory
- **Dangerous Command Blocking**: AgentBackend prevents harmful operations
- **Ephemeral Storage**: Workspaces are temporary and auto-cleaned
- **Request Timeouts**: Long-running operations are limited

### Deployment Considerations

**Vercel Serverless**:
- ✅ Works great for demos and light usage
- ✅ Automatic scaling and global distribution
- ⚠️ Limited to `/tmp` directory (ephemeral)
- ⚠️ 60-second timeout for AI operations

**For Production**:
- Consider persistent storage (databases, cloud storage)
- Use container-based deployment for more control
- Implement user authentication and rate limiting
- Add monitoring and error tracking

## Development

### Project Structure

```
examples/NextJS/
├── app/
│   ├── api/
│   │   ├── message/route.ts    # AI message processing
│   │   ├── stream/route.ts     # Server-Sent Events
│   │   └── filesystem/route.ts # File tree API
│   ├── components/
│   │   ├── Chat.tsx           # Chat interface
│   │   └── FileExplorer.tsx   # File tree viewer
│   ├── page.tsx               # Main page
│   ├── layout.tsx             # App layout
│   └── globals.css            # Styles
├── package.json
├── next.config.js
├── vercel.json
└── README.md
```

### Key Features

**Real-time Updates**:
- Server-Sent Events for streaming AI responses
- Custom events for filesystem synchronization
- Automatic file explorer refresh after AI operations

**Session Management**:
- Random session IDs for workspace isolation
- Cleanup of inactive sessions
- Temporary file storage in `/tmp`

**Error Handling**:
- Graceful handling of AI API failures
- Filesystem operation error recovery
- Client-side connection management

## Contributing

This demo is part of the AgentBackend project. See the main [Contributing Guide](../../CONTRIBUTING.md) for development guidelines.

## License

MIT - see [LICENSE](../../LICENSE) file for details.