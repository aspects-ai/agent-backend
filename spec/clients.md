# Agent Backend Specification

This document is the language-agnostic source of truth for the Agent Backend client library API. All client implementations (TypeScript, Python, etc.) MUST conform to the behavioral contracts described here.

Implementations SHOULD use idiomatic patterns for their language (e.g., Python may use `async with` for lifecycle, TypeScript may use `await destroy()`). The exact method names, parameter ordering, and error handling idioms are left to each implementation, but the semantics described here MUST be preserved.

## Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

**Backend** -- A client-side object that provides file operations, command execution, and MCP tool access against a workspace (local directory or remote server). Implementations SHOULD define a base Backend interface that all backend types implement. Operations that only apply to file-based backends (e.g., exec) MAY be separated into a more specific interface.

**Scoped Backend** -- A backend wrapper that restricts operations to a subdirectory of the parent's workspace. Scoped backends delegate operations to their parent after translating paths. Implementations SHOULD treat scoped backends as a distinct type from the backends they wrap, since they have different lifecycle semantics (e.g., destroy does not release resources, status is delegated).

**Workspace** -- The root directory a backend operates within. All paths are relative to this root.

**Scope** -- A restricted view of a backend, rooted at a subdirectory of the parent's workspace. Used for multi-tenant isolation.

**agentbe-daemon** -- The server process that runs on a host and serves the workspace via MCP and SSH over WebSockets.

# Client Libraries

## Backend Types

### Filesystem Backend (Local)

Operates directly on the local filesystem using OS-level APIs. Status is always "connected" until destroyed.

Configuration:
- Workspace root directory (required)
- Isolation mode (auto, bwrap, software, none)
- Whether to block dangerous commands (default: true)
- Maximum output length for command execution
- Shell preference (bash, sh, auto)

### Filesystem Backend (Remote)

Same operations as local, but executed on a remote host via SSH (for file ops) and MCP over HTTP (for tool calls). Requires explicit connection and supports reconnection.

Configuration:
- Workspace root directory on the remote host (required)
- Remote host (required)
- Transport type: SSH-over-WebSocket (default) or conventional SSH (optional to support)
- Authentication credentials (token for WebSocket/MCP; password or key-based for conventional SSH)
- MCP server port
- Reconnection settings (max retries, backoff)
- Operation timeout
- Keepalive interval

### Memory Backend

In-memory key/value store. Keys act as pseudo file paths. Does NOT support command execution.

Configuration:
- Root prefix (optional, default "/")
- Initial data to pre-populate the store

---

## Connection Lifecycle

Backends have a status that reflects their connection state. All backend types MUST expose the same connection status API — the same status property, the same status enum, and the same `onStatusChange` subscription method — regardless of whether the backend actually has meaningful status transitions. This allows host applications to write generic code that handles any backend type without branching on backend kind. For example, a UI can bind a single status indicator to `backend.status` and `backend.onStatusChange()` and have it work identically for local, remote, and memory backends.

### Status Values

- **connected** -- Normal operating state.
- **connecting** -- Initial connection in progress.
- **disconnected** -- No active connection (remote only).
- **reconnecting** -- Retrying after connection loss (remote only).
- **destroyed** -- Backend has been torn down. No further operations allowed.

### Behavior by Backend Type

**Local filesystem:**
- MUST start in "connected" status.
- MUST transition to "destroyed" on destroy.
- MUST NOT have any other status transitions.

**Remote filesystem:**
- MUST start in "disconnected" status.
- MUST transition to "connecting" on first operation or explicit connect call.
- MUST transition to "connected" on successful connection.
- SHOULD attempt reconnection on connection loss if reconnection is enabled.
- MUST transition to "reconnecting" during retry attempts.
- MUST transition to "destroyed" on destroy.
- MUST reject all pending operations when connection is lost.

**Memory:**
- MUST start in "connected" status.
- MUST transition to "destroyed" on destroy.

### Status Observation

