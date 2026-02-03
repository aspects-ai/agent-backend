# Agent Backend

**A plug-and-play memory and code execution backend for deep AI agents.**

Give your AI agents a single interface to interact with a backend supporting:

- Code execution
- Persistent storage
- Isolated sub-environments for multitenancy
- Sync to remote storage options including S3.

Supports MCP (Model Context Protocol) and direct integration with AI SDKs. Adapters for plug-and-play with leading AI agent SDKs.

[![npm version](https://badge.fury.io/js/agent-backend.svg)](https://badge.fury.io/js/agent-backend)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)

Deep agents that use long-running, potentially asynchronous or background processes need a reliable way to persist state. Many agents also benefit from shell access for tools like grep and find, plus the ability to execute code for scripting. Agent Backend provides a single interface consistent across local and remote execution, so there's no need to rewrite architecture to support your production environment.

**Available backends:**
- **Filesystem** - Execute code, run commands, manage files
- **Memory** - Fast in-memory key/value storage. Optional sync to S3.
- **Database** *(coming soon)* - Structured data and queries

Agent Backends run in a sandboxed environment to ensure isolation and security, with options including Docker container and remote VM isolation.

## Table of Contents

- [Quick Start](#quick-start)
- [Usage](#usage)
  - [Scoped Access](#scoped-access)
  - [MCP Integration](#mcp-integration)
  - [Security & Isolation](#security--isolation)
- [Integration with Agent SDKs](#integration-with-agent-sdks)
  - [Vercel AI SDK](#vercel-ai-sdk)
- [Backend Connection Pooling](#backend-connection-pooling)
- [Server Deployment](#server-deployment)
- [Advanced Features](#advanced-features)
- [Examples](#examples)
- [Error Handling](#error-handling)
- [TypeScript Support](#typescript-support)
- [Documentation](#documentation)
- [Development](#development)
- [License](#license)

---

## Quick Start

```bash
npm install agent-backend
```

### Memory Backend

Perfect for agent state, caching, and temporary data:

```typescript
import { MemoryBackend } from 'agent-backend'

const memory = new MemoryBackend()

await memory.write('session/user123/state', JSON.stringify({ step: 2 }))
const state = await memory.read('session/user123/state')
const sessions = await memory.list('session/')
```

### Filesystem Backend - Local

Execute code and manage files locally:

```typescript
import { LocalFilesystemBackend } from 'agent-backend'

const fs = new LocalFilesystemBackend({
  rootDir: '/tmp/agent-workspace'
})

await fs.exec('git clone https://github.com/user/repo.git .')
await fs.exec('npm install')
const output = await fs.exec('npm run build')

await fs.write('config.json', JSON.stringify({ version: '1.0' }))
const files = await fs.readdir('src')
```

### Filesystem Backend - Remote

Same API, operations run on a remote server via SSH:

```typescript
import { RemoteFilesystemBackend } from 'agent-backend'

const fs = new RemoteFilesystemBackend({
  rootDir: '/var/agent-workspace',
  host: 'build-server.example.com',
  sshAuth: {
    type: 'password',
    credentials: { username: 'agent', password: 'secure-pass' }
  }
})

// Same operations, executed remotely
await fs.exec('python script.py')
```

---

## Usage

### Scoped Access

Create isolated scopes for multi-tenancy:

```typescript
const fs = new LocalFilesystemBackend({
  rootDir: '/var/workspace'
})

// Each user gets an isolated scope
const user1 = fs.scope('users/user1')
const user2 = fs.scope('users/user2')

await user1.exec('npm install')  // isolated to users/user1/
await user2.exec('git init')     // isolated to users/user2/

// Scopes can be nested
const project = user1.scope('projects/my-app')
await project.exec('npm test')
```

**Scopes provide:**
- Path convenience (operations are relative)
- Safety (can't escape the scope)
- Isolation (OS-level when available)

### MCP Integration

Use Model Context Protocol for standardized agent integration. Each backend offers the option to create an MCP client to provide the full set of tools for backend access to the agent.

```typescript
const fs = new LocalFilesystemBackend({
  rootDir: '/tmp/workspace'
})

// Get MCP client
const mcp = await fs.getMCPClient()

// Use MCP tools
const result = await mcp.callTool({
  name: 'exec',
  arguments: { command: 'npm install' }
})

// Expose tools to the agent
const backendTools = await mcp.tools()
agent.run({
  tools: backendTools,
  ...
})

await mcp.close()
```

**Scoped MCP Access:**

```typescript
// MCP client scoped to specific directory
const mcp = await fs.getMCPClient('users/user1/projects/my-app')
```

### Security & Isolation

Agent Backend provides automatic isolation for safe multi-tenant operations.

**Isolation Levels:**

By default, `isolation: 'auto'` detects and uses the best available method:

1. **Bubblewrap** (Linux) - OS-level namespace isolation, no root needed
2. **Software** - Heuristics-based protection using path validation and dangerous operation blocking

```typescript
const fs = new LocalFilesystemBackend({
  rootDir: '/var/workspace',
  isolation: 'auto'  // default - uses bubblewrap if available
})
```

**Dangerous Operation Protection:**

Dangerous commands are blocked by default:

```typescript
await fs.exec('rm -rf /')      // ❌ Blocked
await fs.exec('sudo apt-get')  // ❌ Blocked
await fs.exec('curl ... | sh') // ❌ Blocked
```

Disable for trusted environments:

```typescript
const fs = new LocalFilesystemBackend({
  rootDir: '/var/workspace',
  preventDangerous: false  // allow all operations
})
```

---

## Integration with Agent SDKs

### Vercel AI SDK

Agent Backend provides seamless integration with Vercel's AI SDK through MCP transports:

```typescript
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp'
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

const fs = new LocalFilesystemBackend({ rootDir: '/tmp/workspace' })
const transport = fs.getMCPTransport()
const mcp = await createMCPClient({ transport })

const result = await generateText({
  model: openai('gpt-4'),
  tools: await mcp.tools(),
  prompt: 'List all TypeScript files in src/'
})

await mcp.close()
```

---

## Backend Connection Pooling

For stateless web servers, pool backends to reuse connections:

```typescript
import { BackendPoolManager } from 'agent-backend'

const pool = new BackendPoolManager({
  backendClass: RemoteFilesystemBackend,
  defaultConfig: {
    rootDir: '/var/workspace',
    host: 'build-server.example.com',
    sshAuth: { type: 'password', credentials: { username: 'agent', password: 'pass' } }
  }
})

// Callback pattern (automatic cleanup)
app.post('/api/build', async (req, res) => {
  const output = await pool.withBackend(
    { userId: req.user.id },
    async (backend) => {
      const projectBackend = backend.scope(`projects/${req.body.projectId}`)
      return await projectBackend.exec('npm run build')
    }
  )
  res.json({ output })
})

// Graceful shutdown
process.on('SIGTERM', () => pool.destroyAll())
```

**Use pooling for:**
- Remote backends (reuse SSH connections)
- Stateless web servers
- Long-running services

**Skip pooling for:**
- CLI tools
- Local-only backends
- Single-session scripts

---

## Server Deployment

### Docker (Recommended)

Start agentbe-daemon in Docker with a single command:

```bash
# Install agent-backend CLI
npm install -g agent-backend

# Start Docker container with agentbe-daemon
agent-backend start-docker

# Stop the container
agent-backend stop-docker
```

This starts a container with:
- **SSH daemon** on port 2222 (for direct file operations)
- **MCP server** on port 3001 (for tool execution)
- **Default credentials**: `root:agents`

Connect from your application:

```typescript
import { RemoteFilesystemBackend } from 'agent-backend'

const backend = new RemoteFilesystemBackend({
  rootDir: '/var/workspace',
  host: 'localhost',
  sshPort: 2222,
  mcpPort: 3001,
  sshAuth: {
    type: 'password',
    credentials: { username: 'root', password: 'agents' }
  }
})

await backend.connect()
await backend.exec('npm install')
```

### Local-Only Mode

For local development without Docker (works on macOS/Windows):

```bash
# Start agentbe-daemon in local-only mode (stdio MCP, no SSH)
agent-backend daemon --rootDir /tmp/workspace --local-only
```

### Cloud Deployment

See [typescript/deploy/README.md](./typescript/deploy/README.md) for cloud VM deployment options.

---

## Advanced Features

### Environment Variables

```typescript
const scopedBackend = fs.scope('projects/my-app', {
  env: {
    NODE_ENV: 'production',
    API_KEY: 'secret',
    DATABASE_URL: 'postgres://...'
  }
})

await scopedBackend.exec('npm run build')  // uses custom env
```

### Operations Logging

```typescript
import { ConsoleOperationsLogger } from 'agent-backend'

const scopedBackend = fs.scope('project', {
  operationsLogger: new ConsoleOperationsLogger()
})

await scopedBackend.exec('npm install')
// Logs: [AgentBackend] exec: npm install
```

### Binary Data

```typescript
const imageData = await fs.read('logo.png', { encoding: 'buffer' })
const tarball = await fs.exec('tar -czf - .', { encoding: 'buffer' })
```

### Timeouts

```typescript
const fs = new RemoteFilesystemBackend({
  rootDir: '/tmp/workspace',
  host: 'server.com',
  sshAuth: { ... },
  operationTimeoutMs: 300000,  // 5 minutes
  maxOutputLength: 10 * 1024 * 1024  // 10MB
})
```

---

## Examples

### Code Execution Sandbox

```typescript
const sandbox = new LocalFilesystemBackend({
  rootDir: '/tmp/sandbox',
  isolation: 'auto'
})

const userCodeBackend = sandbox.scope(`users/${userId}`)
await userCodeBackend.write('script.js', untrustedCode)
const result = await userCodeBackend.exec('node script.js')
```

### Multi-tenant SaaS

```typescript
// Separate backend per organization
const org1Backend = new RemoteFilesystemBackend({
  rootDir: '/var/saas/org1',
  host: 'org1-server.example.com',
  sshAuth: { ... }
})

const org2Backend = new RemoteFilesystemBackend({
  rootDir: '/var/saas/org2',
  host: 'org2-server.example.com',
  sshAuth: { ... }
})

// Scoped backends per user within each org
const org1User1 = org1Backend.scope('users/user1')
const org1User2 = org1Backend.scope('users/user2')

const org2User1 = org2Backend.scope('users/user1')
const org2User2 = org2Backend.scope('users/user2')
```

### Agent State Management

```typescript
const state = new MemoryBackend()

await state.write('agents/agent1/current-task', 'building')
await state.write('agents/agent1/progress', '50%')

const allAgents = await state.list('agents/')
```

---

## Error Handling

```typescript
import { BackendError, DangerousOperationError } from 'agent-backend'

try {
  await fs.exec('rm -rf /')
} catch (error) {
  if (error instanceof DangerousOperationError) {
    console.log('Blocked:', error.operation)
  } else if (error instanceof BackendError) {
    console.log('Error:', error.message)
  }
}
```

---

## TypeScript Support

Full type definitions included:

```typescript
import type {
  LocalFilesystemBackend,
  RemoteFilesystemBackend,
  MemoryBackend,
  ScopedBackend
} from 'agent-backend'

const fs: LocalFilesystemBackend = new LocalFilesystemBackend({
  rootDir: '/tmp/workspace'
})

const scopedBackend: ScopedBackend<LocalFilesystemBackend> = fs.scope('project')
```

---

## Documentation

- [API Reference](docs/api-reference.md)
- [Configuration Options](docs/configuration.md)
- [Security & Isolation](docs/security.md)
- [MCP Integration](docs/mcp.md)

---

## Development

This is a multi-language monorepo (TypeScript + Python). Use Makefile for all commands:

```bash
make help           # Show all available commands
make install        # Install dependencies (including mprocs)
make build          # Build all packages
make test           # Run all tests
make typecheck      # Type check everything
make ci             # Full CI pipeline
```

**Link CLI for development:**
```bash
cd typescript && pnpm link --global
```
This makes the `agent-backend` CLI available system-wide and keeps it synced with your dev changes.

### Development Mode

Start all dev processes with unified TUI:

```bash
make dev            # Local development (TypeScript + NextJS)
make dev-remote     # Test with Docker-based remote backend
```

Uses [mprocs](https://github.com/pvolok/mprocs) for process management with interactive TUI, auto-restart on changes, and Docker support.

**mprocs keyboard shortcuts:**
- `Tab`/`Shift+Tab` - Cycle through processes
- `Space` - Start/stop process
- `r` - Restart process
- `f` - Focus process (full screen)
- `/` - Search logs
- `q` - Quit all

Language-specific: `make build-typescript`, `make test-python`, etc.

---

### Development Workflows

#### Working on TypeScript Package

```bash
make dev

# In mprocs:
# 1. Watch typescript-watch logs to see compilation
# 2. Make changes to typescript/src/**
# 3. See rebuild happen automatically
# 4. NextJS picks up changes on next request
```

#### Working on NextJS Example

```bash
make dev

# In mprocs:
# 1. Focus on nextjs-dev logs (press f)
# 2. Make changes to examples/NextJS/app/**
# 3. See hot reload in browser
```

#### Testing Remote Backend Locally

```bash
make dev-remote     # Auto-builds Docker image if needed

# This simulates:
# - Remote server with MCP server on port 3001
# - SSH access on port 2222 (user: root, password: agents)
# - NextJS connecting to "remote" backend
```

#### Adding Python Examples

Edit `mprocs.yaml`:
```yaml
procs:
  python-app:
    cmd: ["python", "-m", "uvicorn", "main:app", "--reload"]
    cwd: "examples/python-app"
```

Then run `make dev` - Python app starts automatically.

---

### Docker Commands

```bash
make docker-build   # Build agentbe-daemon Docker image
make docker-clean   # Remove containers and images
```

Manual testing:
```bash
docker run --rm -it \
  -p 3001:3001 -p 2222:22 \
  -v "$(pwd)/tmp/remote-workspace:/var/workspace" \
  agentbe-daemon:latest

# Test: ssh -p 2222 root@localhost (password: agents)
# Test: curl http://localhost:3001/health
```

---

### Troubleshooting

**mprocs not found**
```bash
make install        # Includes mprocs (macOS: Homebrew, Linux: cargo)
```

**Port conflicts**
```bash
lsof -ti:3000 | xargs kill -9    # NextJS
lsof -ti:3001 | xargs kill -9    # MCP server
```

**TypeScript changes not appearing**
1. Check typescript-watch logs in mprocs
2. Verify compilation succeeded
3. Restart nextjs-dev (press `r` in mprocs)

**Remote mode not working**
1. Verify Docker image: `docker images | grep agentbe-daemon`
2. Check container: `docker ps | grep agentbe-daemon`
3. Test MCP: `curl http://localhost:3001/health`
4. View logs: `docker logs agentbe-daemon`

---

### Configuration

**mprocs.yaml** - All dev processes (edit to add new services)
**.env** - Daemon configuration (copy from `.env.example`)

Use `REMOTE=1 mprocs` or `make dev-remote` to enable the Docker daemon.

---

## License

MIT - see [LICENSE](LICENSE) file for details.

---

**Agent Backend**: The right backend for every agent task.
