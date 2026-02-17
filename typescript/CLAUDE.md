# AgentBackend TypeScript - Development Guide

Secure, isolated backend for AI agents.

## Quick Reference

### Development Commands

From monorepo root (recommended):
```bash
make build-typescript   # Build this package
make test-typescript    # Run tests
make typecheck          # Type check all packages
```

From this directory:
```bash
pnpm run build       # Production build
pnpm run typecheck   # TypeScript validation
pnpm test --run      # Run tests once
pnpm test            # Run tests in watch mode
```

### Running agentbe-daemon

```bash
# Local-only mode (works on macOS/Windows, no SSH)
pnpm run build && node bin/agent-backend.js daemon --rootDir /tmp/agentbe-workspace --local-only

# Local-only mode with custom port
agent-backend daemon --rootDir /tmp/agentbe-workspace --local-only --mcp-port 3456

# Full daemon mode (Linux only, requires root)
agent-backend daemon --rootDir /var/workspace --mcp-auth-token <token>
```

### Package Info

- **Package name**: `agent-backend` (npm)
- **Module name**: `agent-backend`
- **Version**: 0.6.x
- **CLI Command**: `agent-backend` (includes MCP server)

## Project Structure

```
src/
├── backends/                   # Backend implementations
│   ├── LocalFilesystemBackend.ts    # Local file + exec
│   ├── RemoteFilesystemBackend.ts   # Remote via SSH
│   ├── MemoryBackend.ts             # In-memory key/value
│   ├── ScopedFilesystemBackend.ts   # Filesystem scoping wrapper
│   ├── ScopedMemoryBackend.ts       # Memory scoping wrapper
│   ├── pathValidation.ts            # Path security
│   └── index.ts                     # Backend exports
├── mcp/                        # MCP integration
│   ├── client.ts               # HTTP MCP client (remote)
│   ├── server.ts               # MCP server (archived)
│   └── local-client.ts         # Stdio MCP client (BROKEN - can delete)
├── logging/                    # Operations loggers
│   ├── types.ts
│   ├── ArrayOperationsLogger.ts
│   └── ConsoleOperationsLogger.ts
├── utils/                      # Utilities
│   ├── logger.ts
│   └── detectPlatform.ts
├── BackendPoolManager.ts       # Connection pooling
├── safety.ts                   # Command safety validation
├── types.ts                    # Error classes & types
├── constants.ts                # Error codes
└── index.ts                    # Public API exports

tests/unit/                     # Unit tests (Vitest)
├── setup.ts                    # Global mocks (child_process, fs)
├── helpers/
│   ├── mockFactories.ts        # Mock creation utilities
│   └── testUtils.ts
├── backends/                   # Backend tests
├── security/                   # Security tests
└── pooling/                    # Pool manager tests
```

## Terminology

**agentbe-daemon (Agent Backend Daemon)**:
- The `agent-backend` CLI process running as a daemon
- Serves a local filesystem remotely via MCP and SSH
- Always serves its LOCAL filesystem (it's "remote" from client's perspective if also served via SSH/MCP on HTTP)
- Example: `agent-backend daemon --rootDir /var/workspace`

**Backend (Client-Side Interface)**:
- `LocalFilesystemBackend` - Direct local filesystem access
  - Client-side only, no daemon needed
  - For local development
- `RemoteFilesystemBackend` - Connects to remote agentbe-daemon
  - Uses SSH for direct ops + HTTP for MCP tools
  - For production deployments
- `MemoryBackend` - In-memory key/value storage
  - Client-side only, no daemon needed
  - For testing

**Key Points**:
- MemoryBackend never needs a daemon (client-side only)
- RemoteFilesystemBackend connects TO agentbe-daemon (client → daemon)

## Architecture

### Backend Classes (CLIENT-SIDE ONLY)

**File-based backends:**
- `LocalFilesystemBackend` - Local filesystem + command execution
- `RemoteFilesystemBackend` - Remote operations via SSH + MCP
- Both support: `read()`, `write()`, `readdir()`, `mkdir()`, `exists()`, `stat()`, `exec()`

**Memory backend:**
- `MemoryBackend` - In-memory key/value storage
- Supports: `read()`, `write()`, `list()`, `exists()`, `delete()`
- NO exec support (throws NotImplementedError)

**Scoped backends:**
- `ScopedFilesystemBackend` - Wraps file backend, restricts to subdirectory
- `ScopedMemoryBackend` - Wraps memory backend, restricts to key prefix
- Created via `backend.scope(path)` or `backend.scope(path, { env })`

### Key Patterns

1. **Direct instantiation** - No factory, create backends directly
2. **Scoping for isolation** - Multi-tenancy via `.scope()`
3. **Connection pooling** - `BackendPoolManager` for stateless servers
4. **MCP integration** - `.getMCPClient()` for protocol support
5. **Resource lifecycle** - `destroy()` auto-closes tracked MCP clients/transports; `trackCloseable()` registers external resources