Implementations MUST provide a way to subscribe to status changes. Callbacks MUST fire on every status transition.

### Reconnection Behavior (Remote Backends)

Remote backends maintain two independent channels to the daemon: an SSH channel (for file operations and exec) and an MCP channel (HTTP, for tool calls). These channels have different failure and retry semantics.

#### SSH Channel

The SSH channel (SSH-over-WebSocket or conventional SSH) is a persistent connection. Implementations MUST detect connection loss via transport-level events (WebSocket `close`, SSH `close`) and keepalive failures.

**Keepalive:** Implementations SHOULD send SSH keepalive probes at a configurable interval (default: 30 seconds). After a configurable number of missed responses (default: 3), the connection MUST be considered dead and closed.

**On disconnection:**
1. MUST immediately reject all pending operations with a connection-closed error.
2. MUST clear any cached transport state (e.g., SFTP sessions).
3. MUST transition status to "disconnected".
4. MUST schedule a reconnection attempt if reconnection is enabled.

**Reconnection:** Implementations MUST support automatic reconnection with exponential backoff. The reconnection configuration MUST include:
- Whether reconnection is enabled (default: true)
- Maximum retry count (default: 5; 0 means unlimited)
- Initial delay (default: 1000ms)
- Maximum delay cap (default: 30000ms)
- Backoff multiplier (default: 2)

The delay sequence follows `min(initialDelay * multiplier^attempt, maxDelay)`. On successful reconnection, the retry counter MUST reset to zero and status MUST transition to "connected". If max retries are exhausted, the backend MUST remain in "disconnected" status and stop retrying.

If `destroy()` is called while a reconnection is pending, the scheduled retry MUST be cancelled.

#### MCP Channel (HTTP)

The MCP channel uses stateless HTTP requests. There is no persistent connection and no daemon-side session state. Each tool call is an independent HTTP request to the daemon's MCP endpoint.

If an MCP request fails (network error, timeout, non-2xx response), the error MUST propagate to the caller. Implementations MUST NOT automatically retry MCP requests — the caller (typically the AI SDK or application layer) is responsible for retry decisions.

#### Daemon-Side Connection Handling

The daemon does not maintain long-lived client sessions. Each channel is independent:

**SSH-over-WebSocket:** Each incoming WebSocket connection gets its own ephemeral SSH server instance. When the WebSocket closes, the SSH server for that connection is torn down. Spawned child processes (from exec) are not explicitly killed — they terminate naturally when their I/O pipes break.

**MCP over HTTP:** Each HTTP request is handled independently with no server-side session state. There is nothing to clean up when a client disappears.

This stateless daemon design means the client is always responsible for reconnection. The daemon does not track clients, send heartbeats, or attempt to notify clients of impending disconnection. If the daemon process itself restarts, all WebSocket connections drop and clients detect this through their normal disconnection handling.

---

## Destroy / Resource Cleanup

Every backend MUST provide a destroy operation that tears down all resources.

### Behavior

- MUST close all MCP clients and transports created via the backend's MCP integration methods.
- MUST close all resources registered via the closeable tracking mechanism (see below).
- MUST set status to "destroyed".
- SHOULD be idempotent (calling destroy twice MUST NOT throw).
- For remote backends: MUST cancel any pending reconnection attempts, reject all pending operations, and close SSH/WebSocket connections.
- MUST NOT destroy child scoped backends automatically. Children become orphaned when the parent is destroyed.

### Closeable Tracking

Backends MUST provide a way to register external closeable resources (objects with a close method). These resources MUST be closed when the backend is destroyed. This is used internally for MCP clients and transports, and MAY be used by consumers for their own resources.

---

## File Operations

All file-based backends (local, remote, and memory) MUST support the following operations. Paths are always relative to the backend's workspace root unless otherwise noted.

### Path Resolution

Path handling follows the three-case resolution logic and escape prevention rules defined in [docs/filepaths.md](docs/filepaths.md), which is the source of truth for path behavior. In summary:

- Relative paths MUST be resolved against the workspace root.
- Absolute paths that match the workspace root MUST be used directly.
- Absolute paths that do NOT match the workspace root MUST be treated as relative (leading slash stripped).
- Paths containing `..` that would escape the workspace MUST be rejected with a path escape error.
- These rules apply at every scope level for scoped backends.

See [docs/filepaths.md](docs/filepaths.md) for detailed examples, backend-specific path module conventions, and scoped workspace behavior.

### read(path)

Read the contents of a file.

- MUST return file contents as text (default) or raw bytes.
- MUST throw if the file does not exist.
- Implementations SHOULD support an encoding option to choose between text and binary output.

### write(path, content)

Write content to a file, creating or overwriting it.

- MUST accept text or binary content.
- MUST create parent directories automatically if they do not exist.
- MUST throw on write failure.

### readdir(path)

List the immediate children of a directory.

- MUST return a list of entry names (not full paths).
- For memory backends: MUST simulate directory listing via prefix matching on keys, returning only immediate children (first path segment after the prefix).

### mkdir(path)

Create a directory.

- MUST support recursive creation (create intermediate directories).
- For memory backends: MUST be a no-op (directories are implicit in key structure).

### exists(path)

Check whether a file or directory exists.

- MUST return a boolean.
- MUST NOT throw if the path does not exist.

### stat(path)

Get metadata about a file or directory.

- MUST return at minimum: whether it is a file or directory, size in bytes, and modification timestamp.
- For memory backends: MUST return synthetic stats based on the stored value.

### rm(path)

Delete a file or directory.

- MUST support a recursive option for deleting directories and their contents.
- MUST support a force option that suppresses errors when the target does not exist.
- For memory backends with recursive mode: MUST delete the exact key and all keys sharing the prefix.

### rename(oldPath, newPath)

Move or rename a file.

- Both paths MUST be validated against the workspace boundary.

### touch(path)

Create an empty file if it does not exist.

- MUST NOT overwrite existing files.
- For memory backends: MUST create the key with an empty value if it does not exist.

---

## Command Execution

### exec(command)

Execute a shell command within the workspace.

- MUST run the command in a shell (bash preferred, sh as fallback).
- MUST set the working directory to the workspace root (or the scope root for scoped backends).
- MUST set the HOME environment variable to the working directory.
- MUST return the command's standard output as text (default) or raw bytes.
- MUST throw if the command exits with a non-zero exit code. The error SHOULD include stderr (or stdout if stderr is empty).
- Implementations SHOULD support an encoding option (text vs binary output).
- Implementations SHOULD support a custom working directory option, validated to be within the workspace.
- Implementations SHOULD support custom environment variables per invocation.
- Memory backends MUST throw a not-implemented error.

### Output Limits

If a maximum output length is configured:
- MUST truncate output that exceeds the limit.
- SHOULD append a message indicating truncation occurred and the original output length.

### Safety Validation

