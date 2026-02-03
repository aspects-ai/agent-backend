# Agent Backend Architecture

## Overview

Agent Backend provides secure, isolated filesystem access and command execution for AI agents. It supports both local and remote deployments with a unified interface.

**Core Concepts:**
- **Backends** - Client-side interfaces for filesystem operations (LocalFilesystemBackend, RemoteFilesystemBackend, MemoryBackend)
- **MCP (Model Context Protocol)** - Standardized protocol for AI tool execution
- **agentbe-daemon** - Server process that manages MCP and optionally SSH services
- **Scoping** - Isolation mechanism for multi-tenancy

---

## Backend Types

### LocalFilesystemBackend
- Direct filesystem access using Node.js APIs (fs, child_process)
- Optional MCP HTTP server for tool exposure to AI agents
- Single-machine deployment (client and filesystem on same host)
- Fast file operations with no network latency

### RemoteFilesystemBackend
- SSH/SFTP for file operations to remote host
- MCP HTTP client for tool calls to remote daemon
- Two-machine deployment (client on one host, filesystem on another)
- Authentication via SSH keys or passwords + MCP bearer tokens

### MemoryBackend
- In-memory key/value storage (no filesystem)
- No command execution support
- Useful for testing and caching scenarios

All backends support **scoping** for multi-tenant isolation via `.scope(path)`.

---

## How It Works

### System Components

```mermaid
%%{init: {'theme':'base', 'themeVariables': { 'fontSize':'16px', 'fontFamily':'system-ui, -apple-system, sans-serif'}}}%%
graph TB
    subgraph userApp["🖥️ Your Application (Client)"]
        App["<b>Your Application Code</b><br/><i>AI Agent • Web Server • CLI Tool</i>"]
        Backend["<b>Backend Instance</b><br/><i>agent-backend library</i><br/>LocalFilesystemBackend | RemoteFilesystemBackend"]
        MCP_Client["<b>MCP Client</b><br/><i>agent-backend library</i>"]
    end

    subgraph serverHost["🖧 Server Host (Local or Remote)"]
        subgraph Daemon["⚙️ agentbe-daemon<br/>(single process)"]
            MCP_Server["<b>MCP Server</b><br/>HTTP :3001"]
            SSH["<b>SSH Daemon</b><br/>child process :22"]
        end
        FS[("<b>Filesystem</b><br/>/var/workspace")]
    end

    App -.->|uses| Backend
    Backend -.->|creates| MCP_Client
    Backend -.->|"SSH/SFTP<br/>(RemoteFilesystemBackend)"| SSH
    MCP_Client ==>|"HTTP<br/>MCP protocol"| MCP_Server
    MCP_Server ==>|executes| FS
    SSH ==>|file ops| FS

    classDef userCode fill:#f8f9fa,stroke:#495057,stroke-width:2px,color:#212529
    classDef agentBackend fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef daemon fill:#607D8B,stroke:#455A64,stroke-width:3px,color:#fff
    classDef storage fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20

    class App userCode
    class Backend,MCP_Client agentBackend
    class Daemon,MCP_Server,SSH daemon
    class FS storage

    style userApp fill:#fafafa,stroke:#666,stroke-width:2px
    style serverHost fill:#f5f5ff,stroke:#666,stroke-width:2px
```

**Component Responsibilities:**

1. **Your Application** - Orchestrates operations, uses Backend interface
2. **Backend** - Provides consistent API for file operations and command execution
3. **MCP Client** - Communicates with MCP server using Model Context Protocol
4. **agentbe-daemon** - Manages filesystem access, executes commands, serves MCP tools
5. **SSH Daemon** (optional) - Provides direct SSH access for RemoteFilesystemBackend
6. **Filesystem** - Actual files being accessed/modified

---

## Deployment Scenario 1: Local Development

**Use Case:** CLI tool, Developer testing AI agent locally.

### Architecture

