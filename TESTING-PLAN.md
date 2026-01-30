# Agent Backend - Testing Plan

Comprehensive test coverage for all components in the monorepo.

---

## Table of Contents

- [Backend Classes](#backend-classes)
  - [LocalFilesystemBackend](#localfilesystembackend)
  - [RemoteFilesystemBackend](#remotefilesystembackend)
  - [MemoryBackend](#memorybackend)
  - [ScopedFilesystemBackend](#scopedfilesystembackend)
  - [ScopedMemoryBackend](#scopedmemorybackend)
- [Backend Pool Manager](#backend-pool-manager)
- [Security Tests](#security-tests)
- [MCP Integration](#mcp-integration)
- [CLI Tests](#cli-tests)
- [Integration Tests](#integration-tests)
- [Deployment Tests](#deployment-tests)

---

## Backend Classes

### LocalFilesystemBackend

#### Configuration & Initialization
- [ ] Constructor validates required config fields
- [ ] Creates rootDir if it doesn't exist
- [ ] Detects shell (bash/sh) correctly with `shell: 'auto'`
- [ ] Respects explicit shell setting
- [ ] Detects isolation mode correctly with `isolation: 'auto'`
- [ ] Uses bwrap when `isolation: 'bwrap'` and available
- [ ] Falls back to software isolation when bwrap unavailable
- [ ] Throws error when `isolation: 'bwrap'` but bwrap not installed
- [ ] Validates required utilities when `validateUtils: true`
- [ ] Uses correct default values for optional config

#### File Operations
- [ ] `read()` - reads text files (encoding: 'utf8')
- [ ] `read()` - reads binary files (encoding: 'buffer')
- [ ] `read()` - throws on non-existent file
- [ ] `write()` - writes text content
- [ ] `write()` - writes buffer content
- [ ] `write()` - creates parent directories if needed
- [ ] `readdir()` - lists directory contents
- [ ] `readdir()` - returns empty array for empty directory
- [ ] `readdir()` - throws on non-existent directory
- [ ] `mkdir()` - creates directory
- [ ] `mkdir()` - creates nested directories with `recursive: true`
- [ ] `mkdir()` - throws without `recursive` when parent missing
- [ ] `touch()` - creates empty file
- [ ] `touch()` - updates mtime on existing file
- [ ] `exists()` - returns true for existing file
- [ ] `exists()` - returns false for non-existent file
- [ ] `stat()` - returns correct file stats
- [ ] `stat()` - distinguishes files vs directories

#### Path Validation (CRITICAL SECURITY)
- [ ] Blocks absolute paths (`/etc/passwd`)
- [ ] Blocks parent directory escapes (`../../../etc/passwd`)
- [ ] Blocks complex escapes (`foo/../../bar/../../../etc/passwd`)
- [ ] Blocks home directory (`~/file.txt`)
- [ ] Allows valid relative paths within rootDir
- [ ] Normalizes paths correctly (`.`, `./`, etc.)
- [ ] Handles edge cases (empty path, `.`, `..`)

#### Command Execution - Software/None Isolation
- [ ] `exec()` executes commands with correct cwd
- [ ] `exec()` returns stdout as string (default)
- [ ] `exec()` returns stdout as buffer when `encoding: 'buffer'`
- [ ] `exec()` throws on non-zero exit code
- [ ] `exec()` includes stderr in error message
- [ ] `exec()` respects maxOutputLength
- [ ] `exec()` truncates output when exceeding max
- [ ] `exec()` blocks dangerous commands when `preventDangerous: true`
- [ ] `exec()` allows dangerous commands when `preventDangerous: false`
- [ ] `exec()` calls onDangerousOperation callback
- [ ] `exec()` merges custom env with process.env
- [ ] `exec()` respects timeout settings

#### Command Execution - Bubblewrap Isolation
- [ ] `exec()` uses bwrap when `isolation: 'bwrap'`
- [ ] `execWithBwrap()` binds rootDir to /workspace
- [ ] `execWithBwrap()` sets correct cwd in sandbox
- [ ] `execWithBwrap()` blocks absolute host filesystem access
- [ ] `execWithBwrap()` allows reading files within workspace
- [ ] `execWithBwrap()` creates isolated /tmp
- [ ] `execWithBwrap()` provides clear error when bwrap fails
- [ ] `execWithBwrap()` handles nested scope paths correctly
- [ ] Bwrap isolation prevents accessing parent directories
- [ ] Bwrap isolation works with complex directory structures

#### Scoping
- [ ] `scope()` creates ScopedFilesystemBackend
- [ ] `scope()` sets correct scopePath
- [ ] `scope()` inherits isolation mode
- [ ] `scope()` merges environment variables
- [ ] `scope()` allows nested scopes
- [ ] `listScopes()` returns immediate subdirectories only
- [ ] `listScopes()` returns empty array when no subdirectories

#### MCP Client
- [ ] `getMCPClient()` spawns agentbe-server
- [ ] `getMCPClient()` passes correct --backend flag
- [ ] `getMCPClient()` passes --rootDir correctly
- [ ] `getMCPClient()` passes --isolation flag
- [ ] `getMCPClient()` passes --shell flag
- [ ] `getMCPClient()` uses scopePath when provided
- [ ] `getMCPClient()` returns connected MCP Client
- [ ] Client can call tools successfully
- [ ] Client closes cleanly

#### Cleanup
- [ ] `destroy()` completes without error
- [ ] `destroy()` logs appropriate message

---

### RemoteFilesystemBackend

#### Configuration & Initialization
- [ ] Constructor validates required fields (host, rootDir, sshAuth)
- [ ] Accepts password authentication
- [ ] Accepts key-based authentication
- [ ] Validates SSH auth credentials
- [ ] Uses default port (22) when not specified
- [ ] Respects custom port setting
- [ ] Sets correct operation timeout
- [ ] Initializes pending operations queue

#### SSH Connection Management
- [ ] Establishes SSH connection on first operation
- [ ] Reuses existing connection for subsequent operations
- [ ] Handles connection failures gracefully
- [ ] Reconnects after connection loss
- [ ] Respects keepalive settings
- [ ] Times out stale connections
- [ ] Closes connection on destroy

#### File Operations (via SFTP)
- [ ] `read()` - reads remote files (text)
- [ ] `read()` - reads remote files (buffer)
- [ ] `write()` - writes to remote files
- [ ] `readdir()` - lists remote directory contents
- [ ] `mkdir()` - creates remote directories
- [ ] `exists()` - checks remote file existence
- [ ] `stat()` - returns remote file stats
- [ ] Operations work after connection retry
- [ ] Handles large files correctly
- [ ] Respects file permissions

#### Command Execution (via SSH)
- [ ] `exec()` executes commands on remote host
- [ ] `exec()` sets correct cwd
- [ ] `exec()` returns stdout as string
- [ ] `exec()` returns stdout as buffer
- [ ] `exec()` throws on non-zero exit code
- [ ] `exec()` respects timeout
- [ ] `exec()` blocks dangerous commands when configured
- [ ] `exec()` merges environment variables
- [ ] `exec()` handles stderr correctly

#### Path Validation
- [ ] Uses path.posix for remote paths
- [ ] Blocks absolute paths
- [ ] Blocks directory escapes
- [ ] Validates paths before SFTP operations
- [ ] Validates paths before SSH commands

#### Scoping
- [ ] `scope()` creates ScopedFilesystemBackend
- [ ] Remote scoped operations work correctly
- [ ] `listScopes()` returns remote subdirectories

#### MCP Client
- [ ] `getMCPClient()` spawns agentbe-server
- [ ] `getMCPClient()` passes --host flag
- [ ] `getMCPClient()` passes --username flag
- [ ] `getMCPClient()` passes --password or --privateKey
- [ ] `getMCPClient()` passes --port when custom
- [ ] Client connects successfully
- [ ] Client can execute remote commands

#### Connection Pooling
- [ ] Queues operations when connection busy
- [ ] Processes queued operations in order
- [ ] Handles concurrent operations correctly
- [ ] Fails gracefully on connection errors

#### Cleanup
- [ ] `destroy()` rejects pending operations
- [ ] `destroy()` closes SFTP session
- [ ] `destroy()` closes SSH connection
- [ ] `destroy()` clears operation queue

---

### MemoryBackend

#### Configuration & Initialization
- [ ] Constructor initializes empty store
- [ ] Accepts rootDir configuration
- [ ] Sets type to BackendType.MEMORY

#### Key/Value Operations
- [ ] `write()` stores string values
- [ ] `write()` stores buffer values
- [ ] `read()` retrieves stored values
- [ ] `read()` throws on non-existent key
- [ ] `read()` returns correct encoding
- [ ] `exists()` returns true for existing keys
- [ ] `exists()` returns false for missing keys
- [ ] `stat()` returns appropriate metadata
- [ ] Keys are case-sensitive

#### Directory Simulation
- [ ] `readdir()` lists keys with common prefix
- [ ] `readdir()` returns relative paths
- [ ] `readdir()` distinguishes files from directories
- [ ] `mkdir()` succeeds (no-op for memory)
- [ ] Implicit directory creation from nested keys
- [ ] `touch()` creates empty key

#### Memory-Specific Operations
- [ ] `list()` returns all keys with prefix
- [ ] `list()` filters by prefix correctly
- [ ] `delete()` removes single key
- [ ] `clear()` removes all keys
- [ ] Operations are atomic

#### Command Execution
- [ ] `exec()` throws NotImplementedError
- [ ] Error message is clear about memory backend limitation

#### Scoping
- [ ] `scope()` creates ScopedMemoryBackend
- [ ] Scoped operations use correct key prefixes
- [ ] `listScopes()` returns scoped keys

#### MCP Client
- [ ] `getMCPClient()` spawns agentbe-server with --backend memory
- [ ] Client does NOT have exec tool
- [ ] Client has all filesystem tools
- [ ] Client operations work correctly

#### Cleanup
- [ ] `destroy()` clears all data
- [ ] Store is empty after destroy

---

### ScopedFilesystemBackend

#### Construction & Validation
- [ ] Constructor validates scopePath
- [ ] Rejects absolute scopePaths
- [ ] Rejects paths that escape parent
- [ ] Calculates correct rootDir (parent.rootDir + scopePath)
- [ ] Inherits parent's type
- [ ] Inherits parent's connection status

#### Path Translation (CRITICAL SECURITY)
- [ ] `toParentPath()` prepends scopePath correctly
- [ ] `toParentPath()` blocks absolute paths
- [ ] `toParentPath()` blocks `..` that escapes scope
- [ ] `toParentPath()` blocks `../../` that escapes scope
- [ ] `toParentPath()` allows `.` (current directory)
- [ ] `toParentPath()` allows valid relative paths
- [ ] `toParentPath()` normalizes complex paths correctly
- [ ] Multiple `..` segments handled correctly

#### File Operations Delegation
- [ ] `read()` delegates to parent with correct path
- [ ] `write()` delegates to parent with correct path
- [ ] `readdir()` delegates to parent with correct path
- [ ] `mkdir()` delegates to parent with correct path
- [ ] `touch()` delegates to parent with correct path
- [ ] `exists()` delegates to parent with correct path
- [ ] `stat()` delegates to parent with correct path
- [ ] All operations stay within scope boundary

#### Command Execution
- [ ] `exec()` sets cwd to scoped directory
- [ ] `exec()` works with parent's isolation mode
- [ ] `exec()` merges environment variables correctly
- [ ] `exec()` respects parent's settings
- [ ] Bwrap mode calculates correct sandbox cwd

#### Environment Variables
- [ ] Custom env merges with parent env
- [ ] Scoped env overrides parent env for same keys
- [ ] Parent env is not modified
- [ ] Multiple scope levels merge correctly

#### Nested Scoping
- [ ] `scope()` creates nested ScopedFilesystemBackend
- [ ] Nested scope paths combine correctly (`scope1/scope2`)
- [ ] Nested scope environments cascade
- [ ] Nested scope validation prevents escapes at any level
- [ ] Three-level nesting works correctly

#### Operations Logging
- [ ] Custom logger receives scoped operations
- [ ] Logged paths are scoped correctly
- [ ] Logging mode is inherited from parent

---

### ScopedMemoryBackend

#### Construction
- [ ] Constructor validates scopePath
- [ ] Rejects absolute scopePaths
- [ ] Rejects escape attempts
- [ ] Sets up correct key prefix

#### Key Translation
- [ ] `toParentKey()` prepends scope prefix
- [ ] `toParentKey()` blocks escapes
- [ ] `fromParentKey()` strips scope prefix
- [ ] Keys are scoped correctly

#### Operations
- [ ] `write()` uses scoped keys
- [ ] `read()` uses scoped keys
- [ ] `exists()` checks scoped keys
- [ ] `readdir()` lists scoped keys only
- [ ] `list()` returns keys within scope
- [ ] `delete()` removes scoped key only
- [ ] `clear()` removes only scoped keys

#### Nested Scoping
- [ ] Nested scopes combine prefixes correctly
- [ ] Multiple nesting levels work

---

## Backend Pool Manager

### Configuration & Initialization
- [ ] Constructor validates backendClass
- [ ] Constructor validates defaultConfig
- [ ] Initializes empty pool
- [ ] Sets up cleanup interval

### Backend Acquisition & Release
- [ ] `acquireBackend()` creates new backend when pool empty
- [ ] `acquireBackend()` reuses backend with matching key
- [ ] `acquireBackend()` creates new backend for different key
- [ ] `release()` returns backend to pool
- [ ] `release()` makes backend available for reuse
- [ ] Backend reuse works correctly

### withBackend Helper
- [ ] `withBackend()` acquires backend
- [ ] `withBackend()` executes callback with backend
- [ ] `withBackend()` releases backend after success
- [ ] `withBackend()` releases backend after error
- [ ] `withBackend()` propagates callback return value
- [ ] `withBackend()` propagates callback errors

### Key-Based Pooling
- [ ] Same key reuses same backend
- [ ] Different keys get different backends
- [ ] Key can be any string
- [ ] Undefined key creates non-pooled backend
- [ ] Pool stats show correct backend count per key

### Statistics
- [ ] `getStats()` returns total backends
- [ ] `getStats()` shows backends per key
- [ ] Stats update when acquiring
- [ ] Stats update when releasing

### Cleanup & Destroy
- [ ] Periodic cleanup runs
- [ ] `destroyAll()` calls destroy on all backends
- [ ] `destroyAll()` clears pool
- [ ] Pool is empty after destroyAll
- [ ] Backends are unusable after destroyAll

### Concurrent Usage
- [ ] Multiple concurrent acquires work
- [ ] Pool handles race conditions
- [ ] Backend locking prevents double-use

---

## Security Tests

### Path Escape Prevention (CRITICAL)

#### Absolute Paths
- [ ] `/etc/passwd` blocked
- [ ] `/tmp/evil` blocked
- [ ] `/var/www` blocked
- [ ] Absolute paths in nested operations blocked

#### Directory Traversal
- [ ] `../../../etc/passwd` blocked
- [ ] `foo/../../bar/../../../etc` blocked
- [ ] Complex traversal sequences blocked
- [ ] Normalized paths still validated

#### Special Paths
- [ ] `~/secret.txt` blocked
- [ ] `~root/.ssh/id_rsa` blocked
- [ ] `$HOME/file` blocked (if not sanitized)

#### Symlinks (if applicable)
- [ ] Symlinks to parent directories blocked
- [ ] Symlinks outside workspace blocked
- [ ] Symlinks within workspace allowed

#### Unicode & Edge Cases
- [ ] Unicode path tricks blocked
- [ ] Null byte injection blocked (`file.txt\0.exe`)
- [ ] Path encoding tricks blocked
- [ ] Empty paths handled gracefully

### Command Injection Prevention

#### Shell Metacharacters
- [ ] `; cat /etc/passwd` blocked
- [ ] `&& cat /etc/passwd` blocked
- [ ] `|| cat /etc/passwd` blocked
- [ ] `| cat /etc/passwd` blocked
- [ ] `$(cat /etc/passwd)` blocked
- [ ] Backtick injection blocked
- [ ] `> /etc/passwd` blocked
- [ ] `< /etc/passwd` blocked

#### Dangerous Commands (when preventDangerous: true)
- [ ] `rm -rf /` blocked
- [ ] `rm -rf /*` blocked
- [ ] `sudo` commands blocked
- [ ] `mkfs` blocked
- [ ] `dd` blocked
- [ ] `curl ... | sh` blocked
- [ ] `:(){:|:&};:` (fork bomb) blocked

#### Environment Variable Injection
- [ ] `LD_PRELOAD=...` blocked or sanitized
- [ ] `PATH=...` handled correctly
- [ ] Malicious env vars blocked

### Multi-Tenant Isolation

#### Scope Boundary Protection
- [ ] User1 cannot read `../user2/secret.txt`
- [ ] User1 cannot write `../user2/hacked.txt`
- [ ] User1 cannot exec commands in user2's scope
- [ ] User1 cannot list user2's directory via `../`
- [ ] Nested scopes properly isolated

#### Bwrap Isolation (Linux)
- [ ] Bwrap prevents access to parent filesystem
- [ ] Bwrap creates isolated /tmp
- [ ] Bwrap prevents privilege escalation
- [ ] Bwrap limits resource access
- [ ] User cannot break out of sandbox

#### Resource Limits
- [ ] Output length limits work
- [ ] Operation timeouts work
- [ ] Memory limits enforced (if applicable)
- [ ] CPU limits enforced (if applicable)

---

## MCP Integration

### LocalFilesystemMCPServer

#### Server Initialization
- [ ] Server starts successfully
- [ ] Server registers all filesystem tools
- [ ] Server registers exec tool
- [ ] Server metadata correct (name, version)

#### Filesystem Tools
- [ ] `read_text_file` works
- [ ] `read_media_file` returns base64
- [ ] `read_multiple_files` handles multiple files
- [ ] `write_file` creates files
- [ ] `edit_file` makes precise edits
- [ ] `create_directory` creates directories
- [ ] `list_directory` lists contents
- [ ] `list_directory_with_sizes` includes sizes
- [ ] `directory_tree` returns JSON tree
- [ ] `move_file` moves files
- [ ] `search_files` finds matching files
- [ ] `get_file_info` returns metadata
- [ ] `list_allowed_directories` shows rootDir

#### Exec Tool
- [ ] `exec` tool is registered
- [ ] `exec` executes commands
- [ ] `exec` returns output
- [ ] `exec` handles errors

#### Client Integration
- [ ] getMCPClient() creates working client
- [ ] Client can list tools
- [ ] Client can call each tool
- [ ] Client receives correct responses
- [ ] Client handles errors

### RemoteFilesystemMCPServer

#### Server Initialization
- [ ] Server starts successfully
- [ ] Registers filesystem tools
- [ ] Registers exec tool
- [ ] Works with RemoteFilesystemBackend

#### Remote Operations
- [ ] Tools work over SSH connection
- [ ] File operations use SFTP
- [ ] Exec runs commands remotely
- [ ] Client integration works

### MemoryMCPServer

#### Server Initialization
- [ ] Server starts successfully
- [ ] Registers filesystem tools
- [ ] Does NOT register exec tool
- [ ] Tool list excludes exec

#### Memory Operations
- [ ] Filesystem tools work with memory backend
- [ ] Key/value operations function correctly
- [ ] Client integration works
- [ ] Calling exec tool throws error

### Tool Registration

#### registerFilesystemTools()
- [ ] Registers all filesystem tools
- [ ] Tools work with any FileBasedBackend
- [ ] Helper functions work correctly
- [ ] Error handling works

#### registerExecTool()
- [ ] Registers exec tool
- [ ] Works with FileBasedBackend
- [ ] Throws on MemoryBackend

---

## CLI Tests

### agentbe-server Binary

#### Help & Documentation
- [ ] `agentbe-server --help` shows full help
- [ ] `agentbe-server help` shows full help
- [ ] Help includes all commands
- [ ] Help includes all options
- [ ] Examples are clear and correct

#### MCP Server - Local Backend
- [ ] `--backend local` starts server
- [ ] `--rootDir` is required
- [ ] `--rootDir` is used correctly
- [ ] `--isolation auto` uses bwrap if available
- [ ] `--isolation bwrap` works on Linux
- [ ] `--isolation software` works everywhere
- [ ] `--isolation none` works
- [ ] `--shell bash` sets shell
- [ ] `--shell sh` sets shell
- [ ] Server starts on stdio
- [ ] Server responds to MCP requests

#### MCP Server - Remote Backend
- [ ] `--backend remote` starts server
- [ ] `--host` is required
- [ ] `--username` is required
- [ ] `--password` authentication works
- [ ] `--privateKey` authentication works
- [ ] `--port` custom port works
- [ ] Server connects to SSH host
- [ ] Server responds to MCP requests

#### MCP Server - Memory Backend
- [ ] `--backend memory` starts server
- [ ] Server works with memory backend
- [ ] exec tool is NOT available
- [ ] Other tools work correctly

#### Docker Remote Management
- [ ] `start-remote` requires Docker
- [ ] `start-remote` builds image
- [ ] `start-remote` starts container
- [ ] `start-remote` shows success message
- [ ] `start-remote --build` rebuilds image
- [ ] Container is accessible via SSH
- [ ] Container runs MCP server
- [ ] `stop-remote` stops container
- [ ] `stop-remote` removes container
- [ ] Running `start-remote` twice doesn't duplicate

#### Error Handling
- [ ] Missing `--rootDir` shows error
- [ ] Invalid `--backend` shows error
- [ ] Missing remote config shows error
- [ ] Docker not installed shows helpful error
- [ ] Connection failures show helpful errors

---

## Integration Tests

### End-to-End Workflows

#### Local Development Workflow
- [ ] Create LocalFilesystemBackend
- [ ] Write files
- [ ] Execute commands
- [ ] Create scoped backend
- [ ] Scoped operations work
- [ ] getMCPClient() works
- [ ] MCP tools match backend operations
- [ ] Cleanup works

#### Remote Deployment Workflow
- [ ] Start remote backend with CLI
- [ ] Create RemoteFilesystemBackend
- [ ] Connect to remote backend
- [ ] Perform file operations
- [ ] Execute remote commands
- [ ] getMCPClient() works
- [ ] Stop remote backend

#### Multi-Tenant Application
- [ ] Create shared backend
- [ ] Create user1 scope
- [ ] Create user2 scope
- [ ] User1 operations isolated
- [ ] User2 operations isolated
- [ ] Users cannot access each other
- [ ] Pool manager reuses connections

#### Memory State Management
- [ ] Create MemoryBackend
- [ ] Store agent state
- [ ] Retrieve agent state
- [ ] List all states
- [ ] Delete states
- [ ] Clear all states
- [ ] Scoped memory works

### Cross-Backend Compatibility

#### Scoping Works Across Backends
- [ ] LocalFilesystemBackend scoping
- [ ] RemoteFilesystemBackend scoping
- [ ] MemoryBackend scoping
- [ ] Nested scopes work for all

#### Pool Manager Works with All Backends
- [ ] Pool LocalFilesystemBackend
- [ ] Pool RemoteFilesystemBackend
- [ ] Pool MemoryBackend
- [ ] Mixed backend pools

### MCP Client & Server Integration

#### Client Spawns Server
- [ ] Local backend spawns local server
- [ ] Remote backend spawns remote server
- [ ] Memory backend spawns memory server
- [ ] Scoped backend spawns with scope path

#### Tool Filtering
- [ ] Local server has exec tool
- [ ] Remote server has exec tool
- [ ] Memory server lacks exec tool
- [ ] Calling missing tool errors appropriately

---

## Deployment Tests

### Docker Image

#### Build
- [ ] Image builds successfully
- [ ] All dependencies included
- [ ] Entrypoint script works
- [ ] Correct base image used

#### Runtime
- [ ] Container starts successfully
- [ ] SSH daemon starts
- [ ] SSH users created correctly
- [ ] Workspace directories created
- [ ] MCP server starts (if configured)
- [ ] Environment variables work

#### Networking
- [ ] SSH port (2222) accessible
- [ ] MCP port (3001) accessible (if enabled)
- [ ] Container communicates correctly

### Cloud VM Deployment

#### Azure VM Startup
- [ ] Script installs Docker
- [ ] Script pulls image
- [ ] Script starts container
- [ ] Container runs successfully
- [ ] SSH accessible
- [ ] MCP accessible

#### GCP VM Startup
- [ ] Script installs Docker
- [ ] Script pulls image
- [ ] Script starts container
- [ ] Container runs successfully
- [ ] SSH accessible
- [ ] MCP accessible

### Deployment Tool

#### Web UI
- [ ] UI starts successfully
- [ ] Azure deployment form works
- [ ] GCP deployment form works
- [ ] Generates correct startup scripts
- [ ] Shows deployment status
- [ ] Provides connection details

---

## Test Infrastructure

### Unit Tests
- Each backend class in isolation
- Mock dependencies where appropriate
- Fast execution
- No external dependencies

### Integration Tests
- Real filesystem operations
- Real SSH connections (for remote tests)
- Docker containers (for remote tests)
- Slower but comprehensive

### Security Tests
- Attack scenarios
- Boundary conditions
- Permission checks
- Isolation validation

### End-to-End Tests
- Full workflows
- Multiple components
- Real-world scenarios
- Performance validation

---

## Test Coverage Goals

- **Unit Tests**: >90% code coverage
- **Integration Tests**: All critical paths
- **Security Tests**: All attack vectors
- **E2E Tests**: All major use cases

---

## Testing Tools

- **Unit Testing**: Vitest
- **Assertions**: Built-in + Custom matchers
- **Mocking**: Vitest mocks
- **Test Fixtures**: Temporary directories, test data
- **CI/CD**: GitHub Actions (future)

---

## Priority Levels

**P0 - Critical (Must have before v1.0):**
- All security tests
- Core backend operations
- MCP integration basics
- CLI basic functionality

**P1 - High (Should have):**
- Pool manager
- Error handling
- Edge cases
- Docker deployment

**P2 - Medium (Nice to have):**
- Performance tests
- Cloud deployment
- Advanced scenarios
- Comprehensive error messages

**P3 - Low (Future):**
- Stress tests
- Benchmark suite
- Fuzzing
- UI tests (deploy-tool)

---

## Current Status

### Implemented
- ✅ Backend classes (Local, Remote, Memory)
- ✅ Scoped backends
- ✅ Pool manager
- ✅ MCP servers
- ✅ CLI
- ✅ Deployment infrastructure

### Test Coverage
- ⏳ Unit tests (to be written)
- ⏳ Integration tests (to be written)
- ⏳ Security tests (to be written)
- ⏳ E2E tests (to be written)

---

## Next Steps

1. Set up test infrastructure (Vitest configuration)
2. Write unit tests for LocalFilesystemBackend
3. Write security tests (path escape, command injection)
4. Write MCP integration tests
5. Write CLI tests
6. Write integration tests
7. Measure and report coverage
8. Add CI/CD pipeline
