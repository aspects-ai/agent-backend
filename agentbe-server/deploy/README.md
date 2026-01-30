# Agent Backend Remote Service

This directory contains the Docker configuration for the Agent Backend remote service - a deployable POSIX filesystem accessible via SSH and MCP (Model Context Protocol).

## Quick Start

### Using CLI (Recommended)

```bash
# Install agentbe-server
npm install -g agentbe-server

# Start remote backend service
agentbe-server start-remote

# Stop remote backend service
agentbe-server stop-remote

# Rebuild and restart
agentbe-server start-remote --build
```

### Using Docker Compose

```bash
cd deploy/docker/
docker-compose up -d
```

### Using Docker Run

```bash
# Build the image (from agentbe-server directory)
docker build -f deploy/docker/Dockerfile.runtime -t agentbe/remote-backend .

# Run the container
docker run -d \
  -p 2222:22 \
  -p 3001:3001 \
  -v $(pwd)/workspace:/workspace \
  -e MCP_AUTH_TOKEN=your-secure-token \
  --name agentbe-remote-backend \
  agentbe/remote-backend
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SSH_USERS` | Comma-separated list of `username:password` pairs | `root:constellation` |
| `SSH_PUBLIC_KEY` | SSH public key for key-based authentication | None |
| `WORKSPACE_ROOT` | Root directory for workspaces | `/workspace` |
| `ENABLE_LOGGING` | Enable verbose SSH logging | `false` |
| `MCP_PORT` | Port for MCP server | `3001` |
| `MCP_AUTH_TOKEN` | Auth token for MCP server (required to enable MCP) | None |

### Example Configurations

#### Multi-user Setup
```yaml
environment:
  - SSH_USERS=alice:password123,bob:password456
```

#### SSH Key Authentication
```yaml
environment:
  - SSH_PUBLIC_KEY=ssh-rsa AAAAB3NzaC1yc2E...your-key-here
volumes:
  - ~/.ssh/id_rsa.pub:/keys/id_rsa.pub:ro
```

#### MCP Server Setup
```yaml
environment:
  - MCP_PORT=3001
  - MCP_AUTH_TOKEN=your-secure-auth-token
ports:
  - "3001:3001"
```

## Usage with ConstellationFS

### Using MCP (Recommended for AI Applications)

The MCP server provides a standardized interface for AI applications to interact with the filesystem.

1. Start the remote backend with MCP enabled:
   ```bash
   cd remote/
   # Edit docker-compose.yml to set MCP_AUTH_TOKEN
   docker-compose up -d
   ```

2. Test the MCP server:
   ```bash
   curl http://localhost:3001/health
   # Returns: {"status":"ok","sessions":0}
   ```

3. Configure web-demo to use remote MCP:
   ```bash
   # In examples/web-demo/.env.local
   USE_MCP=true
   REMOTE_MCP_URL=http://localhost:3001
   REMOTE_MCP_AUTH_TOKEN=your-secure-auth-token
   OPENROUTER_API_KEY=your-openrouter-key
   ```

4. Start the web-demo:
   ```bash
   cd examples/web-demo
   npm run dev
   ```

### Development Setup (SSH Backend)

1. Start the remote backend:
   ```bash
   cd remote/
   docker-compose up -d
   ```

2. In your application:
   ```bash
   # Build native library
   npx constellationfs build-native --output ./build/
   
   # Run with environment variable
   REMOTE_VM_HOST=root@localhost:2222 \
   LD_PRELOAD=./build/libintercept.so \
   npm run dev
   ```

3. Use in your code:
   ```javascript
   import { FileSystem } from 'constellationfs'
   
   const fs = new FileSystem({
     type: 'remote',
     workspace: '/workspace/projects',
     auth: {
       type: 'password',
       credentials: {
         username: 'root',
         password: 'constellation'
       }
     }
   })
   
   await fs.exec('ls -la')  // Executes on remote backend
   ```

### Cloud Deployment (Azure/GCP)

Use the deploy tool for one-click VM deployment:

```bash
# From constellation-typescript directory
./deploy-tool.sh
# Opens http://localhost:3456 with deployment UI
```

Or run manually:

```bash
cd remote/deploy-tool
npm install
node server.js
```

The deploy tool:
- Creates a VM with Docker pre-installed
- Pulls `ghcr.io/aspects-ai/constellation-remote:latest`
- Configures SSH (port 2222) and MCP (port 3001)
- Auto-generates MCP auth token if not provided

**After deployment, configure your host app:**
```bash
# Environment variables for your application
REMOTE_MCP_URL=http://<vm-ip>:3001
REMOTE_MCP_AUTH_TOKEN=<token-from-deploy-output>
```

**Connect via MCP from host application:**
```typescript
import { createConstellationMCPClient } from 'constellationfs'

const mcpClient = await createConstellationMCPClient({
  url: process.env.REMOTE_MCP_URL,
  authToken: process.env.REMOTE_MCP_AUTH_TOKEN,
  userId: sessionId,
  workspace: 'default',
})

// Call tools directly
const result = await mcpClient.callTool({
  name: 'exec',
  arguments: { command: 'ls -la' }
})

await mcpClient.close()
```

**SSH access (for debugging):**
```bash
ssh <user>@<vm-ip> -p 2222
```

## Security Considerations

### For Development
- Default credentials are `root:constellation`
- Use only in isolated development environments
- Consider using SSH keys instead of passwords

### For Production
- **Always change default passwords**
- Use SSH key authentication when possible
- Configure proper firewall rules
- Use secure networks and VPNs
- Regularly update the container image

### Recommended Production Setup
```yaml
services:
  remote-backend:
    image: constellationfs/remote-backend:latest
    ports:
      - "127.0.0.1:22:22"  # Bind to localhost only
    volumes:
      - /data/secure-workspace:/workspace
      - /etc/ssh/constellation_key.pub:/keys/id_rsa.pub:ro
    environment:
      - SSH_USERS=constellationfs:very-secure-password-here
      - ENABLE_LOGGING=true
    restart: unless-stopped
```

## Troubleshooting

### Connection Issues
```bash
# Check if container is running
docker ps | grep constellation

# Check container logs
docker logs constellation-remote-backend

# Test SSH connection
ssh root@localhost -p 2222
```

### Permission Issues
```bash
# Check workspace permissions
docker exec constellation-remote-backend ls -la /workspace

# Fix permissions if needed
docker exec constellation-remote-backend chown -R root:root /workspace
```

### Log Analysis
```bash
# Follow logs in real-time
docker logs -f constellation-remote-backend

# Check SSH daemon status
docker exec constellation-remote-backend service ssh status
```

## Building and Publishing

Images are automatically published to GitHub Container Registry on push to `production` branch.

### Manual Build
```bash
docker build -f remote/Dockerfile.runtime -t ghcr.io/aspects-ai/constellation-remote:latest .
```

### Manual Push
```bash
docker push ghcr.io/aspects-ai/constellation-remote:latest
```

### Pull Image
```bash
docker pull ghcr.io/aspects-ai/constellation-remote:latest
```