```mermaid
%%{init: {'theme':'base', 'themeVariables': { 'fontSize':'16px', 'fontFamily':'system-ui, -apple-system, sans-serif'}}}%%
graph TB
    subgraph devMachine["💻 Developer's Machine (macOS/Windows/Linux)"]
        subgraph userApp["Your Application"]
            App["<b>Your Application Code</b>"]
            LFB["<b>LocalFilesystemBackend</b><br/><i>agent-backend library</i>"]
            MCP_HTTP["<b>MCP Client</b><br/><i>agent-backend library</i>"]
        end

        subgraph Daemon["⚙️ agentbe-daemon --local-only"]
            MCP_Server["<b>MCP Server</b><br/>port 3001"]
        end

        FS[("<b>Local Filesystem</b><br/>/tmp/workspace")]

        App -.->|uses| LFB
        LFB -.->|creates| MCP_HTTP
        LFB ==>|"Node.js fs module<br/>(direct)"| FS
        MCP_HTTP ==>|"HTTP<br/>localhost:3001"| MCP_Server
        MCP_Server ==>|executes| FS
    end

    classDef userCode fill:#f8f9fa,stroke:#495057,stroke-width:2px,color:#212529
    classDef agentBackend fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef daemon fill:#607D8B,stroke:#455A64,stroke-width:3px,color:#fff
    classDef storage fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20

    class App userCode
    class LFB,MCP_HTTP agentBackend
    class Daemon,MCP_Server daemon
    class FS storage

    style devMachine fill:#fafafa,stroke:#666,stroke-width:2px
    style userApp fill:#fcfcfc,stroke:#999,stroke-width:1px
```

### Communication Flow

```mermaid
sequenceDiagram
    participant App as Your Application
    participant LFB as LocalFilesystemBackend
    participant MCP as MCP Client
    participant Daemon as agentbe-daemon
    participant FS as Filesystem

    Note over App,FS: Initialization
    App->>LFB: new LocalFilesystemBackend({rootDir: '/tmp/workspace'})
    App->>Daemon: Start: agent-backend daemon --rootDir /tmp/workspace --local-only
    Daemon-->>Daemon: MCP Server listening on :3001

    Note over App,FS: Direct Backend Operations (no MCP)
    App->>LFB: write('config.json', '{...}')
    LFB->>FS: Node.js fs.writeFile('/tmp/workspace/config.json')
    FS-->>LFB: Success
    LFB-->>App: Success

    App->>LFB: read('config.json')
    LFB->>FS: Node.js fs.readFile('/tmp/workspace/config.json')
    FS-->>LFB: File contents
    LFB-->>App: File contents

    App->>LFB: exec('npm install')
    LFB->>FS: Node.js child_process.spawn('npm install')
    FS-->>LFB: {stdout, stderr, exitCode}
    LFB-->>App: {stdout, stderr, exitCode}

    Note over App,FS: MCP Tool Flow (for AI Agents)
    App->>LFB: getMCPClient()
    LFB->>MCP: Create MCP client (HTTP localhost:3001)
    MCP-->>LFB: MCP client instance
    LFB-->>App: MCP client instance

    App->>MCP: listTools()
    MCP->>Daemon: GET /mcp - list tools request
    Daemon-->>MCP: Available tools: [exec, read, write, ...]
    MCP-->>App: Tool schemas

    Note over App,MCP: Pass tools to AI agent or invoke manually
    App->>MCP: callTool({name: 'exec', arguments: {command: 'npm test'}})
    MCP->>Daemon: POST /mcp - MCP tool call
    Daemon->>FS: spawn('npm test') in /tmp/workspace
    FS-->>Daemon: stdout/stderr/exitCode
    Daemon-->>MCP: MCP tool result {content: [...]}
    MCP-->>App: Tool result
```

### Configuration

**Start the daemon:**
```bash
# Terminal 1: Start MCP server (works on macOS/Windows)
agent-backend daemon --rootDir /tmp/workspace --local-only
```

**Application code:**
```typescript
import { LocalFilesystemBackend } from 'agent-backend'

const backend = new LocalFilesystemBackend({
  rootDir: '/tmp/workspace',
  isolation: 'auto',
  preventDangerous: true
})

// Direct backend operations (no MCP)
await backend.write('package.json', '{"name": "my-app"}')
const files = await backend.readdir('src')
const result = await backend.exec('npm install')
console.log(result.stdout)

// OR: Get MCP client for AI agent integration
const mcp = await backend.getMCPClient()
const tools = await mcp.listTools()
// Pass tools to AI agent (e.g., Claude, GPT) or invoke manually:
const mcpResult = await mcp.callTool({
  name: 'exec',
  arguments: { command: 'npm test' }
})
```

### Key Characteristics

