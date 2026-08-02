"""Tests for ScopedMemoryBackend and ScopedFilesystemBackend."""

from __future__ import annotations

import pytest

from agent_backend.backends.memory import MemoryBackend
from agent_backend.types import (
    BackendType,
    ConnectionStatus,
    MemoryBackendConfig,
    NotImplementedBackendError,
    PathEscapeError,
)


class TestScopedMemoryBackend:
    @pytest.fixture
    def scoped_setup(self):
        config = MemoryBackendConfig(
            root_dir="/",
            initial_data={
                "users/alice/file.txt": "alice data",
                "users/alice/project/config.json": "{}",
                "users/bob/file.txt": "bob data",
            },
        )
        backend = MemoryBackend(config)
        scoped = backend.scope("users/alice")
        return backend, scoped

    async def test_read_scoped(self, scoped_setup):
        _, scoped = scoped_setup
        result = await scoped.read("file.txt")
        assert result == "alice data"

    async def test_write_scoped(self, scoped_setup):
        parent, scoped = scoped_setup
        await scoped.write("new.txt", "new content")
        result = await parent.read("users/alice/new.txt")
        assert result == "new content"

    async def test_readdir_scoped(self, scoped_setup):
        _, scoped = scoped_setup
        entries = await scoped.readdir(".")
        assert "file.txt" in entries
        assert "project" in entries

    async def test_exists_scoped(self, scoped_setup):
        _, scoped = scoped_setup
        assert await scoped.exists("file.txt")
        assert not await scoped.exists("nonexistent")

    async def test_path_escape_rejected(self, scoped_setup):
        _, scoped = scoped_setup
        with pytest.raises(PathEscapeError):
            await scoped.read("../bob/file.txt")

    async def test_exec_not_implemented(self, scoped_setup):
        _, scoped = scoped_setup
        with pytest.raises(NotImplementedBackendError):
            await scoped.exec("ls")

    async def test_status_from_parent(self, scoped_setup):
        parent, scoped = scoped_setup
        assert scoped.status == ConnectionStatus.CONNECTED
        await parent.destroy()
        assert scoped.status == ConnectionStatus.DESTROYED

    async def test_nested_scope(self, scoped_setup):
        _, scoped = scoped_setup
        nested = scoped.scope("project")
        result = await nested.read("config.json")
        assert result == "{}"

    async def test_destroy_scope(self, scoped_setup):
        parent, scoped = scoped_setup
        scopes = await parent.list_active_scopes()
        assert len(scopes) == 1
        await scoped.destroy()
        scopes = await parent.list_active_scopes()
        assert len(scopes) == 0

    async def test_rename_scoped(self, scoped_setup):
        _parent, scoped = scoped_setup
        await scoped.rename("file.txt", "renamed.txt")
        assert await scoped.exists("renamed.txt")
        assert not await scoped.exists("file.txt")

    async def test_rm_scoped(self, scoped_setup):
        _, scoped = scoped_setup
        await scoped.rm("file.txt")
        assert not await scoped.exists("file.txt")

    async def test_touch_scoped(self, scoped_setup):
        _, scoped = scoped_setup
        await scoped.touch("touched.txt")
        assert await scoped.exists("touched.txt")

    async def test_stat_scoped(self, scoped_setup):
        _, scoped = scoped_setup
        stat = await scoped.stat("file.txt")
        assert stat.is_file
        assert stat.size == len("alice data")

    async def test_type_from_parent(self, scoped_setup):
        _, scoped = scoped_setup
        assert scoped.type == BackendType.MEMORY

    async def test_root_dir(self, scoped_setup):
        _, scoped = scoped_setup
        assert "users/alice" in scoped.root_dir

    async def test_scope_path(self, scoped_setup):
        _, scoped = scoped_setup
        assert scoped.scope_path == "users/alice/"

    async def test_parent_ref(self, scoped_setup):
        parent, scoped = scoped_setup
        assert scoped.parent is parent

    async def test_on_status_change(self, scoped_setup):
        parent, scoped = scoped_setup
        events = []
        scoped.on_status_change(lambda e: events.append(e))
        await parent.destroy()
        assert len(events) == 1

    async def test_track_closeable(self, scoped_setup):
        parent, scoped = scoped_setup

        class FakeCloseable:
            async def close(self):
                pass

        closeable = FakeCloseable()
        scoped.track_closeable(closeable)
        assert closeable in parent._closeables

    async def test_mkdir_noop(self, scoped_setup):
        _, scoped = scoped_setup
        # Should not raise
        await scoped.mkdir("any/path")

    async def test_list_active_scopes(self, scoped_setup):
        _parent, scoped = scoped_setup
        scopes = await scoped.list_active_scopes()
        assert len(scopes) == 1

    async def test_on_child_destroyed(self, scoped_setup):
        _parent, scoped = scoped_setup
        nested = scoped.scope("project")
        await scoped.on_child_destroyed(nested)

    async def test_delete_helper(self, scoped_setup):
        _, scoped = scoped_setup
        await scoped.delete("file.txt")
        assert not await scoped.exists("file.txt")

    async def test_clear_helper(self, scoped_setup):
        _, scoped = scoped_setup
        await scoped.clear()
        entries = await scoped.readdir(".")
        assert len(entries) == 0

    async def test_list_helper(self, scoped_setup):
        _, scoped = scoped_setup
        keys = await scoped.list_keys()
        assert "file.txt" in keys
        assert "project/config.json" in keys

    async def test_list_helper_with_prefix(self, scoped_setup):
        _, scoped = scoped_setup
        keys = await scoped.list_keys("project")
        assert any("config.json" in k for k in keys)


