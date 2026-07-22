"""Tests for MemoryBackend."""

from __future__ import annotations

import pytest

from agent_backend.backends.memory import MemoryBackend
from agent_backend.types import (
    BackendError,
    BackendType,
    ConnectionStatus,
    ErrorCode,
    MemoryBackendConfig,
    NotImplementedBackendError,
)


class TestMemoryBackendInit:
    def test_default_config(self):
        backend = MemoryBackend()
        assert backend.type == BackendType.MEMORY
        assert backend.root_dir == "/"
        assert backend.status == ConnectionStatus.CONNECTED

    def test_custom_root_dir(self):
        config = MemoryBackendConfig(root_dir="/custom")
        backend = MemoryBackend(config)
        assert backend.root_dir == "/custom"

    def test_initial_data(self):
        config = MemoryBackendConfig(initial_data={"key": "value"})
        backend = MemoryBackend(config)
        assert backend._store == {"key": "value"}


class TestMemoryBackendRead:
    async def test_read_existing_key(self, memory_backend):
        result = await memory_backend.read("file1.txt")
        assert result == "hello"

    async def test_read_missing_key(self, memory_backend):
        with pytest.raises(BackendError) as exc_info:
            await memory_backend.read("nonexistent")
        assert exc_info.value.code == ErrorCode.KEY_NOT_FOUND

    async def test_read_bytes(self, memory_backend):
        from agent_backend.types import ReadOptions

        result = await memory_backend.read("file1.txt", ReadOptions(encoding="buffer"))
        assert result == b"hello"

    async def test_read_bytes_value_as_buffer(self, empty_memory_backend):
        from agent_backend.types import ReadOptions

        await empty_memory_backend.write("bin", b"\x00\x01")
        result = await empty_memory_backend.read("bin", ReadOptions(encoding="buffer"))
        assert result == b"\x00\x01"

    async def test_read_bytes_value_as_string(self, empty_memory_backend):
        await empty_memory_backend.write("bin", b"\x68\x65\x6c\x6c\x6f")
        result = await empty_memory_backend.read("bin")
        assert result == "hello"


class TestMemoryBackendWrite:
    async def test_write_new_key(self, empty_memory_backend):
        await empty_memory_backend.write("test.txt", "content")
        result = await empty_memory_backend.read("test.txt")
        assert result == "content"

    async def test_write_overwrite(self, memory_backend):
        await memory_backend.write("file1.txt", "new content")
        result = await memory_backend.read("file1.txt")
        assert result == "new content"

    async def test_write_bytes(self, empty_memory_backend):
        await empty_memory_backend.write("binary.bin", b"\x00\x01\x02")
        from agent_backend.types import ReadOptions

        result = await empty_memory_backend.read("binary.bin", ReadOptions(encoding="buffer"))
        assert result == b"\x00\x01\x02"


class TestMemoryBackendRename:
    async def test_rename(self, memory_backend):
        await memory_backend.rename("file1.txt", "renamed.txt")
        result = await memory_backend.read("renamed.txt")
        assert result == "hello"
        with pytest.raises(BackendError):
            await memory_backend.read("file1.txt")

    async def test_rename_missing_key(self, memory_backend):
        with pytest.raises(BackendError) as exc_info:
            await memory_backend.rename("nonexistent", "new")
        assert exc_info.value.code == ErrorCode.KEY_NOT_FOUND


class TestMemoryBackendRm:
    async def test_rm_existing(self, memory_backend):
        await memory_backend.rm("file1.txt")
        assert not await memory_backend.exists("file1.txt")

    async def test_rm_missing_not_force(self, memory_backend):
        with pytest.raises(BackendError):
            await memory_backend.rm("nonexistent")

    async def test_rm_missing_force(self, memory_backend):
        await memory_backend.rm("nonexistent", force=True)

    async def test_rm_recursive(self, memory_backend):
        await memory_backend.rm("dir", recursive=True)
        assert not await memory_backend.exists("dir/nested.txt")
        assert not await memory_backend.exists("dir/deep/file.txt")