- ✅ **Single machine** - Everything runs locally
- ✅ **Direct file access** - No SSH, uses Node.js fs module
- ✅ **MCP for exec** - Commands run through MCP HTTP server
- ✅ **Fast** - No network latency for file operations
- ✅ **Simple** - No SSH setup, no remote configuration
- ✅ **Cross-platform** - Works on macOS/Windows/Linux with `--local-only`

---

## Deployment Scenario 2: Remote Execution

**Use Case:** Production deployment where AI agent runs on one machine and executes code on a remote build server.

### Architecture

```mermaid
%%{init: {'theme':'base', 'themeVariables': { 'fontSize':'16px', 'fontFamily':'system-ui, -apple-system, sans-serif'}}}%%
graph TB
    subgraph clientMachine["💻 Client Machine (Your Server)"]
        subgraph userApp["Your Application"]
            App["<b>Your Application Code</b>"]
            RFB["<b>RemoteFilesystemBackend</b><br/><i>agent-backend library</i>"]
            SSH_Client["<b>SSH Client</b><br/><i>agent-backend library</i>"]
            MCP_Client["<b>MCP Client</b><br/><i>agent-backend library</i>"]
        end
    end

    subgraph remoteMachine["🖧 Remote Machine (build-server.com)"]
        subgraph dockerContainer["🐳 Docker Container"]
            subgraph Daemon["⚙️ agentbe-daemon"]
                MCP_Server["<b>MCP Server</b><br/>port 3001"]
                SSH_Server["<b>SSH Daemon</b><br/>port 22"]
            end
            FS[("<b>Filesystem</b><br/>/var/workspace")]
        end
    end

    App -.->|uses| RFB
    RFB -.->|creates| SSH_Client
    RFB -.->|creates| MCP_Client
    SSH_Client ==>|"SSH/SFTP<br/>file ops"| SSH_Server
    MCP_Client ==>|"HTTP + Bearer token<br/>MCP protocol"| MCP_Server
    SSH_Server ==> FS
    MCP_Server ==> FS

    classDef userCode fill:#f8f9fa,stroke:#495057,stroke-width:2px,color:#212529
    classDef agentBackend fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef daemon fill:#607D8B,stroke:#455A64,stroke-width:3px,color:#fff
    classDef storage fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20

    class App userCode
    class RFB,SSH_Client,MCP_Client agentBackend
    class Daemon,MCP_Server,SSH_Server daemon
    class FS storage

    style clientMachine fill:#fafafa,stroke:#666,stroke-width:2px
    style remoteMachine fill:#f5f5ff,stroke:#666,stroke-width:2px
    style dockerContainer fill:#fcfcfc,stroke:#999,stroke-width:1px
    style userApp fill:#fcfcfc,stroke:#999,stroke-width:1px
```

### Communication Flow

```mermaid
sequenceDiagram
    participant App as Your Application
    participant RFB as RemoteFilesystemBackend
    participant SSH as SSH Client
    participant MCP as MCP Client
    participant Daemon as agentbe-daemon (remote)
    participant FS as Filesystem (remote)

    Note over App,FS: Initialization (on remote host)
    App->>Daemon: Start on remote: agent-backend daemon --rootDir /var/workspace
    Daemon-->>Daemon: SSH Server listening on :22
    Daemon-->>Daemon: MCP Server listening on :3001

    Note over App,FS: Connection Setup
    App->>RFB: new RemoteFilesystemBackend({host: 'build-server.com', ...})
    App->>RFB: connect()
    RFB->>SSH: Create SSH client
    SSH->>Daemon: SSH handshake + authentication
    Daemon-->>SSH: SSH session established
    SSH-->>RFB: Connected
    RFB-->>App: Connected

    Note over App,FS: Direct Backend Operations (via SSH/SFTP)
    App->>RFB: write('config.json', '{...}')
    RFB->>SSH: SFTP writeFile('/var/workspace/config.json')
    SSH->>Daemon: SFTP protocol
    Daemon->>FS: Write file
    FS-->>Daemon: Success
    Daemon-->>SSH: SFTP response
    SSH-->>RFB: Success
    RFB-->>App: Success

    App->>RFB: read('config.json')
    RFB->>SSH: SFTP readFile('/var/workspace/config.json')
    SSH->>Daemon: SFTP protocol
    Daemon->>FS: Read file
    FS-->>Daemon: File contents
    Daemon-->>SSH: SFTP response
    SSH-->>RFB: File contents
    RFB-->>App: File contents

    App->>RFB: exec('npm install')
    RFB->>SSH: SSH exec command
    SSH->>Daemon: SSH protocol
    Daemon->>FS: spawn('npm install')
    FS-->>Daemon: stdout/stderr/exitCode
    Daemon-->>SSH: SSH response
    SSH-->>RFB: {stdout, stderr, exitCode}
    RFB-->>App: {stdout, stderr, exitCode}

    Note over App,FS: MCP Tool Flow (for AI Agents)
    App->>RFB: getMCPClient()
    RFB->>MCP: Create MCP client (HTTP build-server.com:3001)
    MCP-->>RFB: MCP client instance
    RFB-->>App: MCP client instance

    App->>MCP: listTools()
    MCP->>Daemon: GET /mcp - list tools<br/>Authorization: Bearer token
    Daemon-->>MCP: Available tools: [exec, read, write, ...]
    MCP-->>App: Tool schemas

    Note over App,MCP: Pass tools to AI agent or invoke manually
    App->>MCP: callTool({name: 'exec', arguments: {command: 'npm test'}})
    MCP->>Daemon: POST /mcp - MCP tool call<br/>Authorization: Bearer token
    Daemon->>FS: spawn('npm test') in /var/workspace
    FS-->>Daemon: stdout/stderr/exitCode
    Daemon-->>MCP: MCP tool result {content: [...]}
    MCP-->>App: Tool result
```

