# agentbe-server

MCP server implementations for Agent Backend.

This package provides backend-specific MCP servers that expose filesystem and execution capabilities via the Model Context Protocol. It is designed to run server-side, separately from the client library (`constellationfs`).

## Overview

`agentbe-server` contains:
- **Backend-specific MCP servers** - LocalFilesystemMCPServer, RemoteFilesystemMCPServer, MemoryMCPServer
- **Shared tool implementations** - Compatible with official @modelcontextprotocol/server-filesystem
- **CLI for starting servers** - `agentbe-server` command (coming soon)
- **Deployment infrastructure** - Docker, cloud VM scripts (coming soon)

## Installation

```bash
npm install agentbe-server
# or
pnpm add agentbe-server
```

## Usage

### LocalFilesystemMCPServer

For local filesystem access with command execution:

```typescript
import { LocalFilesystemBackend } from 'constellationfs'
import { LocalFilesystemMCPServer } from 'agentbe-server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

// Create backend
const backend = new LocalFilesystemBackend({
  rootDir: '/tmp/workspace',
  isolation: 'bwrap' // Linux only
})

// Create MCP server for this backend
const mcpServer = new LocalFilesystemMCPServer(backend)

// Connect stdio transport
const transport = new StdioServerTransport()
await mcpServer.getServer().connect(transport)

console.error('Local filesystem MCP server running on stdio')
```

### RemoteFilesystemMCPServer

For SSH/SFTP remote filesystem access:

```typescript
import { RemoteFilesystemBackend } from 'constellationfs'
import { RemoteFilesystemMCPServer } from 'agentbe-server'

const backend = new RemoteFilesystemBackend({
  rootDir: '/var/workspace',
  host: 'server.example.com',
  sshAuth: {
    type: 'password',
    username: 'user',
    password: 'secret'
  }
})

const mcpServer = new RemoteFilesystemMCPServer(backend)
// ... connect transport
```

### MemoryMCPServer

For in-memory key/value storage (no exec tool):

```typescript
import { MemoryBackend } from 'constellationfs'
import { MemoryMCPServer } from 'agentbe-server'

const backend = new MemoryBackend({
  rootDir: '/memory'
})

// This server does NOT include the exec tool
const mcpServer = new MemoryMCPServer(backend)
// ... connect transport
```

## Available Tools

All servers provide these filesystem tools (compatible with @modelcontextprotocol/server-filesystem):

**Read Operations:**
- `read_text_file` - Read file contents as text
- `read_media_file` - Read image/audio files as base64
- `read_multiple_files` - Read multiple files simultaneously

**Write Operations:**
- `write_file` - Create or overwrite files
- `edit_file` - Make selective edits with exact text matching

**Directory Operations:**
- `create_directory` - Create directories recursively
- `list_directory` - List directory contents with prefixes
- `list_directory_with_sizes` - List with file sizes and statistics
- `directory_tree` - Get recursive JSON tree structure
- `search_files` - Search for files using glob patterns

**File Operations:**
- `move_file` - Move or rename files/directories
- `get_file_info` - Get detailed file metadata
- `list_allowed_directories` - List accessible directories

**Execution (LocalFilesystemMCPServer and RemoteFilesystemMCPServer only):**
- `exec` - Execute shell commands in workspace

Note: MemoryMCPServer does NOT provide the `exec` tool.

## Tool Registration API

For custom MCP servers, use the tool registration functions:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerFilesystemTools, registerExecTool } from 'agentbe-server'

const server = new McpServer({ name: 'custom', version: '1.0.0' })

// Register filesystem tools
registerFilesystemTools(server, async (sessionId) => {
  // Return backend instance for this session
  return getBackendForSession(sessionId)
})

// Optionally register exec tool (only for FileBasedBackend)
registerExecTool(server, async (sessionId) => {
  return getBackendForSession(sessionId)
})
```

## CLI

The `agentbe-server` command starts an MCP server for the specified backend type:

```bash
# Local filesystem with bwrap isolation (Linux only)
agentbe-server --backend local --rootDir /tmp/workspace --isolation bwrap

# Remote filesystem via SSH
agentbe-server --backend remote --rootDir /var/workspace \
  --host server.example.com --username user --password secret

# Memory backend (no exec tool)
agentbe-server --backend memory --rootDir /memory
```

### CLI Options

**Common:**
- `--backend <type>` - Backend type: local, remote, memory (default: local)
- `--rootDir <path>` - Root directory for backend (required)

**Local backend:**
- `--isolation <mode>` - Isolation mode: auto, bwrap, software, none
- `--shell <shell>` - Shell: bash, sh, auto

**Remote backend:**
- `--host <host>` - SSH host (required)
- `--username <user>` - SSH username (required)
- `--password <pass>` - SSH password
- `--privateKey <path>` - SSH private key file (alternative to password)
- `--port <port>` - SSH port (default: 22)

Run `agentbe-server --help` for full usage information.

## Deployment (Coming Soon)

Docker and cloud VM deployment scripts will be available in the `deploy/` directory.

## Architecture

This package is designed to run **server-side**, separate from the client library (`constellationfs`). Users who want to:
- Use their own server implementation
- Use a hosted Agent Backend solution
- Only need the client library

...should install only `constellationfs` and not this package.

## License

MIT