class TestMemoryBackendReaddir:
    async def test_readdir_root(self, memory_backend):
        # Root "/" should list immediate children
        entries = await memory_backend.readdir("/")
        assert "file1.txt" in entries
        assert "file2.txt" in entries
        assert "dir" in entries

    async def test_readdir_subdir(self, memory_backend):
        entries = await memory_backend.readdir("dir")
        assert "nested.txt" in entries
        assert "deep" in entries


    async def test_readdir_empty_string(self, memory_backend):
        entries = await memory_backend.readdir("")
        assert "file1.txt" in entries

    async def test_readdir_dot(self, memory_backend):
        entries = await memory_backend.readdir(".")
        assert "file1.txt" in entries

    async def test_rm_recursive_missing_no_force(self, memory_backend):
        with pytest.raises(BackendError):
            await memory_backend.rm("totally_missing", recursive=True)

    async def test_rm_recursive_missing_force(self, memory_backend):
        await memory_backend.rm("totally_missing", recursive=True, force=True)


class TestMemoryBackendMisc:
    async def test_mkdir_noop(self, memory_backend):
        # mkdir is a no-op for memory backend
        await memory_backend.mkdir("some/path")

    async def test_touch(self, empty_memory_backend):
        await empty_memory_backend.touch("new.txt")
        assert await empty_memory_backend.exists("new.txt")
        result = await empty_memory_backend.read("new.txt")
        assert result == ""

    async def test_touch_existing(self, memory_backend):
        await memory_backend.touch("file1.txt")
        result = await memory_backend.read("file1.txt")
        assert result == "hello"  # Not overwritten

    async def test_exists(self, memory_backend):
        assert await memory_backend.exists("file1.txt")
        assert not await memory_backend.exists("nonexistent")

    async def test_stat(self, memory_backend):
        stat = await memory_backend.stat("file1.txt")
        assert stat.is_file is True
        assert stat.is_directory is False
        assert stat.size == 5  # len("hello")

    async def test_stat_missing(self, memory_backend):
        with pytest.raises(BackendError):
            await memory_backend.stat("nonexistent")

    async def test_exec_not_implemented(self, memory_backend):
        with pytest.raises(NotImplementedBackendError):
            await memory_backend.exec("ls")


class TestMemoryBackendLifecycle:
    async def test_destroy(self, memory_backend):
        await memory_backend.destroy()
        assert memory_backend.status == ConnectionStatus.DESTROYED

    async def test_status_change_callback(self, memory_backend):
        events = []
        memory_backend.on_status_change(lambda e: events.append(e))
        await memory_backend.destroy()
        assert len(events) == 1
        assert events[0].to_status == ConnectionStatus.DESTROYED

    async def test_unsubscribe(self, memory_backend):
        events = []
        unsub = memory_backend.on_status_change(lambda e: events.append(e))
        unsub()
        await memory_backend.destroy()
        assert len(events) == 0

    async def test_list_active_scopes(self, memory_backend):
        scopes = await memory_backend.list_active_scopes()
        assert scopes == []


    async def test_track_closeable(self, memory_backend):
        class FakeCloseable:
            closed = False

            async def close(self):
                self.closed = True

        c = FakeCloseable()
        memory_backend.track_closeable(c)
        await memory_backend.destroy()
        assert c.closed

    async def test_destroy_swallows_closeable_error(self):
        backend = MemoryBackend()

        class BadCloseable:
            async def close(self):
                raise RuntimeError("oops")

        backend.track_closeable(BadCloseable())
        await backend.destroy()
        assert backend.status == ConnectionStatus.DESTROYED


class TestMemoryBackendHelpers:
    async def test_delete(self, memory_backend):
        await memory_backend.delete("file1.txt")
        assert not await memory_backend.exists("file1.txt")

    async def test_clear(self, memory_backend):
        await memory_backend.clear()
        keys = await memory_backend.list_keys()
        assert keys == []

    async def test_list_all(self, memory_backend):
        keys = await memory_backend.list_keys()
        assert len(keys) == 4

    async def test_list_prefix(self, memory_backend):
        keys = await memory_backend.list_keys("dir/")
        assert len(keys) == 2
