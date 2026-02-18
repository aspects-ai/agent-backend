"""Vercel AI SDK adapter.

Wraps a backend and exposes its MCP tools in the format expected by the AI SDK.
"""

from __future__ import annotations

from typing import Any
from mcp.client.streamable_http import streamablehttp_client


class VercelAIAdapter:
    """Adapter for creating Vercel AI SDK MCP clients from agent-backend backends.

    Wraps a backend and provides a simple interface to get
    a Vercel AI SDK MCP client with tools ready for use.
    """

    def __init__(
        self,
        backend: Any,
        *,
        connection_timeout_ms: int = 15000,
    ) -> None:
        self._backend = backend
        self._connection_timeout_ms = connection_timeout_ms

    async def get_mcp_client(self) -> Any:
        """Get a Vercel AI SDK-compatible MCP client.

        Returns:
            MCP client with tools ready for use.

        Raises:
            TimeoutError: If connection times out.
        """
        import asyncio

        transport = await self._backend.get_mcp_transport()

        try:
            client = await asyncio.wait_for(
                self._create_client(transport),
                timeout=self._connection_timeout_ms / 1000.0,
            )
            self._backend.track_closeable(client)
            return client
        except TimeoutError as e:
            raise TimeoutError(
                f"MCP client connection timed out after {self._connection_timeout_ms}ms. "
                "Check that agent-backend CLI is available in PATH."
            ) from e

    async def _create_client(self, transport: Any) -> Any:
        """Create the MCP client from transport."""
        from mcp import ClientSession
        from mcp.client.stdio import stdio_client

        # If it's a stdio wrapper, use stdio_client
        if hasattr(transport, "params"):
            read_stream, write_stream = await stdio_client(transport.params).__aenter__()
            session = ClientSession(read_stream, write_stream)
            await session.__aenter__()
            await session.initialize()
            return session

        # For HTTP transports, use streamable HTTP
        if hasattr(transport, "url"):
            headers = {"Authorization": f"Bearer {transport.auth_token}"}
            if transport.root_dir:
                headers["X-Root-Dir"] = transport.root_dir
            if transport.scope_path:
                headers["X-Scope-Path"] = transport.scope_path

            read_stream, write_stream, _ = await streamablehttp_client(
                f"{transport.url}/mcp", headers=headers
            ).__aenter__()
            session = ClientSession(read_stream, write_stream)
            await session.__aenter__()
            await session.initialize()
            return session

        raise ValueError(f"Unsupported transport type: {type(transport)}")
