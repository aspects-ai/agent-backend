# agentbe-daemon

> Behavioral contract for the agentbe-daemon server process -- endpoints, authentication, transports, scoping, request handling, shutdown, and Docker packaging.

### Daemon-Specific Terminology

**daemon** -- The long-running server process (`agentbe-daemon`) that exposes a workspace over HTTP (MCP) and WebSocket (SSH). Referred to as "the daemon" throughout this document.

**transport** -- A communication channel between clients and the daemon. The daemon supports three transports: stdio (local-only), HTTP (MCP), and WebSocket (SSH).

**host key** -- The SSH host key used by the ephemeral SSH server for SSH-over-WebSocket connections.

**static scope** -- A scope path fixed at daemon startup via CLI argument. All requests inherit this scope.

**dynamic scope** -- A scope path provided per-request via HTTP header. Allows each request to target a different sub-directory.

---

## Operating Modes

The daemon MUST support two operating modes:

### Full Mode (default)

Starts an HTTP server that serves:
- The MCP endpoint (`POST /mcp`)
- The health endpoint (`GET /health`)
- Optionally, the SSH-over-WebSocket endpoint (`WS /ssh`)
- Optionally, a conventional SSH daemon (sshd)

### Local-Only Mode

Runs an MCP server over stdio with no network listeners. The daemon reads MCP requests from stdin and writes responses to stdout.

- MUST NOT start an HTTP server.
- MUST NOT start any SSH transport.
- MUST create a backend from the configured root directory, optionally scoped.
- MUST NOT enable dangerous command blocking (`preventDangerous`). Local-only mode trusts the local user; only full daemon mode requires command safety enforcement.
- MUST connect the MCP server to a stdio transport.

---

## Configuration

### CLI Arguments

The daemon MUST be invoked via the `daemon` subcommand: `agent-backend daemon <flags>`. The entrypoint MUST strip the `daemon` subcommand before parsing flags.

All flags use `--kebab-case` with a space separator for the value.

| Flag | Type | Default | Required | Description |
|------|------|---------|----------|-------------|
| `--rootDir <path>` | string | none | **Yes** | Workspace root directory |
| `--scopePath <path>` | string | none | No | Static scope path within rootDir |
| `--isolation <mode>` | enum | `auto` | No | Isolation mode: `auto`, `bwrap`, `software`, `none` |
| `--shell <shell>` | enum | `auto` | No | Shell preference: `bash`, `sh`, `auto` |
| `--port <port>` | integer | `3001` | No | HTTP/WebSocket server port |
| `--auth-token <token>` | string | none | No | Bearer token for authentication |
| `--local-only` | boolean | `false` | No | Run MCP server via stdio only |
| `--disable-ssh-ws` | boolean | `false` | No | Disable SSH-over-WebSocket endpoint |
| `--ssh-host-key <path>` | string | none | No | Path to SSH host key file |
| `--conventional-ssh` | boolean | `false` | No | Enable conventional SSH daemon |
| `--ssh-port <port>` | integer | `22` | No | Conventional SSH port |
| `--ssh-users <users>` | string | `root:agents` | No | Comma-separated `user:pass` pairs |
| `--ssh-public-key <key>` | string | none | No | SSH public key for first user |
| `--ssh-authorized-keys <path>` | string | none | No | Path to authorized_keys file for first user |

### Validation Rules

- `--rootDir` MUST be provided. The daemon MUST exit with code 1 if it is missing.
- `--port` MUST be between 1024 and 65535 inclusive.
- `--ssh-port` MUST be between 1 and 65535 inclusive.
- `--isolation` MUST be one of `auto`, `bwrap`, `software`, `none`. The daemon MUST exit with code 1 on an invalid value.
- `--shell` MUST be one of `bash`, `sh`, `auto`. The daemon MUST exit with code 1 on an invalid value.
- `--ssh-users` MUST follow the format `user:pass[,user:pass,...]`. The daemon MUST reject entries with a missing user or password.
- Unrecognized `--` flags MUST cause the daemon to exit with code 1.

