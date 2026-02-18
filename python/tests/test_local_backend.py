"""Tests for LocalFilesystemBackend."""

from __future__ import annotations

import os

import pytest

from agent_backend.backends.local import LocalFilesystemBackend
from agent_backend.types import (
    BackendError,
    BackendType,
    ConnectionStatus,
    DangerousOperationError,
    ErrorCode,
    ExecOptions,
    IsolationMode,
    LocalFilesystemBackendConfig,
    PathEscapeError,
    ReadOptions,
)


class TestLocalBackendInit:
    def test_creates_root_dir(self, tmp_path):
        root = str(tmp_path / "new_workspace")
        config = LocalFilesystemBackendConfig(root_dir=root)
        backend = LocalFilesystemBackend(config)
        assert os.path.isdir(root)
        assert backend.status == ConnectionStatus.CONNECTED
        assert backend.type == BackendType.LOCAL_FILESYSTEM

    def test_resolve_root_dir(self, tmp_workspace):
        config = LocalFilesystemBackendConfig(root_dir=tmp_workspace)
        backend = LocalFilesystemBackend(config)
        assert backend.root_dir == os.path.abspath(tmp_workspace)


class TestLocalBackendFileOps:
    async def test_write_and_read(self, local_backend, tmp_workspace):
        await local_backend.write("test.txt", "hello world")
        result = await local_backend.read("test.txt")
        assert result == "hello world"

    async def test_write_creates_parent_dirs(self, local_backend):
        await local_backend.write("deep/nested/file.txt", "content")
        result = await local_backend.read("deep/nested/file.txt")
        assert result == "content"

    async def test_write_bytes(self, local_backend):
        await local_backend.write("binary.bin", b"\x00\x01\x02")
        result = await local_backend.read("binary.bin", ReadOptions(encoding="buffer"))
        assert result == b"\x00\x01\x02"

    async def test_read_nonexistent(self, local_backend):
        with pytest.raises(BackendError) as exc_info:
            await local_backend.read("nonexistent.txt")
        assert exc_info.value.code == ErrorCode.READ_FAILED

    async def test_read_buffer(self, local_backend):
        await local_backend.write("buf.txt", "hello")
        result = await local_backend.read("buf.txt", ReadOptions(encoding="buffer"))
        assert result == b"hello"

    async def test_rename(self, local_backend):
        await local_backend.write("old.txt", "content")
        await local_backend.rename("old.txt", "new.txt")
        assert await local_backend.exists("new.txt")
        assert not await local_backend.exists("old.txt")

    async def test_rm_file(self, local_backend):
        await local_backend.write("delete_me.txt", "gone")
        await local_backend.rm("delete_me.txt")
        assert not await local_backend.exists("delete_me.txt")

    async def test_rm_dir_recursive(self, local_backend):
        await local_backend.write("dir/file.txt", "content")
        await local_backend.rm("dir", recursive=True)
        assert not await local_backend.exists("dir")

    async def test_rm_nonexistent_force(self, local_backend):
        # Force should not raise on missing
        await local_backend.rm("nonexistent.txt", force=True)

    async def test_rm_nonexistent_no_force(self, local_backend):
        with pytest.raises(BackendError):
            await local_backend.rm("nonexistent.txt")

    async def test_rm_recursive_nonexistent_force(self, local_backend):
        await local_backend.rm("nonexistent_dir", recursive=True, force=True)

    async def test_rm_dir_without_recursive(self, local_backend):
        await local_backend.mkdir("empty_dir")
        await local_backend.rm("empty_dir")

    async def test_readdir(self, local_backend):
        await local_backend.write("a.txt", "a")
        await local_backend.write("b.txt", "b")
        entries = await local_backend.readdir(".")
        assert "a.txt" in entries
        assert "b.txt" in entries

    async def test_readdir_nonexistent(self, local_backend):
        with pytest.raises(BackendError) as exc_info:
            await local_backend.readdir("nonexistent_dir")
        assert exc_info.value.code == ErrorCode.LS_FAILED

    async def test_mkdir(self, local_backend):
        await local_backend.mkdir("new_dir/sub")
        assert await local_backend.exists("new_dir/sub")

    async def test_touch(self, local_backend):
        await local_backend.touch("touched.txt")
        assert await local_backend.exists("touched.txt")

    async def test_exists(self, local_backend):
        assert not await local_backend.exists("nope.txt")
        await local_backend.write("yes.txt", "yes")
        assert await local_backend.exists("yes.txt")

    async def test_stat(self, local_backend):
        await local_backend.write("stat.txt", "content")
        stat = await local_backend.stat("stat.txt")
        assert stat.is_file
        assert not stat.is_directory
        assert stat.size == 7

    async def test_stat_directory(self, local_backend):
        await local_backend.mkdir("stat_dir")
        stat = await local_backend.stat("stat_dir")
        assert stat.is_directory
        assert not stat.is_file

    async def test_stat_nonexistent(self, local_backend):
        with pytest.raises(BackendError) as exc_info:
            await local_backend.stat("nope.txt")
        assert exc_info.value.code == ErrorCode.READ_FAILED


