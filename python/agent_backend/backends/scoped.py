"""Scoped backend implementations for filesystem and memory backends."""

from __future__ import annotations

import asyncio
import os
import os.path
import posixpath
from typing import TYPE_CHECKING

from agent_backend.backends.path_validation import validate_within_boundary
from agent_backend.types import NotImplementedBackendError

if TYPE_CHECKING:
    from agent_backend.backends.base import Closeable
    from agent_backend.backends.local import LocalFilesystemBackend
    from agent_backend.backends.memory import MemoryBackend
    from agent_backend.backends.status import StatusChangeCallback, Unsubscribe
    from agent_backend.types import (
        BackendType,
        ConnectionStatus,
        ExecOptions,
        FileStat,
        ReadOptions,
        ScopeConfig,
    )


class ScopedMemoryBackend:
    """Scoped memory backend implementation.

    Restricts operations to keys with a specific prefix.
    """

    def __init__(
        self,
        parent: MemoryBackend,
        scope_path: str,
        config: ScopeConfig | None = None,
    ) -> None:
        self._parent = parent
        self._scope_path = scope_path if scope_path.endswith("/") else f"{scope_path}/"
        self._root_dir = posixpath.join(parent.root_dir, self._scope_path)
        self._operations_logger = config.operations_logger if config else None

    @property
    def type(self) -> BackendType:
        return self._parent.type

    @property
    def parent(self) -> MemoryBackend:
        return self._parent

    @property
    def scope_path(self) -> str:
        return self._scope_path

    @property
    def root_dir(self) -> str:
        return self._root_dir

    @property
    def status(self) -> ConnectionStatus:
        return self._parent.status

    def on_status_change(self, cb: StatusChangeCallback) -> Unsubscribe:
        return self._parent.on_status_change(cb)

    def track_closeable(self, closeable: Closeable) -> None:
        self._parent.track_closeable(closeable)

    async def exec(
        self, command: str, options: ExecOptions | None = None
    ) -> str | bytes:
        raise NotImplementedBackendError("exec", "memory")

    def _scope_key(self, key: str) -> str:
        """Combine scope path with key and validate scope boundary."""
        scope_for_validation = self._scope_path.rstrip("/")

        if posixpath.isabs(key):
            normalized = posixpath.normpath(posixpath.join("/", key))
            root_normalized = posixpath.normpath(posixpath.join("/", self._root_dir))

            if normalized.startswith(root_normalized + "/"):
                relative_part = normalized[len(root_normalized) + 1 :]
                return posixpath.join(scope_for_validation, relative_part)
            elif normalized == root_normalized or normalized == root_normalized + "/":
                return scope_for_validation

        return validate_within_boundary(key, scope_for_validation, use_posix=True)

    async def read(
        self, key: str, options: ReadOptions | None = None
    ) -> str | bytes:
        return await self._parent.read(self._scope_key(key), options)

    async def write(self, key: str, content: str | bytes) -> None:
        await self._parent.write(self._scope_key(key), content)

    async def rename(self, old_key: str, new_key: str) -> None:
        await self._parent.rename(self._scope_key(old_key), self._scope_key(new_key))

    async def rm(
        self, key: str, *, recursive: bool = False, force: bool = False
    ) -> None:
        await self._parent.rm(self._scope_key(key), recursive=recursive, force=force)

    async def readdir(self, prefix: str) -> list[str]:
        return await self._parent.readdir(self._scope_key(prefix))

    async def mkdir(self, path: str, *, recursive: bool = True) -> None:
        # No-op for memory backend
        pass

    async def touch(self, key: str) -> None:
        await self._parent.touch(self._scope_key(key))

    async def exists(self, key: str) -> bool:
        return await self._parent.exists(self._scope_key(key))

    async def stat(self, key: str) -> FileStat:
        return await self._parent.stat(self._scope_key(key))

    async def list_active_scopes(self) -> list[str]:
        return await self._parent.list_active_scopes()

    def scope(
        self, nested_path: str, config: ScopeConfig | None = None
    ) -> ScopedMemoryBackend:
        combined_path = posixpath.join(self._scope_path, nested_path)
        from agent_backend.types import ScopeConfig as ScopeConfigCls

        merged_config = ScopeConfigCls(
            operations_logger=config.operations_logger if config else self._operations_logger,
        )
        return ScopedMemoryBackend(self._parent, combined_path, merged_config)

    async def get_mcp_transport(self, scope_path: str | None = None) -> object:
        full_scope_path = (
            posixpath.join(self._scope_path, scope_path) if scope_path else self._scope_path
        )
        return await self._parent.get_mcp_transport(full_scope_path)

    async def get_mcp_client(self, scope_path: str | None = None) -> object:
        full_scope_path = (
            posixpath.join(self._scope_path, scope_path) if scope_path else self._scope_path
        )
        return await self._parent.get_mcp_client(full_scope_path)

    async def destroy(self) -> None:
        await self._parent.on_child_destroyed(self)

    async def on_child_destroyed(self, child: object) -> None:
        await self._parent.on_child_destroyed(child)

    # Memory-specific helpers

    async def delete(self, key: str) -> None:
        await self._parent.delete(self._scope_key(key))

    async def clear(self) -> None:
        keys = await self._parent.list_keys(self._scope_path)
        for key in keys:
            await self._parent.delete(key)

    async def list_keys(self, prefix: str | None = None) -> list[str]:
        scoped_prefix = self._scope_key(prefix) if prefix else self._scope_path
        keys = await self._parent.list_keys(scoped_prefix)
        return [k[len(self._scope_path) :] for k in keys]


