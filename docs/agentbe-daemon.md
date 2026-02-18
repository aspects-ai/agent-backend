# Agent Backend Daemon (agentbe-daemon)

The **agentbe-daemon** is the server component that provides MCP (Model Context Protocol) and SSH-over-Websockets access to a filesystem backend. It can run in two modes:

1. **Local-only mode** (stdio) - For local development, spawned as a subprocess
2. **Full daemon mode** (MCP + SSH) - For production, serves multiple clients

## Quick Start

### Local Development (stdio mode)

```bash
# Start daemon in local-only mode
agent-backend daemon --rootDir /tmp/agentbe-workspace --local-only

# With static scoping
agent-backend daemon --rootDir /tmp/agentbe-workspace --scopePath users/user1 --local-only
```

### Production (HTTP + SSH mode)

```bash
# Start full daemon (Linux only, requires root)
agent-backend daemon --rootDir /var/workspace --mcp-auth-token secret123

# Or use Docker
agent-backend start-docker
```

## Scoping

Scoping restricts all operations to a subdirectory within `rootDir`. This is essential for multi-tenancy.

### Static Scoping (CLI)

Set scope at daemon startup using `--scopePath`:

```bash
agent-backend daemon --rootDir /tmp/agentbe-workspace --scopePath users/user1 --local-only
```

All operations are now restricted to `/tmp/agentbe-workspace/users/user1/`.