class TestLocalBackendPathValidation:
    async def test_path_escape_rejected(self, local_backend):
        with pytest.raises(PathEscapeError):
            await local_backend.read("../../etc/passwd")

    async def test_absolute_path_treated_as_relative(self, local_backend):
        await local_backend.write("etc/passwd", "fake")
        result = await local_backend.read("/etc/passwd")
        assert result == "fake"

    async def test_absolute_path_matching_root(self, local_backend, tmp_workspace):
        await local_backend.write("match.txt", "data")
        result = await local_backend.read(f"{tmp_workspace}/match.txt")
        assert result == "data"


class TestLocalBackendExec:
    async def test_exec_simple(self, local_backend):
        result = await local_backend.exec("echo hello")
        assert result == "hello"

    async def test_exec_empty_command(self, local_backend):
        with pytest.raises(BackendError) as exc_info:
            await local_backend.exec("")
        assert exc_info.value.code == ErrorCode.EMPTY_COMMAND

    async def test_exec_nonzero_exit(self, local_backend):
        with pytest.raises(BackendError) as exc_info:
            await local_backend.exec("exit 1")
        assert exc_info.value.code == ErrorCode.EXEC_FAILED

    async def test_exec_dangerous_blocked(self, local_backend):
        with pytest.raises((DangerousOperationError, BackendError)):
            await local_backend.exec("rm -rf /")

    async def test_exec_workspace_escape_blocked(self, local_backend):
        with pytest.raises(BackendError):
            await local_backend.exec("cd /tmp")

    async def test_exec_output_truncation(self, tmp_workspace):
        config = LocalFilesystemBackendConfig(
            root_dir=tmp_workspace,
            max_output_length=50,
        )
        backend = LocalFilesystemBackend(config)
        result = await backend.exec("printf '%0.s-' {1..200}")
        assert isinstance(result, str)
        assert "truncated" in result.lower() or len(result) <= 60

    async def test_exec_sets_cwd(self, local_backend, tmp_workspace):
        result = await local_backend.exec("pwd")
        assert os.path.abspath(result) == os.path.abspath(tmp_workspace)

    async def test_exec_with_custom_env(self, local_backend):
        options = ExecOptions(env={"MY_VAR": "hello"})
        result = await local_backend.exec("echo $MY_VAR", options)
        assert result == "hello"

    async def test_exec_with_buffer_encoding(self, local_backend):
        options = ExecOptions(encoding="buffer")
        result = await local_backend.exec("echo hello", options)
        assert isinstance(result, bytes)

    async def test_exec_dangerous_with_callback(self, tmp_workspace):
        called_with = []
        config = LocalFilesystemBackendConfig(
            root_dir=tmp_workspace,
            prevent_dangerous=True,
            on_dangerous_operation=lambda cmd: called_with.append(cmd),
        )
        backend = LocalFilesystemBackend(config)
        result = await backend.exec("rm -rf /")
        assert result == ""
        assert len(called_with) == 1

    async def test_exec_no_prevent_dangerous(self, tmp_workspace):
        config = LocalFilesystemBackendConfig(
            root_dir=tmp_workspace,
            prevent_dangerous=False,
        )
        backend = LocalFilesystemBackend(config)
        # Without prevention, a non-dangerous command should work
        result = await backend.exec("echo test")
        assert result == "test"

    async def test_exec_unsafe_command(self, local_backend):
        with pytest.raises(BackendError) as exc_info:
            await local_backend.exec("cd /tmp && ls")
        assert exc_info.value.code == ErrorCode.UNSAFE_COMMAND


class TestLocalBackendLifecycle:
    async def test_destroy(self, local_backend):
        await local_backend.destroy()
        assert local_backend.status == ConnectionStatus.DESTROYED

    async def test_status_change_callback(self, local_backend):
        events = []
        local_backend.on_status_change(lambda e: events.append(e))
        await local_backend.destroy()
        assert len(events) == 1
        assert events[0].to_status == ConnectionStatus.DESTROYED

    async def test_scope_tracking(self, local_backend):
        scoped = local_backend.scope("sub")
        scopes = await local_backend.list_active_scopes()
        assert "sub" in scopes
        await scoped.destroy()
        scopes = await local_backend.list_active_scopes()
        assert "sub" not in scopes

    async def test_track_closeable(self, local_backend):
        class FakeCloseable:
            closed = False

            async def close(self):
                self.closed = True

        c = FakeCloseable()
        local_backend.track_closeable(c)
        await local_backend.destroy()
        assert c.closed

    async def test_destroy_swallows_closeable_errors(self, local_backend):
        class BadCloseable:
            async def close(self):
                raise RuntimeError("fail")

        local_backend.track_closeable(BadCloseable())
        # Should not raise
        await local_backend.destroy()
        assert local_backend.status == ConnectionStatus.DESTROYED


class TestLocalBackendIsolation:
    def test_software_isolation(self, tmp_workspace):
        config = LocalFilesystemBackendConfig(
            root_dir=tmp_workspace,
            isolation=IsolationMode.SOFTWARE,
        )
        backend = LocalFilesystemBackend(config)
        assert backend._actual_isolation == IsolationMode.SOFTWARE