class ScopedFilesystemBackend:
    """Scoped filesystem backend implementation.

    Wraps any file-based backend and restricts operations to a subdirectory.
    """

    def __init__(
        self,
        parent: LocalFilesystemBackend,
        scope_path: str,
        config: ScopeConfig | None = None,
    ) -> None:
        self._parent = parent
        self._scope_path = scope_path
        self._root_dir = os.path.join(parent.root_dir, scope_path)
        self._custom_env = config.env if config else {}
        self._operations_logger = config.operations_logger if config else None
        self._root_ensured = False
        self._root_ensure_lock = asyncio.Lock()

        # Validate scope path doesn't escape parent
        validate_within_boundary(scope_path, parent.root_dir)

    @property
    def type(self) -> BackendType:
        return self._parent.type

    @property
    def parent(self) -> LocalFilesystemBackend:
        return self._parent

    @property
    def scope_path(self) -> str:
        return self._scope_path

    @property
    def root_dir(self) -> str:
        return self._root_dir

    @property
    def status(self) -> ConnectionStatus:
        return self._parent.status

    def on_status_change(self, cb: StatusChangeCallback) -> Unsubscribe:
        return self._parent.on_status_change(cb)

    def track_closeable(self, closeable: Closeable) -> None:
        self._parent.track_closeable(closeable)

    async def _ensure_root(self) -> None:
        """Ensure the scope root directory exists. Deduped."""
        if self._root_ensured:
            return
        async with self._root_ensure_lock:
            if self._root_ensured:
                return
            if not await self._parent.exists(self._scope_path):
                await self._parent.mkdir(self._scope_path, recursive=True)
            self._root_ensured = True

    def _to_parent_path(self, relative_path: str) -> str:
        """Convert relative path to parent-relative path."""
        if os.path.isabs(relative_path):
            normalized = os.path.normpath(relative_path)
            root_normalized = os.path.normpath(self._root_dir)

            if normalized.startswith(root_normalized + os.sep):
                relative_part = normalized[len(root_normalized) + 1 :]
                return os.path.join(self._scope_path, relative_part)
            elif normalized == root_normalized:
                return self._scope_path

        return validate_within_boundary(relative_path, self._scope_path)

    def _merge_env(
        self, command_env: dict[str, str] | None = None
    ) -> dict[str, str] | None:
        if not self._custom_env and not command_env:
            return None
        return {**self._custom_env, **(command_env or {})}

    async def exec(
        self, command: str, options: ExecOptions | None = None
    ) -> str | bytes:
        await self._ensure_root()
        from agent_backend.types import ExecOptions as ExecOptionsCls

        merged_env = self._merge_env(options.env if options else None)
        scoped_options = ExecOptionsCls(
            encoding=options.encoding if options else "utf8",
            cwd=self._root_dir,
            env=merged_env,
        )
        return await self._parent.exec(command, scoped_options)

    async def read(
        self, path: str, options: ReadOptions | None = None
    ) -> str | bytes:
        return await self._parent.read(self._to_parent_path(path), options)

    async def write(self, path: str, content: str | bytes) -> None:
        await self._ensure_root()
        await self._parent.write(self._to_parent_path(path), content)

    async def rename(self, old_path: str, new_path: str) -> None:
        await self._ensure_root()
        await self._parent.rename(
            self._to_parent_path(old_path), self._to_parent_path(new_path)
        )

    async def rm(
        self, path: str, *, recursive: bool = False, force: bool = False
    ) -> None:
        await self._parent.rm(
            self._to_parent_path(path), recursive=recursive, force=force
        )

    async def readdir(self, path: str) -> list[str]:
        await self._ensure_root()
        return await self._parent.readdir(self._to_parent_path(path))

    async def mkdir(self, path: str, *, recursive: bool = True) -> None:
        await self._ensure_root()
        await self._parent.mkdir(self._to_parent_path(path), recursive=recursive)

    async def touch(self, path: str) -> None:
        await self._ensure_root()
        await self._parent.touch(self._to_parent_path(path))

    async def exists(self, path: str) -> bool:
        return await self._parent.exists(self._to_parent_path(path))

    async def stat(self, path: str) -> FileStat:
        return await self._parent.stat(self._to_parent_path(path))

    def scope(
        self, nested_path: str, config: ScopeConfig | None = None
    ) -> ScopedFilesystemBackend:
        combined_path = os.path.join(self._scope_path, nested_path)
        from agent_backend.types import ScopeConfig as ScopeConfigCls

        merged_config = ScopeConfigCls(
            env={**self._custom_env, **(config.env if config else {})},
            operations_logger=config.operations_logger if config else self._operations_logger,
        )
        return ScopedFilesystemBackend(self._parent, combined_path, merged_config)

    async def list_active_scopes(self) -> list[str]:
        return await self._parent.list_active_scopes()

    async def get_mcp_transport(self, scope_path: str | None = None) -> object:
        full_scope_path = (
            os.path.join(self._scope_path, scope_path) if scope_path else self._scope_path
        )
        return await self._parent.get_mcp_transport(full_scope_path)

    async def get_mcp_client(self, scope_path: str | None = None) -> object:
        full_scope_path = (
            os.path.join(self._scope_path, scope_path) if scope_path else self._scope_path
        )
        return await self._parent.get_mcp_client(full_scope_path)

    async def destroy(self) -> None:
        await self._parent.on_child_destroyed(self)

    async def on_child_destroyed(self, child: object) -> None:
        await self._parent.on_child_destroyed(child)