class TestScopedFilesystemBackend:
    async def test_scoped_read_write(self, local_backend, tmp_workspace):
        import os

        scope_dir = os.path.join(tmp_workspace, "scope")
        os.makedirs(scope_dir, exist_ok=True)

        scoped = local_backend.scope("scope")
        await scoped.write("test.txt", "scoped content")
        result = await scoped.read("test.txt")
        assert result == "scoped content"

    async def test_scoped_path_escape(self, local_backend):
        scoped = local_backend.scope("scope")
        with pytest.raises(PathEscapeError):
            await scoped.read("../../etc/passwd")

    async def test_scoped_exec(self, local_backend):
        scoped = local_backend.scope("scope")
        result = await scoped.exec("echo hello")
        assert result == "hello"

    async def test_scoped_status_from_parent(self, local_backend):
        scoped = local_backend.scope("scope")
        assert scoped.status == ConnectionStatus.CONNECTED

    async def test_destroy_scope(self, local_backend):
        scoped = local_backend.scope("scope")
        scopes = await local_backend.list_active_scopes()
        assert "scope" in scopes
        await scoped.destroy()
        scopes = await local_backend.list_active_scopes()
        assert "scope" not in scopes

    async def test_nested_scope(self, local_backend):
        scoped = local_backend.scope("scope")
        nested = scoped.scope("sub")
        await nested.write("file.txt", "nested")
        result = await nested.read("file.txt")
        assert result == "nested"

    async def test_type_from_parent(self, local_backend):
        scoped = local_backend.scope("scope")
        assert scoped.type == BackendType.LOCAL_FILESYSTEM

    async def test_parent_ref(self, local_backend):
        scoped = local_backend.scope("scope")
        assert scoped.parent is local_backend

    async def test_scope_path(self, local_backend):
        scoped = local_backend.scope("scope")
        assert scoped.scope_path == "scope"

    async def test_root_dir(self, local_backend, tmp_workspace):
        import os

        scoped = local_backend.scope("scope")
        assert scoped.root_dir == os.path.join(tmp_workspace, "scope")

    async def test_on_status_change(self, local_backend):
        scoped = local_backend.scope("scope")
        events = []
        scoped.on_status_change(lambda e: events.append(e))
        await local_backend.destroy()
        assert len(events) == 1

    async def test_track_closeable(self, local_backend):
        scoped = local_backend.scope("scope")

        class FakeCloseable:
            async def close(self):
                pass

        closeable = FakeCloseable()
        scoped.track_closeable(closeable)
        assert closeable in local_backend._closeables

    async def test_readdir_scoped(self, local_backend):
        scoped = local_backend.scope("scope")
        await scoped.write("a.txt", "a")
        await scoped.write("b.txt", "b")
        entries = await scoped.readdir(".")
        assert "a.txt" in entries
        assert "b.txt" in entries

    async def test_rename_scoped(self, local_backend):
        scoped = local_backend.scope("scope")
        await scoped.write("old.txt", "content")
        await scoped.rename("old.txt", "new.txt")
        assert await scoped.exists("new.txt")
        assert not await scoped.exists("old.txt")

    async def test_rm_scoped(self, local_backend):
        scoped = local_backend.scope("scope")
        await scoped.write("del.txt", "data")
        await scoped.rm("del.txt")
        assert not await scoped.exists("del.txt")

    async def test_mkdir_scoped(self, local_backend):
        scoped = local_backend.scope("scope")
        await scoped.mkdir("sub/dir")
        assert await scoped.exists("sub/dir")

    async def test_touch_scoped(self, local_backend):
        scoped = local_backend.scope("scope")
        await scoped.touch("touched.txt")
        assert await scoped.exists("touched.txt")

    async def test_stat_scoped(self, local_backend):
        scoped = local_backend.scope("scope")
        await scoped.write("s.txt", "hello")
        stat = await scoped.stat("s.txt")
        assert stat.is_file
        assert stat.size == 5

    async def test_list_active_scopes(self, local_backend):
        scoped = local_backend.scope("scope")
        scopes = await scoped.list_active_scopes()
        assert "scope" in scopes

    async def test_on_child_destroyed(self, local_backend):
        scoped = local_backend.scope("scope")
        nested = scoped.scope("sub")
        await scoped.on_child_destroyed(nested)

    async def test_merge_env(self, local_backend):
        from agent_backend.types import ScopeConfig

        config = ScopeConfig(env={"FOO": "bar"})
        scoped = local_backend.scope("scope", config)
        result = await scoped.exec("echo $FOO")
        assert result == "bar"