**Use cases:**
- Local development with a specific user context
- Spawning one daemon per user/tenant
- Stdio mode (where per-request scoping isn't possible)

### Dynamic Scoping (HTTP Header)

For HTTP mode, clients can specify scope per-request using the `X-Scope-Path` header:

```typescript
// Client-side (RemoteFilesystemBackend handles this automatically)
const transport = createAgentBeMCPTransport({
  url: 'http://backend:3001',
  authToken: 'secret',
  rootDir: '/var/workspace',
  scopePath: 'users/user1'  // Sent as X-Scope-Path header
})
```

**Use cases:**
- Multi-tenant production deployments
- Single daemon serving multiple users
- Per-request user isolation

### Scope Conflict Detection

Using both static (`--scopePath`) and dynamic (`X-Scope-Path`) scoping simultaneously is not allowed. The daemon returns a 400 error:

```
HTTP 400: Scope conflict
Server was started with static scope 'users/admin', but request also specified
scope 'users/user1'. Use one or the other, not both.
```

### Scope vs Combined rootDir

There are two ways to achieve the same effective path:

```bash
# Option 1: Combined rootDir (no scoping)
agent-backend daemon --rootDir /tmp/agentbe-workspace/users/user1 --local-only

# Option 2: Separate rootDir + scopePath (with scoping)
agent-backend daemon --rootDir /tmp/agentbe-workspace --scopePath users/user1 --local-only
```

**Key difference:** With Option 2, the daemon creates a scoped backend which provides additional isolation guarantees and cleaner path handling.

## Command Reference

### daemon command

```bash
agent-backend daemon --rootDir <path> [OPTIONS]
```

#### Required Options

| Option | Description |
|--------|-------------|
| `--rootDir <path>` | Root directory to serve |

#### Mode Options

| Option | Description |
|--------|-------------|
| `--local-only` | Run MCP server via stdio (no SSH, no HTTP). Works on any platform. |

#### Scoping Options

| Option | Description |
|--------|-------------|
| `--scopePath <path>` | Static scope path within rootDir. All operations restricted to this subdirectory. |

#### MCP Server Options

| Option | Default | Description |
|--------|---------|-------------|
| `--mcp-port <port>` | 3001 | HTTP server port (only used without `--local-only`) |
| `--mcp-auth-token <token>` | none | Bearer token for MCP endpoint authentication |
| `--isolation <mode>` | auto | Command isolation: `auto`, `bwrap`, `software`, `none` |
| `--shell <shell>` | auto | Shell to use: `bash`, `sh`, `auto` |

#### SSH Options (full daemon mode only)

| Option | Default | Description |
|--------|---------|-------------|
| `--ssh-users <users>` | `root:agents` | Comma-separated `user:password` pairs |
| `--ssh-public-key <key>` | none | SSH public key to add to authorized_keys |
| `--ssh-authorized-keys <path>` | none | Path to authorized_keys file to copy |

## Transport Modes

### Stdio Mode (local-only)

Used by `LocalFilesystemBackend` and `MemoryBackend` for local development:

```
┌─────────────────┐         ┌─────────────────┐
│  Your App       │  stdio  │  agentbe-daemon │
│  (MCP Client)   │◄───────►│  (MCP Server)   │
└─────────────────┘         └─────────────────┘
```

- Single persistent connection
- Scoping is static (set at startup via `--scopePath`)
- No authentication (process-level isolation)

### HTTP Mode (full daemon)

Used by `RemoteFilesystemBackend` for production:

```
┌─────────────────┐   HTTP    ┌─────────────────┐
│  Your App       │◄─────────►│  agentbe-daemon │
│  (MCP Client)   │   :3001   │  (MCP Server)   │
└─────────────────┘           └─────────────────┘
                    SSH/SFTP
                   ◄─────────►
                      :22
```

- Request/response model
- Scoping can be static (CLI) or dynamic (per-request header)
- Authentication via bearer token (`--mcp-auth-token`)

## Examples

### Local Development

```bash
# Simple local development
agent-backend daemon --rootDir /tmp/agentbe-workspace --local-only

# With software isolation (safer command execution)
agent-backend daemon --rootDir /tmp/agentbe-workspace --local-only --isolation software

# Scoped to a specific user directory
agent-backend daemon --rootDir /tmp/agentbe-workspace --scopePath users/testuser --local-only
```

### Production Deployment

```bash
# Basic production setup
agent-backend daemon --rootDir /var/workspace \
  --mcp-auth-token "$(openssl rand -hex 32)"

# With static scoping (one daemon per tenant)
agent-backend daemon --rootDir /var/workspace \
  --scopePath "tenant-123" \
  --mcp-auth-token "secret"

# Full configuration
agent-backend daemon --rootDir /var/workspace \
  --mcp-port 3001 \
  --mcp-auth-token "secret" \
  --isolation bwrap \
  --shell bash \
  --ssh-users "admin:adminpass,deploy:deploypass"
```

### Docker

```bash
# Start Docker container
agent-backend start-docker

# Start with rebuild
agent-backend start-docker --build

# Stop container
agent-backend stop-docker
```

The Docker container runs:
- SSH daemon on port 2222
- MCP server on port 3001
- Default credentials: `root:agents`

## Security Considerations

### Path Validation

- `--scopePath` cannot contain `..` (path traversal)
- Leading slashes are stripped from scopePath
- All paths are validated to stay within the scoped directory

### Authentication

- **Stdio mode**: No authentication (relies on process-level security)
- **HTTP mode**: Use `--mcp-auth-token` for bearer token authentication
- **SSH**: Password or public key authentication

### Isolation

- Use `--isolation bwrap` for OS-level namespace isolation (Linux only)
- Use `--isolation software` for heuristics-based path/command validation
- Use `--isolation none` only in trusted environments

## Troubleshooting

### "Scope conflict" error

You're trying to use both static (`--scopePath`) and dynamic (`X-Scope-Path`) scoping. Choose one:
- Remove `--scopePath` from daemon startup to use dynamic scoping
- Or don't send `X-Scope-Path` header to use static scoping

### "Root directory mismatch" error

The client's `X-Root-Dir` header doesn't match the daemon's `--rootDir`. Ensure both are configured identically.

### Daemon won't start on macOS/Windows

Full daemon mode (with SSH) requires Linux. Use `--local-only` for local development:

```bash
agent-backend daemon --rootDir /tmp/agentbe-workspace --local-only
```

### Permission denied errors

- Full daemon mode requires root for SSH user management
- Ensure `--rootDir` directory exists and is writable
- Check file permissions within the workspace
