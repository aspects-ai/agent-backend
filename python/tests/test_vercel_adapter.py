"""Tests for Vercel AI SDK adapter."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from agent_backend.adapters.vercel import VercelAIAdapter


class TestVercelAIAdapter:
    def test_init_defaults(self):
        backend = AsyncMock()
        adapter = VercelAIAdapter(backend)
        assert adapter._connection_timeout_ms == 15000

    def test_init_custom_timeout(self):
        backend = AsyncMock()
        adapter = VercelAIAdapter(backend, connection_timeout_ms=5000)
        assert adapter._connection_timeout_ms == 5000

    async def test_get_mcp_client_timeout(self):
        """Test that timeout is properly raised."""
        backend = AsyncMock()
        backend.get_mcp_transport = AsyncMock(return_value=None)

        adapter = VercelAIAdapter(backend, connection_timeout_ms=50)

        # Patch _create_client to sleep forever
        async def slow_create(transport):
            await asyncio.sleep(100)

        with patch.object(adapter, "_create_client", side_effect=slow_create), \
             pytest.raises(TimeoutError, match="timed out"):
            await adapter.get_mcp_client()

    async def test_get_mcp_client_unsupported_transport(self):
        """Test ValueError for unsupported transport type."""
        backend = AsyncMock()
        backend.get_mcp_transport = AsyncMock(return_value="not-a-real-transport")

        adapter = VercelAIAdapter(backend)
        with pytest.raises(ValueError, match="Unsupported transport type"):
            await adapter.get_mcp_client()

    async def test_get_mcp_client_tracks_closeable(self):
        """Test that client is tracked as closeable on success."""
        backend = AsyncMock()
        backend.get_mcp_transport = AsyncMock(return_value=None)

        fake_client = AsyncMock()
        adapter = VercelAIAdapter(backend)

        async def fake_create(transport):
            return fake_client

        with patch.object(adapter, "_create_client", side_effect=fake_create):
            client = await adapter.get_mcp_client()

        assert client is fake_client
        backend.track_closeable.assert_called_once_with(fake_client)
