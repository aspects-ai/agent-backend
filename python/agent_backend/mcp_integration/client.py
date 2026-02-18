"""MCP client creation utilities."""

from __future__ import annotations

from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client


async def create_mcp_client(
    backend_type: str,
    root_dir: str,
    isolation: str | None = None,
    shell: str | None = None,
) -> Any:
    """Create an MCP client for local/memory backends.

    Spawns agent-backend CLI as a subprocess.
    """
    if backend_type == "local":
        args = ["daemon", "--rootDir", root_dir, "--local-only"]
        if isolation:
            args.extend(["--isolation", isolation])
        if shell:
            args.extend(["--shell", shell])
    else:
        args = ["--backend", "memory", "--rootDir", root_dir]

    server_params = StdioServerParameters(command="agent-backend", args=args)
    read_stream, write_stream = await stdio_client(server_params).__aenter__()
    session = ClientSession(read_stream, write_stream)
    await session.__aenter__()
    await session.initialize()
    return session


async def create_remote_mcp_client(
    url: str,
    auth_token: str,
    root_dir: str,
    scope_path: str | None = None,
    connection_timeout_ms: int = 10000,
) -> Any:
    """Create an MCP client for remote backends via HTTP."""
    headers = {
        "Authorization": f"Bearer {auth_token}",
        "X-Root-Dir": root_dir,
    }
    if scope_path:
        headers["X-Scope-Path"] = scope_path

    mcp_url = f"{url}/mcp"

    read_stream, write_stream, _ = await streamablehttp_client(
        mcp_url, headers=headers
    ).__aenter__()
    session = ClientSession(read_stream, write_stream)
    await session.__aenter__()
    await session.initialize()
    return session


def create_http_transport(
    url: str,
    auth_token: str,
    root_dir: str,
    scope_path: str | None = None,
) -> Any:
    """Create an HTTP transport for remote MCP connections."""

    class _HttpTransportWrapper:
        def __init__(self) -> None:
            self.url = url
            self.auth_token = auth_token
            self.root_dir = root_dir
            self.scope_path = scope_path

        async def close(self) -> None:
            pass

    return _HttpTransportWrapper()
