"""Tests for RemoteFilesystemBackend.

These tests require a running agentbe-daemon Docker container.
Marked with @pytest.mark.integration.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agent_backend.backends.remote import RemoteFilesystemBackend
from agent_backend.types import (
    BackendType,
    ConnectionStatus,
    PathEscapeError,
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


class TestRemoteBackendPathResolution:
    """Unit tests for _resolve_path on RemoteFilesystemBackend."""

    def _make_backend(self, root_dir="/var/workspace"):
        config = RemoteFilesystemBackendConfig(root_dir=root_dir, host="localhost")
        return RemoteFilesystemBackend(config)

    def test_resolve_relative_path(self):
        backend = self._make_backend()
        assert backend._resolve_path("file.txt") == "/var/workspace/file.txt"
        assert backend._resolve_path("sub/dir/file.txt") == "/var/workspace/sub/dir/file.txt"

    def test_resolve_absolute_matching_root(self):
        backend = self._make_backend()
        assert backend._resolve_path("/var/workspace/file.txt") == "/var/workspace/file.txt"
        assert backend._resolve_path("/var/workspace/a/b") == "/var/workspace/a/b"

    def test_resolve_absolute_not_matching_treated_as_relative(self):
        backend = self._make_backend()
        assert backend._resolve_path("/etc/passwd") == "/var/workspace/etc/passwd"
        assert backend._resolve_path("/file.txt") == "/var/workspace/file.txt"

    def test_resolve_path_escape_raises(self):
        backend = self._make_backend()
        with pytest.raises(PathEscapeError):
            backend._resolve_path("../etc/passwd")
        with pytest.raises(PathEscapeError):
            backend._resolve_path("a/../../..")


class TestRemoteBackendFileOps:
    """Unit tests for write/mkdir/readdir/exec with mocked transport."""

    def _make_backend(self, root_dir="/var/workspace"):
        config = RemoteFilesystemBackendConfig(root_dir=root_dir, host="localhost")
        return RemoteFilesystemBackend(config)

    def _mock_transport(self, backend):
        """Inject a mocked transport and mark the backend as connected."""
        transport = MagicMock()
        transport.run = AsyncMock()
        sftp = AsyncMock()
        file_handle = AsyncMock()
        # sftp.open() is used as `async with sftp.open(...)`, NOT `await sftp.open(...)`,
        # so it must return an async context manager synchronously (not a coroutine).
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=file_handle)
        ctx.__aexit__ = AsyncMock(return_value=False)
        sftp.open = MagicMock(return_value=ctx)
        transport.get_sftp = AsyncMock(return_value=sftp)
        backend._transport = transport
        backend._status_manager.set_status(ConnectionStatus.CONNECTED)
        return transport, sftp, file_handle

    async def test_write_uses_relative_path_for_makedirs(self):
        """makedirs must receive a workspace-relative path, not an absolute one.
        The bug: absolute paths like /var/workspace/sub caused the chrooted
        SFTP server to create /var/workspace/var/workspace/sub."""
        backend = self._make_backend("/var/workspace")
        _transport, sftp, _fh = self._mock_transport(backend)

        await backend.write("sub/file.txt", "content")

        sftp.makedirs.assert_called_once_with("sub", exist_ok=True)
        sftp.open.assert_called_once_with("/var/workspace/sub/file.txt", "wb")

    async def test_write_at_root_skips_makedirs(self):
        """Writing a file directly in the workspace root should not call makedirs."""
        backend = self._make_backend("/var/workspace")
        _transport, sftp, _fh = self._mock_transport(backend)

        await backend.write("test.txt", "hello")

        sftp.makedirs.assert_not_called()
        sftp.open.assert_called_once_with("/var/workspace/test.txt", "wb")

    async def test_write_nested_path_makedirs_receives_relative_parent(self):
        backend = self._make_backend("/var/workspace")
        _transport, sftp, _fh = self._mock_transport(backend)

        await backend.write("a/b/c/file.txt", "data")

        sftp.makedirs.assert_called_once_with("a/b/c", exist_ok=True)
        sftp.open.assert_called_once_with("/var/workspace/a/b/c/file.txt", "wb")

    async def test_mkdir_recursive_uses_relative_path(self):
        backend = self._make_backend("/var/workspace")
        _transport, sftp, _ = self._mock_transport(backend)

        await backend.mkdir("sub/dir", recursive=True)

        sftp.makedirs.assert_called_once_with("sub/dir", exist_ok=True)

    async def test_readdir_passes_full_path_to_listdir(self):
        backend = self._make_backend("/var/workspace")
        _transport, sftp, _ = self._mock_transport(backend)
        sftp.listdir = AsyncMock(return_value=["a.txt", "b.txt"])

        result = await backend.readdir("subdir")

        sftp.listdir.assert_called_once_with("/var/workspace/subdir")
        assert result == ["a.txt", "b.txt"]

    async def test_exec_wraps_command_with_cd_and_home(self):
        backend = self._make_backend("/var/workspace")
        transport, _sftp, _ = self._mock_transport(backend)
        run_result = MagicMock()
        run_result.returncode = 0
        run_result.stdout = "ok"
        transport.run.return_value = run_result

        await backend.exec("echo hello")

        transport.run.assert_called_once()
        cmd = transport.run.call_args[0][0]
        assert cmd.startswith("cd /var/workspace && HOME=/var/workspace ")
        assert "echo hello" in cmd
