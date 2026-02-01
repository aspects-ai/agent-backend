# AgentBackend Examples

This directory contains example applications that demonstrate how to use AgentBackend as an external consumer.

## Available Examples

### 🌐 NextJS
A Next.js web application demonstrating both local and remote backend usage.

**Features:**
- Interactive file browser
- Command execution interface  
- Backend switching (local/remote)
- Real-time output display

**Quick Start:**
```bash
cd NextJS/
npm install
npm run dev
```

**For Remote Backend:**
```bash
# Start AgentBackend remote backend service
cd ../typescript/remote/
docker-compose up -d

# Build native library
cd ../
npx agent-backend build-native --output ./build/

# Run with remote backend (Linux only)
cd ../examples/NextJS/
REMOTE_VM_HOST=root@localhost:2222 \
LD_PRELOAD=../../typescript/build/libintercept.so \
npm run dev
```

### 📦 codebuff-demo  
Example integration with Codebuff SDK for AI agent development.

## Consumer Patterns Demonstrated

### Basic Local Backend
```javascript
import { FileSystem } from 'agent-backend'

const fs = new FileSystem({ userId: 'user123' })
await fs.exec('echo "Hello World"')
```

### Remote Backend with Environment Configuration
```javascript
// Set environment: REMOTE_VM_HOST=user@hostname:port
const fs = new FileSystem({
  type: 'remote', 
  workspace: '/workspace/project',
  auth: {
    type: 'password',
    credentials: { username: 'user', password: 'pass' }
  }
})

await fs.exec('ls -la')  // Executes on remote server
```

### Cross-Platform Development
```bash
# Linux - Native execution
LD_PRELOAD=./build/libintercept.so npm run dev

# macOS/Windows - Docker execution  
docker run \
  -v $(pwd):/app \
  -e LD_PRELOAD=/app/build/libintercept.so \
  -p 3000:3000 \
  node:18 \
  npm run dev
```

## Installation Patterns

All examples demonstrate standard npm installation:

```json
{
  "dependencies": {
    "agent-backend": "file:../typescript/"
  }
}
```

In production, this would be:
```json
{
  "dependencies": {
    "agent-backend": "^1.0.0"
  }
}
```

## Development Workflow

1. **Install AgentBackend**:
   ```bash
   npm install agent-backend
   ```

2. **Build native library** (if using remote backend):
   ```bash
   npx agent-backend build-native --output ./build/
   ```

3. **Start remote backend** (optional):
   ```bash
   docker run -p 2222:22 agent-backend/remote-backend
   ```

4. **Run your application**:
   ```bash
   # Local backend
   npm run dev
   
   # Remote backend (Linux)
   REMOTE_VM_HOST=root@localhost:2222 \
   LD_PRELOAD=./build/libintercept.so \
   npm run dev
   ```

## Contributing Examples

To add a new example:

1. Create a new directory in `examples/`
2. Add a complete, working application
3. Include README with setup instructions
4. Use standard npm installation patterns
5. Demonstrate specific AgentBackend features
6. Test on multiple platforms if applicable

Examples should be:
- **Self-contained**: Work independently 
- **Well-documented**: Clear setup instructions
- **Representative**: Show real-world usage patterns
- **Cross-platform aware**: Handle platform differences gracefully