### Configuration

**Remote server (Docker):**
```bash
# Start Docker container with full daemon
agent-backend start-docker --build

# Or manually:
docker run -d \
  -p 2222:22 \
  -p 3001:3001 \
  -e SSH_USERS="agent:secure-password" \
  -e MCP_AUTH_TOKEN="your-secure-token" \
  agentbe/remote-backend:latest
```

**Application code (client):**
```typescript
import { RemoteFilesystemBackend } from 'agent-backend'

const backend = new RemoteFilesystemBackend({
  host: 'build-server.com',
  sshPort: 2222,
  mcpPort: 3001,
  rootDir: '/var/workspace',
  sshAuth: {
    type: 'password',
    credentials: {
      username: 'agent',
      password: 'secure-password'
    }
  },
  mcpAuthToken: 'your-secure-token'
})

// Connect to remote server
await backend.connect()

// Direct backend operations (via SSH/SFTP)
await backend.write('deploy.yml', 'version: 2...')
const files = await backend.readdir('.')
const result = await backend.exec('docker-compose up -d')
console.log(result.stdout)

// OR: Get MCP client for AI agent integration
const mcp = await backend.getMCPClient()
const tools = await mcp.listTools()
// Pass tools to AI agent (e.g., Claude, GPT) or invoke manually:
const mcpResult = await mcp.callTool({
  name: 'read',
  arguments: { path: 'logs/app.log' }
})

// Cleanup
await backend.disconnect()
```

### Key Characteristics

- ✅ **Two machines** - Client and remote server
- ✅ **SSH for files** - SFTP protocol for file operations
- ✅ **MCP for exec** - Commands run through authenticated MCP endpoint
- ✅ **Secure** - SSH + bearer token authentication
- ✅ **Isolated** - Remote server can be sandboxed/containerized
- ✅ **Scalable** - Can connect to multiple remote servers
- ✅ **Production-ready** - Proper authentication and error handling

---

## Multi-Tenancy with Scoping

Both backends support scoping for isolation:

```mermaid
%%{init: {'theme':'base', 'themeVariables': { 'fontSize':'16px', 'fontFamily':'system-ui, -apple-system, sans-serif'}}}%%
graph TB
    subgraph userApp["👥 Your Application"]
        App["<b>Multi-Tenant App Code</b>"]
        User1["<b>User Session:</b> alice"]
        User2["<b>User Session:</b> bob"]
    end

    subgraph library["📦 agent-backend Library"]
        Backend["<b>Backend Instance</b><br/>rootDir: /var/workspace"]
        Scope1["<b>Scoped Backend</b><br/>users/alice"]
        Scope2["<b>Scoped Backend</b><br/>users/bob"]
    end

    subgraph fsLayer["💾 Filesystem"]
        Root["<b>/var/workspace</b>"]
        Alice["<b>/var/workspace/users/alice</b>"]
        Bob["<b>/var/workspace/users/bob</b>"]
    end

    App -.-> Backend
    User1 ==>|uses| Scope1
    User2 ==>|uses| Scope2
    Backend -.->|".scope('users/alice')"| Scope1
    Backend -.->|".scope('users/bob')"| Scope2
    Scope1 ==> Alice
    Scope2 ==> Bob
    Backend -.-> Root

    classDef userCode fill:#f8f9fa,stroke:#495057,stroke-width:2px,color:#212529
    classDef agentBackend fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef agentBackendLight fill:#64B5F6,stroke:#2E5C8A,stroke-width:2px,color:#fff
    classDef storage fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20

    class App,User1,User2 userCode
    class Backend agentBackend
    class Scope1,Scope2 agentBackendLight
    class Root,Alice,Bob storage

    style userApp fill:#fafafa,stroke:#666,stroke-width:2px
    style library fill:#f0f7ff,stroke:#666,stroke-width:2px
    style fsLayer fill:#f1f8f4,stroke:#666,stroke-width:2px
```