### Environment Variables (Docker)

The Docker entrypoint translates the following environment variables to CLI arguments. The daemon itself does not read these directly — they are a Docker-layer convention.

| Variable | Maps to | Default |
|----------|---------|---------|
| `WORKSPACE_ROOT` | `--rootDir` | `/var/workspace` |
| `PORT` | `--port` | `3001` |
| `AUTH_TOKEN` | `--auth-token` | none |
| `SSH_HOST_KEY` | `--ssh-host-key` | none |
| `SHELL_TYPE` | `--shell` | none (auto) |
| `DISABLE_SSH_WS` | `--disable-ssh-ws` | `false` |
| `CONVENTIONAL_SSH` | `--conventional-ssh` | `false` |
| `SSH_PORT` | `--ssh-port` | `22` |
| `SSH_USERS` | `--ssh-users` | `root:agents` |
| `SSH_PUBLIC_KEY` | `--ssh-public-key` | none |
| `USE_LOCAL_BUILD` | (triggers dev hot-reload) | `0` |

The entrypoint MUST also check for `/keys/authorized_keys` and pass it as `--ssh-authorized-keys` if it exists.

---

## Endpoints

### `GET /health`

Health check endpoint. MUST NOT require authentication.

**Response:** HTTP 200 with JSON body:

```json
{
  "status": "ok",
  "version": "<package version>",
  "rootDir": "<configured rootDir>",
  "transports": {
    "mcp": true,
    "ssh-ws": <boolean>,
    "ssh": <boolean>
  }
}
```

- `transports.mcp` MUST always be `true`.
- `transports.ssh-ws` MUST be `true` unless SSH-over-WebSocket is disabled.
- `transports.ssh` MUST be `true` only when conventional SSH is enabled.

### `POST /mcp`

MCP (Model Context Protocol) endpoint. Handles tool calls against the workspace.

