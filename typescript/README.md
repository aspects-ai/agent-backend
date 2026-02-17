# TypeScript Client Library

TypeScript implementation of the `agent-backend` package. See the [main README](../README.md) for an overview, quick start, and core usage.

## Package Info

| Field       | Value                          |
|-------------|--------------------------------|
| Package     | `agent-backend`                |
| Registry    | npm                            |
| Manager     | pnpm                           |
| Test runner | Vitest                         |
| Build       | Vite                           |
| Linter      | ESLint                         |
| Source       | `typescript/src/`              |
| Tests        | `typescript/tests/unit/`       |

## Advanced Features

### Environment Variables

Scoped backends support custom environment variables that apply to all commands:

```typescript
const scopedBackend = backend.scope('projects/my-app', {
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

const scopedBackend = backend.scope('project', {
  operationsLogger: new ConsoleOperationsLogger()
})

await scopedBackend.exec('npm install')
// Logs: [AgentBackend] exec: npm install
```

### Binary Data

```typescript
const imageData = await backend.read('logo.png', { encoding: 'buffer' })
const tarball = await backend.exec('tar -czf - .', { encoding: 'buffer' })
```

### Timeouts

```typescript
const backend = new RemoteFilesystemBackend({
  rootDir: '/tmp/agentbe-workspace',
  host: 'server.com',
  sshAuth: { ... },
  operationTimeoutMs: 300000,  // 5 minutes
  maxOutputLength: 10 * 1024 * 1024  // 10MB
})
```

## Backend Connection Pooling

See [docs/connection-pooling.md](../docs/connection-pooling.md) for `BackendPoolManager` usage, key-based pooling, idle cleanup, and graceful shutdown.

## Examples

### Code Execution Sandbox

```typescript
const sandbox = new LocalFilesystemBackend({
  rootDir: '/tmp/agentbe-workspace',
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
```

### Agent State Management

```typescript
const state = new MemoryBackend()

await state.write('agents/agent1/current-task', 'building')
await state.write('agents/agent1/progress', '50%')

const allAgents = await state.list('agents/')
```

## Error Handling

```typescript
import { BackendError, DangerousOperationError, PathEscapeError } from 'agent-backend'

try {
  await backend.exec('rm -rf /')
} catch (error) {
  if (error instanceof DangerousOperationError) {
    // Command blocked by safety validation
    console.log('Blocked:', error.operation)
  } else if (error instanceof PathEscapeError) {
    // Path attempted to escape scope
  } else if (error instanceof BackendError) {
    // General backend error (check error.code)
    console.log('Error:', error.code, error.message)
  }
}
```

---

## Development

### Commands

All commands can be run from the monorepo root via Make or from the `typescript/` directory via pnpm.

| Task        | Make (root)              | pnpm (`typescript/`)    |
|-------------|--------------------------|-------------------------|
| Build       | `make build-typescript`  | `pnpm run build`        |
| Test        | `make test-typescript`   | `pnpm test --run`       |
| Test (watch)| --                       | `pnpm test`             |
| Lint        | `make lint-typescript`   | `pnpm run lint`         |
| Lint (fix)  | `make lint-fix`          | `pnpm run lint:fix`     |
| Typecheck   | `make typecheck`         | `pnpm run typecheck`    |

### Code Style

- No semicolons
- Single quotes
- Explicit types -- avoid `any`
- `.js` extensions in all imports (e.g., `import { Foo } from './types.js'`)
- Zod schemas for config validation
- Custom error classes: `BackendError`, `DangerousOperationError`, `PathEscapeError`

ESLint enforces these rules. Run `make lint-fix` or `pnpm run lint:fix` to auto-fix.

### Testing

#### Unit Tests

Tests live in `typescript/tests/unit/` and use Vitest with global mocks.

The global setup file (`tests/unit/setup.ts`) mocks `child_process` and `fs/promises` to prevent real I/O during tests. If a test calls a real I/O function without mocking it first, it throws a **"UNIT TEST VIOLATION"** error. This is intentional -- always mock before calling code under test.

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

Use the provided helper factories (`createMockSpawn`, `createMockFileBackend`) rather than building mocks from scratch.

#### Running Tests

```bash
pnpm test --run              # All tests, single run
pnpm test -t "safety"        # Filter by pattern
pnpm test --coverage         # With coverage report
```

### Gotchas

- Scoped backends read `connected` from the parent dynamically via a getter, not a copied property.
- `BackendPoolManager` supports per-request config overrides.
- `AgentBackendMCPServer` uses duck typing to detect exec capability -- it does not check backend type.
- A single adaptive server class replaces the old separate LocalFilesystem/Remote/Memory server classes.
- `destroy()` closes all tracked closeables (MCP clients, transports) before tearing down the backend.
- Scoped backends delegate `trackCloseable()` to their parent backend, so resources are closed when the parent is destroyed.
- When `preventDangerous: false`, `isCommandSafe()` should not be called.
- Absolute paths are treated as relative to scope; `..` is blocked if it escapes.
- `BackendType` enum values are `'local-filesystem'`, `'remote-filesystem'`, `'memory'` (not `'local'`, `'remote'`).
- `MemoryBackend.exec()` throws `NotImplementedError`.

### Development Workflows

#### Working on the TypeScript Package

```bash
make dev
```

This starts the mprocs TUI with TypeScript watch mode. Edit files under `typescript/src/` and watch the build output in the mprocs pane. The watcher rebuilds on every change.

### Docker

Build the `agentbe-daemon` Docker image:

```bash
make docker-build
```

The image is used by `make dev` to simulate a remote deployment. The Docker daemon exposes:

- Port 3001: MCP server
- Port 2222: SSH access

### Troubleshooting

#### Port Conflicts

If ports 3000, 3001, or 2222 are in use:

```bash
lsof -ti:3001 | xargs kill -9    # MCP server
lsof -ti:3000 | xargs kill -9    # NextJS
```

#### TypeScript Changes Not Appearing

1. Check the typescript-watch pane in mprocs for compilation errors.
2. Verify the build succeeded (no red output).
3. Restart the dependent process by selecting it in mprocs and pressing `r`.

#### Remote Mode Issues

1. Verify the Docker image exists: `docker images | grep agentbe-daemon`
2. Check the container is running: `docker ps | grep agentbe-daemon`
3. Test the MCP endpoint: `curl http://localhost:3001/health`
4. View container logs: `docker logs agentbe-daemon`
