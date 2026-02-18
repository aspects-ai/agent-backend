"""Tests for RemoteFilesystemBackend.

These tests require a running agentbe-daemon Docker container.
Marked with @pytest.mark.integration.
"""

from __future__ import annotations

import pytest

from agent_backend.backends.remote import RemoteFilesystemBackend
from agent_backend.types import (
    BackendType,
    ConnectionStatus,
    RemoteFilesystemBackendConfig,
)


@pytest.mark.integration
class TestRemoteFilesystemBackend:
    @pytest.fixture
    def remote_config(self):
        return RemoteFilesystemBackendConfig(
            root_dir="/workspace",
            host="localhost",
            auth_token="test-token",
            port=3001,
        )

    def test_init(self, remote_config):
        backend = RemoteFilesystemBackend(remote_config)
        assert backend.type == BackendType.REMOTE_FILESYSTEM
        assert backend.status == ConnectionStatus.DISCONNECTED
        assert backend.root_dir == "/workspace"


class TestRemoteBackendUnit:
    """Unit tests that don't require a running server."""

    def test_initial_status(self):
        config = RemoteFilesystemBackendConfig(
            root_dir="/workspace",
            host="localhost",
        )
        backend = RemoteFilesystemBackend(config)
        assert backend.status == ConnectionStatus.DISCONNECTED

    async def test_destroy(self):
        config = RemoteFilesystemBackendConfig(
            root_dir="/workspace",
            host="localhost",
        )
        backend = RemoteFilesystemBackend(config)
        await backend.destroy()
        assert backend.status == ConnectionStatus.DESTROYED

    def test_status_change_callback(self):
        config = RemoteFilesystemBackendConfig(
            root_dir="/workspace",
            host="localhost",
        )
        backend = RemoteFilesystemBackend(config)
        events = []
        backend.on_status_change(lambda e: events.append(e))
        # Manually trigger destroy to test callback
        import asyncio

        asyncio.get_event_loop().run_until_complete(backend.destroy())
        assert len(events) == 1
        assert events[0].to_status == ConnectionStatus.DESTROYED