When dangerous command blocking is enabled (default):
- MUST check commands against known dangerous patterns before execution.
- MUST reject dangerous commands with an appropriate error.
- See [Command Safety](#command-safety) for the full list of blocked patterns.

### Isolation

Implementations SHOULD support isolation modes for sandboxing command execution:

- **auto** (default) -- Detect the best available isolation method. SHOULD use bwrap if available on Linux, falling back to software validation.
- **bwrap** (Linux) -- Namespace isolation via bubblewrap. See [bwrap details](#bwrap-sandbox) below.
- **software** -- Heuristic-based command and path validation only. Works on all platforms.
- **none** -- No isolation. Trust mode for controlled environments.

#### bwrap Sandbox

When bwrap isolation is active, commands MUST be executed inside a bubblewrap sandbox with the following configuration:

**Filesystem mounts:**
- System directories (`/usr`, `/lib`, `/lib64`, `/bin`, `/sbin`) MUST be mounted read-only.
- The workspace root directory MUST be mounted read-write at a sandbox path (e.g., `/tmp/agentbe-workspace`).
- `/dev`, `/proc` MUST be provided as isolated mounts.
- `/tmp` MUST be provided as an isolated tmpfs.

**Namespace isolation:**
- All namespaces MUST be unshared (`--unshare-all`).
- Network access MUST be preserved (`--share-net`).
- The sandbox process MUST be killed if the parent process dies (`--die-with-parent`).

**Working directory:**
- The working directory inside the sandbox MUST correspond to the workspace root (or scope root for scoped backends), mapped to the sandbox mount path.
- HOME MUST be set to the sandbox working directory.

**Detection:**
- When isolation mode is `auto`, implementations SHOULD check for bwrap availability (e.g., `command -v bwrap`) and fall back to `software` if not found.
- When isolation mode is explicitly `bwrap`, implementations MUST throw an error if bwrap is not available.

---

## Scoping

Scoping creates a restricted sub-backend rooted at a subdirectory of the parent workspace. This is the primary mechanism for multi-tenant isolation.

### Creating a Scope

- MUST accept a relative path within the parent workspace.
- MUST validate that the scope path does not escape the parent workspace.
- MAY accept custom environment variables that apply to all commands executed within the scope.
- MAY accept an operations logger for the scope.

### Scoped Backend Behavior

- All file operations MUST be translated to the parent's path space by prepending the scope path.
- exec() MUST set the working directory to the scope's root directory.
- Environment variables MUST be merged: scope env as base, per-command env as override.
- Path validation MUST be applied at the scope level. Paths that escape the scope MUST be rejected, even if they would be valid within the parent.
- The scope's status MUST be inherited from the parent dynamically (via getter, not copied at construction time).
- Scoped backends MUST delegate closeable tracking to the root backend.
- On first write operation, the scope MUST ensure its root directory exists (create if needed). This MUST be deduped to prevent concurrent creation.

### Nested Scoping

- Scopes MUST support creating child scopes.
- Paths combine: the child's scope path is joined with the parent scope's path.
- Environment variables merge at each level (deeper scopes override shallower ones).

### Scope Destruction

- Destroying a scoped backend MUST notify the parent so it can unregister the child.
- Destroying a scoped backend MUST NOT destroy the parent.
- Scoped backends perform no resource cleanup themselves (that is the parent's responsibility).

---

## MCP Integration

Backends MUST provide a way to obtain an MCP (Model Context Protocol) client or transport for exposing workspace tools to AI agents.

### MCP Transport

- MUST return a transport suitable for connecting to an MCP server that operates on the backend's workspace.
- For local and memory backends: MUST spawn the `agent-backend daemon` CLI as a subprocess (stdio transport).
- For remote backends: MUST create an HTTP transport pointing at the remote MCP server.
- MAY accept a scope path to restrict the MCP server's workspace.
- The returned transport MUST be tracked for automatic cleanup on destroy.

### MCP Client

- MUST return a connected MCP client wrapping the transport.
- The client MUST be tracked for automatic cleanup on destroy.
- For local backends: the CLI is spawned with appropriate flags (root directory, isolation mode, shell, local-only).
- For remote backends: the client connects to the remote host's MCP server with authentication.

### MCP Server Tools

When a backend is served via MCP (through the agentbe-daemon), the daemon registers filesystem and execution tools. See the [MCP Server Tools](daemon.md#mcp-server-tools) section of the daemon spec for the full tool list and compatibility requirements.

---

## Connection Pooling

A pool manager provides backend reuse for stateless servers (e.g., web servers handling many requests).

### Key-Based Pooling

- MUST maintain at most one backend instance per key.
- If a backend for a given key exists and is connected, MUST reuse it.
- If a backend for a given key does not exist or is not connected, MUST create a new one.
- Requests without a key MUST create a fresh (non-pooled) backend each time.

### Acquisition and Release

- MUST support both explicit acquire/release and a callback pattern (execute a function with automatic release).
- Acquiring MUST increment a usage counter; releasing MUST decrement it.
- The callback pattern MUST release the backend even if the function throws.

### Idle Cleanup

- Backends with zero active usage that exceed the idle timeout MUST be eligible for cleanup.
- Cleanup MUST call destroy on idle backends and remove them from the pool.
- Periodic cleanup MAY be enabled via configuration.

### Configuration Override

- Per-request configuration overrides MUST be supported.
- Overrides are merged with the pool's default configuration (override values take precedence).

### Statistics

- MUST expose pool stats: total backends, active (in-use) backends, idle backends.

---

## Error Handling

Implementations MUST define error types that distinguish between the following failure modes:

### Backend Error (base)

General backend operation failure. MUST include:
- An error code string identifying the failure type
- A human-readable message
- Optionally, the operation that failed

### Dangerous Operation Error

Thrown when a command is blocked by safety validation.
- MUST include the command that was blocked.

### Path Escape Error

Thrown when a path resolves outside the workspace or scope boundary.
- MUST include the offending path.

### Not Implemented Error

Thrown when an operation is not supported by the backend type (e.g., exec on memory backend).
- MUST include the operation name and backend type.

### Error Codes

Implementations SHOULD use consistent error codes across backends:

| Code | Meaning |
|------|---------|
| EMPTY_COMMAND | Empty command string passed to exec |
| UNSAFE_COMMAND | Command failed safety check |
| EXEC_FAILED | Command exited with non-zero status |
| EXEC_ERROR | Command could not be spawned |
| READ_FAILED | File read failed |
| WRITE_FAILED | File write failed |
| LS_FAILED | Directory listing failed |
| PATH_ESCAPE_ATTEMPT | Path escapes workspace boundary |
| MISSING_UTILITIES | Required system tool not found |
| INVALID_CONFIGURATION | Configuration validation failed |
| DANGEROUS_OPERATION | Dangerous command blocked |
| CONNECTION_CLOSED | Connection lost (remote) |
| KEY_NOT_FOUND | Key does not exist (memory) |

---

## Command Safety

When dangerous command blocking is enabled, commands MUST be checked against known dangerous patterns before execution. The complete list of blocked patterns, pre-processing rules, and response format is defined in [spec/safety.md](safety.md), which is the source of truth for command safety.

The blocked patterns cover:

- **Destructive operations** -- `rm -rf /`, disk overwrite, filesystem formatting, fork bombs
- **Privilege escalation** -- `sudo`, `su`
- **System modification** -- `chmod 777`, `chown root`
- **Pipe-to-shell** -- `curl | sh`, `wget | bash`
- **Direct network tools** -- `nc`, `ssh`, `scp`, `rsync`, etc.
- **Command substitution** -- backticks, `$()`
- **Remote code execution** -- `eval`
- **Workspace escape** -- `cd`, `pushd`, `$HOME`, `../`, etc.

See [spec/safety.md](safety.md) for the full regex pattern list.

---

## Operations Logging

Backends MAY support pluggable operations logging for audit and debugging.

### Log Entries

Each log entry MUST include:
- Timestamp
- Operation type (exec, read, write, mkdir, etc.)
- Whether the operation succeeded
- Duration

Log entries SHOULD include (when applicable):
- The command or path involved
- User/workspace context
- stdout/stderr for exec operations
- Error details on failure

### Logging Modes

- **standard** -- Log only modifying operations (exec, write, mkdir, delete, touch).
- **verbose** -- Log all operations including reads.

---

## Adapters

### Vercel AI SDK Adapter

Implementations MAY provide an adapter for the Vercel AI SDK that wraps a backend and exposes its MCP tools in the format expected by the AI SDK.

- The adapter MUST create the appropriate MCP transport based on the backend type (stdio for local/memory, HTTP for remote).
- The adapter MUST return a Vercel AI SDK-compatible MCP client.
- The adapter's resources MUST be tracked by the backend for cleanup on destroy.
