# agentbe-daemon

A server daemon that exposes a single port serving both MCP (HTTP) and SSH-over-WebSocket. Deploy it in Docker or run it directly to serve a workspace remotely.

## Table of Contents

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Connect from Your Application](#connect-from-your-application)
- [CLI Reference](#cli-reference)
- [Docker Configuration](#docker-configuration)
  - [Environment Variables](#environment-variables)
  - [Docker Compose](#docker-compose)
- [Cloud Deployment](#cloud-deployment)
- [Extending the Image](#extending-the-image)
- [Conventional SSH (Opt-In)](#conventional-ssh-opt-in)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Architecture

The daemon exposes a single port (default `3001`) with three endpoints:

```
Client
  └── RemoteFilesystemBackend
        │
        ▼
   agentbe-daemon (:3001)
        ├── /mcp     MCP over HTTP   (tool execution)
        ├── /ssh     SSH over WebSocket (file ops, exec)
        └── /health  Health check
```

Authentication is unified -- a single `AUTH_TOKEN` secures both MCP and SSH-WS.

**SSH-WS is the default transport.** It runs over the same port as MCP, requires no extra configuration, and works in any environment that supports WebSockets (cloud VMs, Kubernetes, Cloud Run, etc.).

Conventional SSH (sshd on a separate port) is available as an [opt-in legacy option](#conventional-ssh-opt-in) for clients that require a traditional SSH connection.

## Quick Start

### Docker (recommended)

```bash
docker run -d \
  --name agentbe-daemon \
  -p 3001:3001 \
  -v $(pwd)/workspace:/var/workspace \
  -e AUTH_TOKEN=your-secret-token \
  ghcr.io/aspects-ai/agentbe-daemon:latest
```

Verify it is running:

```bash
curl http://localhost:3001/health
```

### npm

```bash
npm install -g agent-backend

agent-backend daemon --rootDir ./workspace --auth-token your-secret-token
```

### Docker CLI helper

```bash
npm install -g agent-backend

agent-backend start-docker            # start container
agent-backend start-docker --build    # rebuild and restart
agent-backend stop-docker             # stop container
```

## Connect from Your Application

SSH-WS is the default transport. A single host/port/token is all you need:

```typescript
import { RemoteFilesystemBackend } from 'agent-backend'

const backend = new RemoteFilesystemBackend({
  rootDir: '/var/workspace',
  host: 'localhost',
  port: 3001,
  authToken: 'your-secret-token',
  // transport defaults to 'ssh-ws' -- no need to specify
})

await backend.connect()
await backend.exec('npm install')
await backend.write('config.json', '{}')
```

## CLI Reference

```
agent-backend daemon --rootDir <path> [OPTIONS]
```

**Required:**

| Flag | Description |
|------|-------------|
| `--rootDir <path>` | Root directory to serve |

**Optional -- Mode:**

| Flag | Description |
|------|-------------|
| `--local-only` | Stdio MCP only (no HTTP, no SSH). Works on macOS/Windows. |

**Optional -- Server:**

| Flag | Default | Description |
|------|---------|-------------|
| `--port <port>` | `3001` | HTTP/WebSocket server port |
| `--auth-token <token>` | none | Bearer token (secures both MCP and SSH-WS) |
| `--isolation <mode>` | `auto` | Command isolation: `auto\|bwrap\|software\|none` |
| `--shell <shell>` | `auto` | Shell: `bash\|sh\|auto` |

**Optional -- SSH-WS (enabled by default):**

| Flag | Description |
|------|-------------|
| `--disable-ssh-ws` | Disable the SSH-over-WebSocket endpoint |
| `--ssh-host-key <path>` | Path to SSH host key (auto-generated if omitted) |

**Optional -- Conventional SSH (disabled by default, requires Linux + root):**

| Flag | Default | Description |
|------|---------|-------------|
| `--conventional-ssh` | off | Enable conventional sshd |
| `--ssh-port <port>` | `22` | SSH daemon port |
| `--ssh-users <users>` | `root:agents` | Comma-separated `user:pass` pairs |
| `--ssh-public-key <key>` | none | SSH public key |
| `--ssh-authorized-keys <path>` | none | Path to authorized_keys file |

## Docker Configuration

### Environment Variables

**Core** -- most deployments only need these:

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSPACE_ROOT` | `/var/workspace` | Root directory to serve |
| `PORT` | `3001` | Server port (MCP + SSH-WS) |
| `AUTH_TOKEN` | none | Bearer token for authentication |

**SSH-WS options:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DISABLE_SSH_WS` | `false` | Set to `true` to disable SSH-WS |
| `SSH_HOST_KEY` | auto-generated | Path to SSH host key |
| `SHELL_TYPE` | `auto` | Shell: `bash\|sh\|auto` |

**Conventional SSH (opt-in)** -- see [Conventional SSH](#conventional-ssh-opt-in) for details:

| Variable | Default | Description |
|----------|---------|-------------|
| `CONVENTIONAL_SSH` | `false` | Set to `true` to enable sshd |
| `SSH_PORT` | `22` | SSH daemon port inside container |
| `SSH_HOST_PORT` | `2222` | Host-mapped SSH port (docker-compose) |
| `SSH_USERS` | `root:agents` | Comma-separated `user:pass` pairs |
| `SSH_PUBLIC_KEY` | none | SSH public key for key auth |

### Docker Compose

Minimal compose file using the default SSH-WS transport:

```yaml
services:
  agentbe-daemon:
    image: ghcr.io/aspects-ai/agentbe-daemon:latest
    ports:
      - "3001:3001"
    volumes:
      - ./workspace:/var/workspace
    environment:
      - AUTH_TOKEN=your-secret-token
    restart: unless-stopped
```

See `daemon/docker/docker-compose.yml` for a full example with all options.

## Cloud Deployment

### Using the Deploy Tool

```bash
# From monorepo root
make start-deploy-ui
# Opens http://localhost:3456
```

The deploy tool provisions a VM with Docker and configures agentbe-daemon automatically.

### Manual Cloud Setup

1. Provision a Linux VM (Ubuntu recommended).
2. Install Docker.
3. Run the container:

```bash
docker pull ghcr.io/aspects-ai/agentbe-daemon:latest

docker run -d \
  --name agentbe-daemon \
  -p 3001:3001 \
  -v /var/workspace:/var/workspace \
  -e AUTH_TOKEN=production-secret-token \
  --restart unless-stopped \
  ghcr.io/aspects-ai/agentbe-daemon:latest
```

Only port `3001` is required. Both MCP and SSH-WS are served on that single port.

## Extending the Image

The Docker image provides three extension points:

**Install additional packages** by building a derived image:

```dockerfile
FROM ghcr.io/aspects-ai/agentbe-daemon:latest
RUN apt-get update && apt-get install -y your-package
```

**Run init scripts at startup** by mounting scripts into `/docker-entrypoint.d/`:

```bash
docker run -d \
  -v ./my-init.sh:/docker-entrypoint.d/my-init.sh:ro \
  ghcr.io/aspects-ai/agentbe-daemon:latest
```

Scripts must be executable and have a `.sh` extension. They run in alphabetical order before the daemon starts.

**Override the default command** to use the container as a plain workspace:

```bash
docker run -it ghcr.io/aspects-ai/agentbe-daemon:latest bash
```

## Conventional SSH (Opt-In)

Most users do not need conventional SSH. It is only required for clients that cannot use WebSockets and need a traditional `sshd` connection on a separate port.

**Requirements:** Linux host, root privileges, `INCLUDE_SSHD=true` at image build time (included by default in the published image).

### Enable in Docker

```bash
docker run -d \
  --name agentbe-daemon \
  -p 3001:3001 \
  -p 2222:22 \
  -v $(pwd)/workspace:/var/workspace \
  -e AUTH_TOKEN=your-secret-token \
  -e CONVENTIONAL_SSH=true \
  -e SSH_USERS=dev:secure-password \
  ghcr.io/aspects-ai/agentbe-daemon:latest
```

### Connect with Conventional SSH

```typescript
const backend = new RemoteFilesystemBackend({
  rootDir: '/var/workspace',
  host: 'localhost',
  transport: 'ssh',
  port: 22,
  sshAuth: {
    type: 'password',
    credentials: { username: 'root', password: 'agents' },
  },
})
```

Or via the command line:

```bash
ssh root@localhost -p 2222
# Default password: agents
```

## Security

### Development

- Default credentials (`root:agents`) are for development only.
- Always set `AUTH_TOKEN` even in development to match production behavior.

### Production

- Set a strong `AUTH_TOKEN`. It secures both MCP and SSH-WS endpoints.
- If using conventional SSH, change default passwords or use key-based auth.
- Bind ports to localhost when running behind a reverse proxy.
- Configure firewall rules to restrict access to port `3001`.

```yaml
services:
  agentbe-daemon:
    image: ghcr.io/aspects-ai/agentbe-daemon:latest
    ports:
      - "127.0.0.1:3001:3001"
    volumes:
      - /data/workspace:/var/workspace
    environment:
      - AUTH_TOKEN=production-secret-token
    restart: unless-stopped
```

## Troubleshooting

### Container not starting

```bash
docker ps | grep agentbe
docker logs agentbe-daemon
docker exec agentbe-daemon ps aux
```

### Connection issues

```bash
# Health check
curl http://localhost:3001/health

# Health check with auth
curl -H "Authorization: Bearer your-secret-token" http://localhost:3001/health
```

### Permission issues

```bash
docker exec agentbe-daemon ls -la /var/workspace
docker exec agentbe-daemon chown -R root:root /var/workspace
```

## Development

If you are developing agent-backend itself, use the Makefile and mprocs for a better workflow.

```bash
# From monorepo root
make install          # install all dependencies
make dev              # local development (TypeScript watch + NextJS)
make dev-remote       # development with Docker-based remote testing
make docker-build     # build the Docker image
make docker-clean     # clean up Docker resources
```

`make dev-remote` starts `REMOTE=1 mprocs`, which runs TypeScript watch, the Docker daemon, and the NextJS dev server side by side.

### Manual Docker Testing

```bash
# Build image (from monorepo root)
docker build -f daemon/docker/Dockerfile -t agentbe-daemon:latest .

# Run container
docker run -d \
  --name agentbe-daemon \
  -p 3001:3001 \
  -v $(pwd)/workspace:/var/workspace \
  -e AUTH_TOKEN=dev-token \
  agentbe-daemon:latest

# View logs
docker logs -f agentbe-daemon

# Stop and remove
docker stop agentbe-daemon && docker rm agentbe-daemon
```

## License

See [LICENSE](../LICENSE).
