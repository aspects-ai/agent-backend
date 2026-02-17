# Agent Backend - Claude Development Guide

Secure, isolated backend for AI agents supporting code execution, file operations, and persistent storage.

## Project Structure

Multi-language monorepo (TypeScript + Python):

```
typescript/src/                # Core library (published as agent-backend)
├── backends/                  # Backend implementations
├── mcp/                       # MCP client integration
├── server/                    # MCP server implementation
│   ├── AgentBackendMCPServer.ts  # Unified adaptive server
│   ├── tools.ts               # MCP tool implementations
│   └── index.ts               # Server exports
├── logging/                   # Operations logging
├── BackendPoolManager.ts      # Connection pooling
├── safety.ts                  # Command safety validation
└── index.ts                   # Public exports

typescript/bin/                # CLI command
└── agent-backend.js           # MCP server CLI

typescript/deploy/             # Docker deployment
└── docker/                    # Remote backend service

python/                        # Python bindings (future)

Makefile                       # Multi-language build orchestration
manage.sh                      # Publishing & deployment
pnpm-workspace.yaml            # TypeScript workspace config
```

## Architecture

### Backend Types
- **LocalFilesystemBackend** - File operations + command execution on local machine
- **RemoteFilesystemBackend** - Same API via SSH to remote server
- **MemoryBackend** - In-memory key/value storage (no exec)
- **Scoped Backends** - Wrap any backend to restrict operations to a subdirectory

### Key Patterns
1. **Scoping** - `.scope(path)` creates isolated sub-environments for multi-tenancy
2. **Pooling** - `BackendPoolManager` reuses connections for stateless servers
3. **MCP Integration** - `.getMCPClient()` exposes tools via Model Context Protocol
4. **Security Layers** - Command validation, path escape prevention, isolation modes
5. **Resource Lifecycle** - `destroy()` auto-closes tracked MCP clients/transports; `trackCloseable()` registers external resources

### Isolation Modes
- `'auto'` - Detects best available (bubblewrap → software)
- `'bwrap'` - Linux namespace isolation via bubblewrap
- `'software'` - Heuristics-based path/command validation
- `'none'` - No isolation (trust mode)

## Code Style

**TypeScript Standards:**
- No semicolons, single quotes (ESLint enforced)
- Explicit types, avoid `any`
- Zod schemas for config validation
- Custom error classes (`BackendError`, `DangerousOperationError`, `PathEscapeError`)

**Import Patterns:**
```typescript
import type { Backend, FileBasedBackend } from './types.js'
import { LocalFilesystemBackend } from './backends/LocalFilesystemBackend.js'
```

- No inline `@import`. Use static imports at the top. 

## Testing

### Unit Tests (Vitest)
```bash
pnpm test --run              # Run all tests
pnpm test -t "pattern"       # Run matching tests
```

**Test Structure:**
- `typescript/tests/unit/` - Unit tests with mocked I/O
- `typescript/tests/unit/server/` - MCP server tests
- Global setup in `tests/unit/setup.ts` mocks child_process and fs/promises

**Mock Pattern:**
```typescript
import { vi } from 'vitest'
import { createMockSpawn } from './helpers/mockFactories.js'

vi.mocked(child_process.spawn).mockReturnValue(
  createMockSpawn({ stdout: 'output', exitCode: 0 })
)
```

**IMPORTANT:** Unit tests use global mocks to prevent real I/O. If you see "UNIT TEST VIOLATION" errors, you forgot to mock the operation.

## Security

### Command Safety (safety.ts)
```typescript
isDangerous(command)          // Returns true for dangerous commands
isCommandSafe(command)        // Returns { safe, reason }
```

**Dangerous patterns blocked:**
- Destructive: `rm -rf /`, `dd if=/dev/zero`
- Privilege escalation: `sudo`, `su`
- Remote execution: `curl ... | sh`, `eval`
- Shell injection: `;`, `&&`, `||`, backticks, `$()`
- Network tampering: `iptables`, `ifconfig`

### Path Validation
- Absolute paths treated as relative to scope
- `..` traversal blocked if escapes scope
- Workspace boundaries enforced at multiple layers

## Common Commands

```bash
# Development
pnpm install                 # Install dependencies
pnpm run build              # Build packages
pnpm run typecheck          # Verify types
pnpm test --run             # Run all tests

# Monorepo structure
pnpm -r <command>           # Run in all packages
```

## Development

**Build System**: Makefile for multi-language orchestration

```bash
make help           # Show all commands
make build          # Build all packages
make test           # Run all tests
make typecheck      # Type check everything
make ci             # Full CI pipeline
```

Language-specific: `make build-typescript`, `make test-python`

**Workspace**: pnpm manages TypeScript package (`typescript`). Python managed separately.

**Package Names**: `agent-backend` (unified package with library + CLI + server)

**Key Notes**:
- Scoped backends read `connected` from parent dynamically (getter, not property)
- BackendPoolManager supports per-request config overrides
- AgentBackendMCPServer uses duck typing for exec capability detection
- Single adaptive server replaces separate LocalFilesystem/Remote/Memory server classes
- `destroy()` closes all tracked closeables (MCP clients, transports) before tearing down the backend
- Scoped backends delegate `trackCloseable()` to their parent backend

## Key Files to Understand

1. **typescript/src/backends/LocalFilesystemBackend.ts** - Core implementation, ~500 LOC
2. **typescript/src/backends/ScopedFilesystemBackend.ts** - Scoping logic, path translation
3. **typescript/src/BackendPoolManager.ts** - Connection pooling for stateless servers
4. **typescript/src/safety.ts** - Command safety validation patterns
5. **typescript/src/server/AgentBackendMCPServer.ts** - Adaptive MCP server with duck typing
6. **typescript/bin/agent-backend.js** - CLI for starting MCP servers

## Error Handling

```typescript
try {
  await backend.exec(command)
} catch (error) {
  if (error instanceof DangerousOperationError) {
    console.log('Blocked dangerous command:', error.command)
  } else if (error instanceof PathEscapeError) {
    console.log('Path escapes scope:', error.path)
  } else if (error instanceof BackendError) {
    console.log('Backend error:', error.message, error.code)
  }
}
```

## Contributing

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)
- Add tests for new features (unit tests required)
- Update JSDoc for public APIs
- Run `pnpm test --run` before committing
