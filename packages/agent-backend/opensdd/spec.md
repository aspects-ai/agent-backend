# agent-backend

> Client library and server daemon providing a unified API for agent-filesystem interaction within local or remote sandboxed workspaces.

## Overview

Agent Backend is composed of three independently spec'd components. Each component spec is self-contained and defines a complete behavioral contract using [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) requirement keywords.

- **[Client Libraries](clients.md)** -- Behavioral contract for all client implementations (TypeScript, Python, etc.). Covers backend types, connection lifecycle, file operations, command execution, scoping, MCP integration, connection pooling, error handling, operations logging, and adapters.
- **[agentbe-daemon](daemon.md)** -- Behavioral contract for the server-side daemon process. Covers operating modes, configuration, HTTP/WebSocket endpoints, authentication, MCP request handling, SSH-over-WebSocket, SFTP, conventional SSH, graceful shutdown, and Docker packaging.
- **[Command Safety](safety.md)** -- Behavioral contract for command safety validation. Covers pre-processing rules, dangerous command patterns, workspace escape patterns, and response format. Referenced by both the client and daemon specs.

## Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

**Backend** -- A client-side object that provides file operations, command execution, and MCP tool access against a workspace (local directory or remote server). Implementations SHOULD define a base Backend interface that all backend types implement. Operations that only apply to file-based backends (e.g., exec) MAY be separated into a more specific interface.

**Scoped Backend** -- A backend wrapper that restricts operations to a subdirectory of the parent's workspace. Scoped backends delegate operations to their parent after translating paths. Implementations SHOULD treat scoped backends as a distinct type from the backends they wrap, since they have different lifecycle semantics (e.g., destroy does not release resources, status is delegated).

**Workspace** -- The root directory a backend operates within. All paths are relative to this root.

**Scope** -- A restricted view of a backend, rooted at a subdirectory of the parent's workspace. Used for multi-tenant isolation.

**agentbe-daemon** -- The server process that runs on a host and serves the workspace via MCP and SSH over WebSockets.

## Behavioral Contract

The full behavioral contract is defined across the three component specs linked above. Each component spec is self-contained and independently implementable.

### Client Libraries

Defines the behavioral contract for backend types (local filesystem, remote filesystem, memory), their connection lifecycle, file operations, command execution with safety validation and isolation, workspace scoping for multi-tenant isolation, MCP integration, connection pooling, error handling, operations logging, and Vercel AI SDK adapters.

Implementations MUST use idiomatic patterns for their language (e.g., Python may use `async with` for lifecycle, TypeScript may use `await destroy()`). The exact method names, parameter ordering, and error handling idioms are left to each implementation, but the semantics described in [clients.md](clients.md) MUST be preserved.

See the complete [Client Libraries spec](clients.md).

### agentbe-daemon

Defines the behavioral contract for the daemon's two operating modes (full HTTP server and local-only stdio), CLI configuration, HTTP and WebSocket endpoints, bearer token authentication, per-request MCP handling with dynamic scoping, SSH-over-WebSocket transport with SFTP path jailing, optional conventional SSH, graceful shutdown ordering, and Docker image packaging.

The exact framework or runtime (Express, Fastify, etc.) is an implementation detail left to each language. Implementations MUST conform to the semantics described in [daemon.md](daemon.md).

See the complete [agentbe-daemon spec](daemon.md).

### Command Safety

Defines the pre-processing rules (lowercase normalization, heredoc stripping, allowlist), the complete list of dangerous command regex patterns (destructive operations, privilege escalation, pipe-to-shell, network tools, command substitution, etc.), workspace escape patterns, and the required response format when a command is blocked.

Both the [Client Libraries](clients.md) and [agentbe-daemon](daemon.md) specs reference this document for command safety enforcement. See the complete [Command Safety spec](safety.md).

## NOT Specified (Implementation Freedom)

- Programming language for implementations (TypeScript and Python exist today; others may follow)
- Exact method names, parameter ordering, and error handling idioms (language-idiomatic patterns are preferred)
- Internal data structures and algorithms
- Caching strategies
- Logging implementation details beyond the specified log entry format
- Test framework and test runner
- CI/CD pipeline configuration
- Package manager choice
- HTTP framework for the daemon (Express, Fastify, etc.)

## Invariants

- All file operations MUST be confined to the workspace root directory (path jailing)
- Scoped backends MUST NOT access paths outside their scope, even if valid within the parent workspace
- Backend status MUST follow the defined state machine transitions and MUST NOT skip states
- Destroying a backend MUST release all associated resources
- MCP tool names and schemas MUST match the official MCP Filesystem Server
- Command safety validation MUST occur before command execution when dangerous command blocking is enabled
- All RFC 2119 keywords in component specs are binding requirements