**Authentication:** See [Authentication](#authentication).

**Request headers:**
- `Authorization` — Bearer token (when auth is configured).
- `X-Root-Dir` — Optional. If present and not the string `'undefined'`, the daemon MUST verify it matches the configured `rootDir` exactly. On mismatch, the daemon MUST respond with HTTP 403:
  ```json
  {
    "error": "Root directory mismatch",
    "message": "Server is configured for <rootDir>, not <requested>"
  }
  ```
- `X-Scope-Path` — Optional. Dynamic scope path for this request. See [MCP Request Handling](#mcp-request-handling).

**MCP processing:** Each request MUST be handled by a fresh MCP server and transport instance. See [MCP Request Handling](#mcp-request-handling).

### `WS /ssh`

SSH-over-WebSocket endpoint. Upgrades HTTP connections to WebSocket for SSH transport.

**Path:** `/ssh`

**Authentication:** See [Authentication](#authentication). Authentication MUST occur during the WebSocket `connection` event, before SSH negotiation.

On authentication failure, the daemon MUST close the WebSocket with code `4001` and reason `"Unauthorized"`.

See [SSH-over-WebSocket](#ssh-over-websocket) for full transport details.

---

## Authentication

### Bearer Token Scheme

When an auth token is configured (`--auth-token`), the daemon MUST enforce authentication on the `/mcp` and `/ssh` endpoints. The `/health` endpoint MUST NOT require authentication.

When no auth token is configured, all requests MUST be accepted without authentication.

### MCP Endpoint Authentication

The daemon MUST check the `Authorization` header for the value `Bearer <token>`. The comparison MUST be an exact string match.

On failure, the daemon MUST respond with HTTP 401:
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing authentication token"
}
```

### SSH-over-WebSocket Authentication

The daemon MUST check for the token in two locations, in order:
1. Query parameter: `/ssh?token=<token>`
2. `Authorization` header: `Bearer <token>`

If either matches, authentication succeeds. On failure, the daemon MUST close the WebSocket with code `4001` and reason `"Unauthorized"`.

---

## MCP Request Handling

### Per-Request Backend

Each `POST /mcp` request MUST be handled with its own MCP server and transport instance. The daemon MUST NOT maintain server-side session state between requests.

### Scoping

The daemon supports two scoping mechanisms:

**Static scope** (`--scopePath`): Fixed at startup. All requests inherit this scope path.

**Dynamic scope** (`X-Scope-Path` header): Per-request scope path.

**Conflict handling:** If the daemon was started with a static scope AND the request also provides a dynamic scope, the daemon MUST respond with HTTP 400:
```json
{
  "error": "Scope conflict",
  "message": "Server was started with static scope '<static>', but request also specified scope '<dynamic>'. Use one or the other, not both."
}
```

### Scope Path Validation

The effective scope path (from either source) MUST be validated:
1. Leading slashes MUST be stripped.
2. `..` sequences MUST be rejected. If the scope path contains `..` or normalizing it changes the value, the daemon MUST respond with HTTP 400:
   ```json
   {
     "error": "Invalid scope path",
     "message": "Scope path must not contain path traversal sequences"
   }
   ```

### Backend Construction

In full daemon mode, the backend MUST be constructed with dangerous command blocking enabled (`preventDangerous: true`).

If a valid scope path is present, the daemon MUST create a scoped backend from the base backend using the normalized scope path.

### MCP Server Tools

The daemon MUST register the tools defined by the [official MCP Filesystem Server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem). Tool names, input schemas, and output formats MUST match the official filesystem MCP server exactly.

At time of writing, the official filesystem MCP server provides the following tools:

| Tool | Description |
|------|-------------|
| `read_text_file` | Read file contents as text (with optional `head`/`tail` line limits) |
| `read_media_file` | Read an image or audio file as base64 |
| `read_multiple_files` | Read multiple files simultaneously |
| `write_file` | Create new file or overwrite existing |
| `edit_file` | Selective edits using `edits: [{ oldText, newText }]` with optional `dryRun` |
| `create_directory` | Create new directory or ensure it exists |
| `list_directory` | List directory contents with `[FILE]`/`[DIR]` prefixes |
| `list_directory_with_sizes` | List directory contents including file sizes, with optional `sortBy` |
| `directory_tree` | Recursive JSON tree structure with optional `excludePatterns` |
| `move_file` | Move or rename files and directories |
| `search_files` | Recursively search for files matching glob patterns, with optional `excludePatterns` |
| `get_file_info` | Get detailed file/directory metadata |
| `list_allowed_directories` | List the workspace boundary (allowed directories) |

In addition to the official filesystem tools, the daemon MUST register the following tool when the backend supports command execution:

| Tool | Description |
|------|-------------|
| `exec` | Execute a shell command. Parameters: `command` (string, required), `env` (object, optional). |

---

## SSH-over-WebSocket

### WebSocket Upgrade

The daemon MUST listen for WebSocket upgrade requests at the `/ssh` path.

If `--disable-ssh-ws` is set, the daemon MUST NOT create the WebSocket server.

### Duplex Stream Bridging

The daemon MUST create a duplex stream from each WebSocket connection to bridge with the SSH server:

- Writes to the duplex MUST send data via `ws.send()`. If the WebSocket is not in the OPEN state, writes MUST fail with an error.
- Incoming WebSocket messages MUST be pushed into the readable side of the duplex as Buffers.
- WebSocket `close` MUST push EOF (null) to the readable side.
- WebSocket `error` MUST destroy the duplex stream.
- Calling `final()` on the duplex MUST close the WebSocket with code 1000.
- Calling `destroy()` on the duplex MUST close the WebSocket with code 1011.

The duplex stream MUST be injected into an SSH server instance for protocol handling.

### SSH Server Per Connection

Each WebSocket connection MUST get its own ephemeral SSH server instance. When the WebSocket closes, the SSH server for that connection is torn down.

### SSH Authentication Passthrough

Once WebSocket-level authentication succeeds, the SSH server MUST accept all SSH authentication methods (password, publickey, none). The rationale is that transport-level token authentication has already been performed.

### Host Key Management

The daemon MUST support loading an SSH host key from a file (`--ssh-host-key`) or auto-generating one.

- **Default path:** `/var/lib/agentbe/ssh_host_ed25519_key`
- **Key algorithm:** RSA (2048-bit). The key MUST be generated via `generateKeyPairSync('rsa', { modulusLength: 2048 })` (or equivalent) with PKCS#1 PEM encoding.
- If the file at the configured (or default) path exists, the daemon MUST read and use it.
- If the file does not exist, the daemon MUST generate a new RSA key pair and attempt to save it for reuse.
- If the directory cannot be created or the file cannot be written, the daemon MUST use the generated key ephemerally (in-memory only, not persisted). This MUST NOT be a fatal error.

### Session Types

The SSH server MUST handle the following session types:

#### PTY Requests

The daemon MUST accept PTY requests and store the terminal information (term type, columns, rows) for use by subsequent shell or exec requests.

#### Shell Sessions

When a shell session is requested:
- The daemon SHOULD attempt to use a PTY-capable spawner (e.g., `node-pty`) if available, for proper terminal emulation.
- If PTY support is unavailable, the daemon MUST fall back to executing the resolved shell as a command.
- Default terminal type: `xterm-256color`. Default dimensions: 80 columns, 24 rows.

#### Exec Sessions

When a command exec is requested:
- The daemon MUST spawn the command via the resolved shell with `-c` flag.
- Working directory MUST be set to the workspace root (or scoped root).
- Environment MUST include `HOME`, `PWD` (set to the working directory), and `TERM=xterm-256color`.
- The exit code MUST be sent via the SSH channel's exit method.
- On spawn failure, the daemon MUST write the error to stderr on the channel and exit with code 1.

#### Window Change

The daemon MUST handle `window-change` session events. These events indicate a PTY resize. The daemon MUST accept the event (call `accept()` if provided). Implementations SHOULD propagate the new dimensions to the active PTY process if one is tracked.

#### SFTP Sessions

The daemon MUST support SFTP sessions. See [SFTP Path Jailing](#sftp-path-jailing).

### Shell Resolution

The daemon MUST resolve the shell to use:
- `'bash'` → `/bin/bash`
- `'sh'` → `/bin/sh`
- `'auto'` or unset → prefer `/bin/bash` if it exists, fall back to `/bin/sh`

---

## SFTP Path Jailing

All SFTP operations MUST be confined to the workspace root directory.

### Path Resolution

For every SFTP operation, the daemon MUST resolve paths as follows:
1. Normalize the workspace root via an absolute path resolve.
2. If the requested path already starts with the normalized root (followed by `/` or is equal), use it directly.
3. Otherwise, strip leading slashes and resolve relative to the workspace root.
4. After resolution, verify the resolved path starts with the normalized root (followed by `/` or is equal). If not, the operation MUST fail with a path escape error.

### Supported SFTP Operations

The daemon MUST implement the following SFTP operations:

| Operation | Notes |
|-----------|-------|
| OPEN | Auto-create parent directories for write operations. Default file mode: `0o644`. SFTP open flags MUST be translated to OS-level flags (e.g., `SSH2_FXF_READ` → `O_RDONLY`, `SSH2_FXF_WRITE` → `O_WRONLY`, `SSH2_FXF_CREAT` → `O_CREAT`, `SSH2_FXF_TRUNC` → `O_TRUNC`, `SSH2_FXF_EXCL` → `O_EXCL`, `SSH2_FXF_APPEND` → `O_APPEND`). Flags MUST be combined bitwise. |
| READ | Return `EOF` status when zero bytes are read. |
| WRITE | Write at specified offset. |
| CLOSE | Close file handle and free the handle ID. |
| FSTAT | Stat an open file handle. |
| OPENDIR | Read directory entries into memory. |
| READDIR | Return entries in batches. Return `EOF` status when exhausted. |
| STAT | Stat a path (follows symlinks). |
| LSTAT | Stat a path (does not follow symlinks). |
| REALPATH | Return the resolved path relative to the workspace root, presented to the client as an absolute path from `/`. |
| MKDIR | Default mode: `0o755`. |
| RMDIR | Remove an empty directory. |
| REMOVE | Delete a file. |
| RENAME | Auto-create parent directory of destination. Both paths MUST be validated within the workspace root. |
| SETSTAT | Support chmod. Chown and utimes MAY silently ignore errors. |
| FSETSTAT | Same as SETSTAT but on an open file handle. |

### Error Mapping

SFTP errors MUST be mapped from OS error codes:
- `ENOENT` → `NO_SUCH_FILE`
- `EACCES` → `PERMISSION_DENIED`
- All other errors → `FAILURE`

---

## Conventional SSH (Opt-In)

The daemon MAY support running a conventional SSH daemon (sshd) alongside the HTTP server.

### Platform Requirements

- `--conventional-ssh` MUST require Linux (`process.platform === 'linux'`). The daemon MUST exit with code 1 on other platforms.
- `--conventional-ssh` SHOULD require root privileges. The daemon SHOULD print a warning if not running as root.
- The daemon MUST verify `/usr/sbin/sshd` exists. If missing, the daemon MUST exit with code 1.

### User Setup

When conventional SSH is enabled, the daemon MUST:
1. Create Linux users from the `--ssh-users` list using `useradd -m -s /bin/bash`.
2. Set passwords via `chpasswd`.
3. Create `.ssh` directories with mode `700` and `authorized_keys` files with mode `600`.
4. Apply `--ssh-public-key` and `--ssh-authorized-keys` to the first user only.
5. Enable password authentication via an sshd configuration drop-in file.

### sshd Process

The daemon MUST spawn sshd with `-D` (foreground) and `-e` (log to stderr) flags on the configured port.

If sshd exits unexpectedly, the daemon MUST close the HTTP server and exit with code 1.

---

## Graceful Shutdown

The daemon MUST handle `SIGTERM` and `SIGINT` for graceful shutdown.

### Close Ordering

On receiving a shutdown signal, the daemon MUST close resources in the following order:

1. **SSH-over-WebSocket server** — Close all active WebSocket clients with code 1000 and reason `"Server shutting down"`, then close the WebSocket server.
2. **HTTP server** — Stop accepting new connections and close the HTTP server.
3. **Conventional sshd** (if running) — Send `SIGTERM` to the sshd process and wait for it to exit.
4. **Exit** — Exit the process with code 0.

---

## Docker Image

### Base Image

The Docker image MUST use `ubuntu:22.04` as the base image.

### Build Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `INCLUDE_SSHD` | `true` | Include openssh-server |
| `AGENTBE_VERSION` | `local` | Package version or `local` for local build |

### Installed Tooling

The image MUST include:
- `sudo`, `curl`, `wget`, `tree`, `ripgrep`, `git`
- `python3`, `python3-pip`
- Node.js 20 (via nodesource)
- `pnpm`, `tsx` (global npm packages)
- `agent-backend` (from npm or local build)
- `openssh-server` (when `INCLUDE_SSHD=true`)

### Build-Time SSH Configuration

When `INCLUDE_SSHD=true`, the image MUST configure sshd at build time:

1. Create `/var/run/sshd` and `/run/sshd` directories.
2. Generate SSH host keys (`ssh-keygen -A`).
3. Modify `/etc/ssh/sshd_config`:
   - `PermitRootLogin yes`
   - `PasswordAuthentication yes`
   - `PubkeyAuthentication yes`
   - `ListenAddress 0.0.0.0`
4. Create an sshd config drop-in file (`/etc/ssh/sshd_config.d/agentbe.conf`) with:
   - `PasswordAuthentication yes`
   - `PermitRootLogin yes`
   - `ChallengeResponseAuthentication yes`
   - `MaxSessions 64`
   - `MaxStartups 10:30:100`
   - `ClientAliveInterval 60`
   - `ClientAliveCountMax 3`
5. Configure PAM: change `pam_loginuid.so` from `required` to `optional` in `/etc/pam.d/sshd`.
6. Create `/root/.ssh` (mode `700`) with an empty `authorized_keys` file (mode `600`).
7. Set the default root password (`root:agents`) via `chpasswd`.

### Workspace Directory

The image MUST create `/var/workspace` with mode `755`, owned by `root:root`.

### Exposed Ports

- `3001` — MCP + SSH-over-WebSocket
- `22` — Conventional SSH

### Health Check

The image MUST define a health check:
- Command: `curl -f http://localhost:${PORT:-3001}/health`
- Interval: 30 seconds
- Timeout: 10 seconds
- Start period: 5 seconds
- Retries: 3

### Entrypoint Behavior

The entrypoint script (`/docker-entrypoint.sh`) MUST:

1. If invoked as `agent-backend daemon`:
   a. Strip the `agent-backend daemon` prefix (`shift 2`) so remaining args can be passed through.
   b. Create the `WORKSPACE_ROOT` directory (default `/var/workspace`) with mode `755`.
   c. Run all executable `*.sh` scripts in `/docker-entrypoint.d/`, sorted by version sort. Non-executable `.sh` files and non-`.sh` files SHOULD be logged as ignored.
   d. Translate environment variables to CLI arguments. Arguments MUST be stored in a bash array (not a string) to safely handle values containing spaces.
   e. Change to `WORKSPACE_ROOT`.
   f. Execute the daemon via `exec` so the daemon process replaces the shell and becomes PID 1 in the container. This is critical for proper signal handling (SIGTERM, SIGINT). Any remaining positional args (`"$@"`) MUST be appended to allow Docker CMD overrides to pass additional flags.
2. For any other command, execute it directly via `exec "$@"`.

The entrypoint MUST use `set -e` (fail on any error).

### Extension Points

The image MUST support three extension mechanisms:

1. **`FROM` + `RUN`** — Extend the image with additional packages via a downstream Dockerfile.
2. **`/docker-entrypoint.d/*.sh`** — Drop-in init scripts executed at container startup before the daemon starts.
3. **`CMD` override** — Replace the default command entirely.

### Dev Hot-Reload

When `USE_LOCAL_BUILD=1` and the local source directory exists at `/app/agent-backend/src`, the entrypoint MUST use `tsx --watch` to run the daemon from source with automatic restart on file changes.

---

## Security Considerations

### Path Jailing

All file operations — whether via MCP tools, SFTP, or shell execution — MUST be confined to the workspace root directory. Path traversal attempts (`..`) MUST be detected and rejected at every layer (MCP scope validation, SFTP path resolution, backend path resolution).

### Command Isolation

In full daemon mode, the backend MUST be configured with dangerous command blocking enabled. The daemon delegates command safety enforcement to the backend layer (see [Command Safety](safety.md) for the full list of blocked patterns).

### Authentication Token Recommendations

- Deployments exposed to the network SHOULD configure an auth token.
- Auth tokens SHOULD be generated with sufficient entropy (e.g., 256-bit random).
- Tokens are compared via exact string match. Implementations SHOULD use constant-time comparison to prevent timing attacks.

### SSH Host Key Stability

For production deployments, operators SHOULD provide a persistent host key via `--ssh-host-key` to prevent host key mismatch warnings on client reconnection. Auto-generated keys are ephemeral when the file cannot be persisted, meaning clients will see a different host key each time the daemon restarts.
