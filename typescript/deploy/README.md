# agentbe-daemon Deployment

Deploy agentbe-daemon to serve a filesystem remotely via SSH (direct operations) and MCP over HTTP (tool execution).

## For Library Consumers

If you're using `agent-backend` as an npm package, use the CLI to manage Docker containers.

### Quick Start

```bash
# Install agent-backend globally
npm install -g agent-backend

# Start agentbe-daemon in Docker
agent-backend start-docker

# Stop the container
agent-backend stop-docker

# Rebuild and restart (after updates)
agent-backend start-docker --build
```

This starts a Docker container with:
- **SSH daemon** on port 2222 (for direct file operations)
- **MCP server** on port 3001 (for tool execution)
- **Default credentials**: `root:agents`

### Connect from Your Application

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
  },
  mcpAuthToken: 'your-secure-token'  // if configured
})

await backend.connect()
await backend.exec('npm install')
await backend.write('config.json', '{}')
```

### Test the Container

```bash
# Check MCP health
curl http://localhost:3001/health

# SSH into the container
ssh root@localhost -p 2222
# Password: agents
```

---

## For Developers

If you're developing agent-backend itself, use the Makefile and mprocs for a better workflow.

### Development Setup

```bash
# From monorepo root - install all dependencies
make install

# Start local development (TypeScript watch + NextJS)
make dev

# Start with Docker-based remote testing
make dev-remote
```

### Docker Commands

```bash
# Build the Docker image
make docker-build

# Clean up Docker resources
make docker-clean
```

### How `make dev-remote` Works

Runs `REMOTE=1 mprocs` which starts:
1. **typescript-watch** - Rebuilds TypeScript on changes
2. **agentbe-daemon** - Docker container with MCP + SSH
3. **nextjs** - NextJS dev server

The mprocs TUI lets you monitor all processes, view logs, and restart individual services. Configure the NextJS app via the Settings UI to connect to the daemon.

### Manual Docker Testing

```bash
# Build image
cd typescript/deploy/docker
docker build -f Dockerfile.runtime -t agentbe-daemon:latest ../../..

# Run container
docker run -d \
  --name agentbe-daemon \
  -p 2222:22 \
  -p 3001:3001 \
  -v $(pwd)/tmp/workspace:/var/workspace \
  -e MCP_AUTH_TOKEN=dev-token \
  agentbe-daemon:latest

# View logs
docker logs -f agentbe-daemon

# Stop and remove
docker stop agentbe-daemon && docker rm agentbe-daemon
```

---

## Daemon Command Reference

The `agent-backend daemon` command runs MCP and optionally SSH services:

```bash
agent-backend daemon --rootDir <path> [OPTIONS]
```

### Required
- `--rootDir <path>` - Root directory to serve

### Optional - Mode
- `--local-only` - Stdio MCP only, no SSH (works on macOS/Windows)

### Optional - MCP Server
- `--mcp-port <port>` - HTTP port (default: 3001)
- `--mcp-auth-token <token>` - Bearer token for authentication
- `--isolation <mode>` - Command isolation: auto|bwrap|software|none
- `--shell <shell>` - Shell to use: bash|sh|auto

### Optional - SSH (full mode only)
- `--ssh-users <users>` - Comma-separated user:pass pairs (default: root:agents)
- `--ssh-public-key <key>` - SSH public key for authorized_keys
- `--ssh-authorized-keys <path>` - File with authorized keys

**Note:** Full daemon mode (with SSH) requires Linux and root privileges.

---

## Docker Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SSH_USERS` | Comma-separated `user:password` pairs | `root:agents` |
| `SSH_PUBLIC_KEY` | SSH public key for key auth | None |
| `WORKSPACE_ROOT` | Root directory for workspaces | `/var/workspace` |
| `MCP_PORT` | MCP server port | `3001` |
| `MCP_AUTH_TOKEN` | Bearer token for MCP auth | None |

### Docker Compose

```yaml
# docker-compose.yml
services:
  agentbe-daemon:
    build:
      context: ../..
      dockerfile: deploy/docker/Dockerfile.runtime
    ports:
      - "2222:22"
      - "3001:3001"
    volumes:
      - ./var/workspace:/var/workspace
    environment:
      - SSH_USERS=dev:devpassword
      - MCP_AUTH_TOKEN=your-secure-token
```

---

## Architecture

```
Client Machine:
  └── RemoteFilesystemBackend
      ├── SSH client → Remote:2222 (file ops: read, write, exec)
      └── MCP client → Remote:3001 (tool execution)

Remote Machine (Docker):
  └── agentbe-daemon (PID 1)
      ├── MCP HTTP Server (:3001)
      │   └── Serves /var/workspace via MCP protocol
      └── SSH Daemon (:22 → host:2222)
          └── Direct filesystem access
```

Both services access the **same filesystem** (`/var/workspace`).

---

## Cloud Deployment

### Using Deploy Tool

```bash
# From monorepo root
make start-deploy-ui
# Opens http://localhost:3456
```

The deploy tool creates a VM with Docker and configures agentbe-daemon automatically.

### Manual Cloud Setup

1. Provision a Linux VM (Ubuntu recommended)
2. Install Docker
3. Pull and run the image:

```bash
docker pull ghcr.io/aspects-ai/agent-backend-remote:latest

docker run -d \
  --name agentbe-daemon \
  -p 2222:22 \
  -p 3001:3001 \
  -v /var/workspace:/var/workspace \
  -e SSH_USERS=agent:secure-password \
  -e MCP_AUTH_TOKEN=production-token \
  --restart unless-stopped \
  ghcr.io/aspects-ai/agent-backend-remote:latest
```

---

## Security

### Development
- Default credentials: `root:agents`
- Only use in isolated environments

### Production
- **Change default passwords**
- Use SSH key authentication
- Set `MCP_AUTH_TOKEN` for MCP authentication
- Bind ports to localhost if using a reverse proxy
- Configure firewall rules

```yaml
# Production example
services:
  agentbe-daemon:
    image: ghcr.io/aspects-ai/agent-backend-remote:latest
    ports:
      - "127.0.0.1:2222:22"  # Localhost only
      - "127.0.0.1:3001:3001"
    volumes:
      - /data/workspace:/var/workspace
      - /etc/ssh/authorized_keys:/keys/authorized_keys:ro
    environment:
      - SSH_USERS=agent:very-secure-password
      - MCP_AUTH_TOKEN=production-secret-token
    restart: unless-stopped
```

---

## Troubleshooting

### Container Not Starting

```bash
# Check if running
docker ps | grep agentbe

# View logs
docker logs agentbe-daemon

# Check daemon process inside container
docker exec agentbe-daemon ps aux
```

### Connection Issues

```bash
# Test MCP
curl http://localhost:3001/health

# Test SSH
ssh -v root@localhost -p 2222
```

### Permission Issues

```bash
# Check workspace permissions
docker exec agentbe-daemon ls -la /var/workspace

# Fix if needed
docker exec agentbe-daemon chown -R root:root /var/workspace
```
