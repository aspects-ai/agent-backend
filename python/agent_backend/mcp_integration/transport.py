"""MCP transport factory.

Creates the appropriate MCP transport based on backend type:
- LocalFilesystemBackend -> StdioServerTransport (spawns subprocess)
- RemoteFilesystemBackend -> StreamableHTTPClientTransport (HTTP)
- MemoryBackend -> StdioServerTransport (spawns subprocess)
"""

from __future__ import annotations

from typing import Any

from agent_backend.types import BackendType


async def create_backend_mcp_transport(
    backend: Any,
    scope_path: str | None = None,
) -> Any:
    """Create an MCP transport for a backend.

    Transport type depends on backend type:
    - local-filesystem -> stdio (spawns agent-backend daemon subprocess)
    - remote-filesystem -> HTTP
    - memory -> stdio (spawns agent-backend daemon subprocess)
    """
    from mcp.client.stdio import StdioServerParameters

    backend_type = backend.type

    if backend_type == BackendType.LOCAL_FILESYSTEM:
        root_dir = backend.root_dir
        effective_root = f"{root_dir}/{scope_path}" if scope_path else root_dir

        args = ["daemon", "--rootDir", effective_root, "--local-only"]

        isolation = getattr(backend, "_isolation", None)
        if isolation:
            args.extend(["--isolation", str(isolation)])

        shell = getattr(backend, "_shell", None)
        if shell:
            args.extend(["--shell", str(shell)])

        params = StdioServerParameters(command="agent-backend", args=args)
        return _StdioTransportWrapper(params)

    elif backend_type == BackendType.REMOTE_FILESYSTEM:
        config = backend.config
        mcp_host = config.mcp_server_host_override or config.host
        mcp_port = config.mcp_port or 3001
        root_dir = backend.root_dir

        from agent_backend.mcp_integration.client import create_http_transport

        return create_http_transport(
            url=f"http://{mcp_host}:{mcp_port}",
            auth_token=config.auth_token or "",
            root_dir=root_dir,
            scope_path=scope_path,
        )

    elif backend_type == BackendType.MEMORY:
        root_dir = backend.root_dir
        effective_root = f"{root_dir}/{scope_path}" if scope_path else root_dir

        args = ["--backend", "memory", "--rootDir", effective_root]

        params = StdioServerParameters(command="agent-backend", args=args)
        return _StdioTransportWrapper(params)

    else:
        from agent_backend.types import BackendError, ErrorCode

        raise BackendError(
            f"Unsupported backend type: {backend_type}",
            ErrorCode.INVALID_CONFIGURATION,
            "unsupported-backend-type",
        )


class _StdioTransportWrapper:
    """Wraps StdioServerParameters for deferred connection."""

    def __init__(self, params: Any) -> None:
        self.params = params
        self._process: Any = None

    async def close(self) -> None:
        if self._process:
            try:
                self._process.terminate()
            except Exception:
                pass
