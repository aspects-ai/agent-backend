# Backend Connection Pooling

For stateless web servers, `BackendPoolManager` provides backend reuse across requests. This is useful for distributed backend contexts where you have one host per user or organization.

## Usage

```typescript
import { BackendPoolManager, RemoteFilesystemBackend } from 'agent-backend'

const pool = new BackendPoolManager({
  backendClass: RemoteFilesystemBackend,
  defaultConfig: {
    rootDir: '/var/workspace',
    host: 'build-server.example.com',
    sshAuth: { type: 'password', credentials: { username: 'agent', password: 'pass' } }
  }
})
```

## Callback Pattern

The recommended approach uses `withBackend` for automatic acquire/release:

```typescript
app.post('/api/build', async (req, res) => {
  const output = await pool.withBackend(
    { key: req.user.id },
    async (backend) => {
      const projectBackend = backend.scope(`projects/${req.body.projectId}`)
      return await projectBackend.exec('npm run build')
    }
  )
  res.json({ output })
})
```

The backend is released even if the function throws.

## Key-Based Pooling

- Requests with the same key reuse the same backend if it's still connected.
- Requests without a key create a fresh (non-pooled) backend each time.
- Per-request config overrides are supported and merged with the pool's default config.

## Idle Cleanup

Backends with zero active usage that exceed the idle timeout are automatically destroyed. Periodic cleanup can be enabled via configuration:

```typescript
const pool = new BackendPoolManager({
  backendClass: RemoteFilesystemBackend,
  defaultConfig: { ... },
  enablePeriodicCleanup: true,
  idleTimeoutMs: 5 * 60 * 1000,      // 5 minutes (default)
  cleanupIntervalMs: 60 * 1000,       // 1 minute (default)
})
```

## Statistics

```typescript
const stats = pool.getStats()
// { totalBackends, activeBackends, idleBackends, backendsByKey }
```

## Graceful Shutdown

```typescript
process.on('SIGTERM', () => pool.destroyAll())
```

This destroys all pooled backends and their tracked resources (MCP clients, transports, connections).