## Usage Examples

### Local Filesystem Backend

```typescript
import { LocalFilesystemBackend } from 'agent-backend'

const fs = new LocalFilesystemBackend({
  rootDir: '/tmp/agentbe-workspace',
  isolation: 'auto',           // bwrap or software
  preventDangerous: true       // block dangerous commands
})

await fs.exec('npm install')
await fs.write('config.json', '{}')
const files = await fs.readdir('src')
```

### Remote Filesystem Backend

```typescript
import { RemoteFilesystemBackend } from 'agent-backend'

const remote = new RemoteFilesystemBackend({
  rootDir: '/var/workspace',
  host: 'build-server.com',
  sshAuth: {
    type: 'password',
    credentials: { username: 'agent', password: 'secret' }
  }
})

await remote.exec('git pull')
```

### Scoped Access

```typescript
const userBackend = fs.scope('users/user123')
const projectBackend = userBackend.scope('projects/my-app', {
  env: { NODE_ENV: 'production' }
})

await projectBackend.exec('npm run build')  // runs in users/user123/projects/my-app
```

### Backend Pooling

```typescript
import { BackendPoolManager } from 'agent-backend'

const pool = new BackendPoolManager({
  backendClass: RemoteFilesystemBackend,
  defaultConfig: { rootDir: '/var/workspace', host: '...', sshAuth: {...} }
})

await pool.withBackend({ key: userId }, async (backend) => {
  const userScope = backend.scope(`users/${userId}`)
  return await userScope.exec('npm test')
})
```

## Testing

### Unit Tests with Vitest

**Global mocks** in `tests/unit/setup.ts`:
- All `child_process` methods throw "UNIT TEST VIOLATION" errors
- All `fs/promises` methods return rejected promises
- Must mock before code executes

**Mock pattern:**
```typescript
import { vi } from 'vitest'
import { createMockSpawn } from './helpers/mockFactories.js'

beforeEach(() => {
  vi.mocked(child_process.spawn).mockReturnValue(
    createMockSpawn({ stdout: 'output', exitCode: 0 })
  )

  vi.mocked(fs.writeFile).mockResolvedValue(undefined)
})
```

**Important:**
- NEVER use real I/O in unit tests
- Mock BEFORE calling code under test
- Use `createMockSpawn()`, `createMockFileBackend()` helpers

### Running Tests

```bash
pnpm test --run              # All tests once
pnpm test -t "safety"        # Filter by pattern
pnpm test --coverage         # With coverage
```

## Code Style

- **No semicolons**, single quotes (ESLint enforced)
- **Explicit types**, avoid `any`
- **Import with .js extension** - `from './types.js'`
- **Error classes** - `BackendError`, `DangerousOperationError`, `PathEscapeError`
- **Zod validation** - All config schemas

## Security

### Command Safety (safety.ts)

```typescript
isDangerous(command)          // true for rm -rf /, sudo, etc.
isCommandSafe(command)        // { safe: boolean, reason?: string }
```

**Blocked patterns:**
- Destructive: `rm -rf /`, `dd of=/dev/sda`
- Shell injection: `;`, `&&`, `||`, backticks, `$()`
- Privilege: `sudo`, `su`
- Network: `curl | sh`, `iptables`

### Isolation Modes

- `'auto'` - Uses bubblewrap if available, else software
- `'bwrap'` - Linux namespace isolation (OS-level)
- `'software'` - Path/command validation only
- `'none'` - No isolation (trust mode)

## MCP Integration

### Get MCP Client

```typescript
const mcp = await backend.getMCPClient()
const tools = await mcp.listTools()

await mcp.callTool({
  name: 'exec',
  arguments: { command: 'npm install' }
})

// destroy() auto-closes MCP clients, transports, and backend resources
await backend.destroy()
```

### Scoped MCP

```typescript
const mcp = await backend.getMCPClient('users/user123/projects/my-app')
```

## Common Gotchas

1. **Scoped connection status** - Scoped backends read `connected` from parent dynamically (getter, not property)
2. **preventDangerous** - When `false`, `isCommandSafe()` should NOT be called (implementation bug was fixed)
3. **Path escapes** - Absolute paths are treated as relative to scope, `..` blocked if escapes
4. **BackendType enum** - Values are `'local-filesystem'`, `'remote-filesystem'`, `'memory'` (not `'local'`, `'remote'`)
5. **MemoryBackend.exec()** - Throws NotImplementedError, not supported
6. **Scoped trackCloseable** - Scoped backends delegate `trackCloseable()` to their parent, so resources are closed when the parent is destroyed

## Files Safe to Delete

- `src/mcp/local-client.ts` - Broken, references non-existent config, not exported
- `src/config/` directory - Empty, old architecture

## Contributing

- Use Conventional Commits: `feat:`, `fix:`, `docs:`
- Add unit tests (required)
- Update JSDoc for public APIs
- Run `pnpm test --run` before committing
- Check types: `pnpm run typecheck`