**Example:**
```typescript
// Base backend
const backend = new LocalFilesystemBackend({
  rootDir: '/tmp/workspace'
})

// Create isolated scopes per user
const aliceBackend = backend.scope('users/alice')
const bobBackend = backend.scope('users/bob')

// Alice can only access /tmp/workspace/users/alice
await aliceBackend.write('private.txt', 'Alice data')
await aliceBackend.exec('npm install')  // Runs in /tmp/workspace/users/alice

// Bob can only access /tmp/workspace/users/bob
await bobBackend.write('private.txt', 'Bob data')
await bobBackend.exec('npm install')  // Runs in /tmp/workspace/users/bob

// Path escape attempts are blocked
await aliceBackend.write('../bob/steal.txt', 'data')  // Throws PathEscapeError
```

---

## Summary

```mermaid
%%{init: {'theme':'base', 'themeVariables': { 'fontSize':'16px', 'fontFamily':'system-ui, -apple-system, sans-serif'}}}%%
graph TB
    Start{"<b>Deployment Type?</b>"}

    Local["<b>LocalFilesystemBackend</b><br/><i>agent-backend</i>"]
    Remote["<b>RemoteFilesystemBackend</b><br/><i>agent-backend</i>"]

    Daemon1["<b>agentbe-daemon</b><br/>--local-only"]
    Daemon2["<b>agentbe-daemon</b><br/>full mode"]

    MCP1["<b>MCP Server Only</b>"]
    MCP2["<b>MCP Server + SSH Daemon</b>"]

    Use1["<b>Protocol:</b><br/>Direct fs + MCP HTTP"]
    Use2["<b>Protocol:</b><br/>SSH/SFTP + MCP HTTP"]

    Result1["✅ <b>Local Dev</b><br/>• Fast & Simple<br/>• Single Machine<br/>• macOS/Windows/Linux"]
    Result2["✅ <b>Production</b><br/>• Secure & Isolated<br/>• Distributed<br/>• Production Ready"]

    Start -->|"💻 Local Development"| Local
    Start -->|"🖧 Production/Remote"| Remote

    Local -.-> Daemon1
    Remote -.-> Daemon2

    Daemon1 -.-> MCP1
    Daemon2 -.-> MCP2

    Local ==> Use1
    Remote ==> Use2

    Use1 ==> Result1
    Use2 ==> Result2

    classDef decision fill:#f8f9fa,stroke:#495057,stroke-width:3px,color:#212529
    classDef agentBackend fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef daemon fill:#607D8B,stroke:#455A64,stroke-width:3px,color:#fff
    classDef daemonLight fill:#78909C,stroke:#455A64,stroke-width:2px,color:#fff
    classDef protocol fill:#64B5F6,stroke:#2E5C8A,stroke-width:2px,color:#fff
    classDef success fill:#C8E6C9,stroke:#2E7D32,stroke-width:3px,color:#1B5E20

    class Start decision
    class Local,Remote agentBackend
    class Daemon1,Daemon2 daemon
    class MCP1,MCP2 daemonLight
    class Use1,Use2 protocol
    class Result1,Result2 success
```

**Key Takeaways:**

1. **LocalFilesystemBackend** - Direct file access, MCP for commands, single machine
2. **RemoteFilesystemBackend** - SSH for files, MCP for commands, multi-machine
3. **Local-only mode** - Runs MCP server in stdio mode and skips SSH. Works on most platforms including MacOS and Windows.
4. **Full daemon mode** - Linux only, includes SSH, for production
5. **Scoping** - Multi-tenancy isolation for both backends
6. **Security** - Path validation, command safety, authentication layers
