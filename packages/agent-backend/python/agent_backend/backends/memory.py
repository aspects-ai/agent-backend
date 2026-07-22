"""In-memory key/value backend implementation.

All data is stored in the client's memory.
No exec support (throws NotImplementedBackendError).
"""

from __future__ import annotations

import posixpath
from typing import TYPE_CHECKING

from agent_backend.backends.status import ConnectionStatusManager
from agent_backend.types import (
    BackendError,
    BackendType,
    ConnectionStatus,
    ErrorCode,
    FileStat,
    MemoryBackendConfig,
    NotImplementedBackendError,
)

if TYPE_CHECKING:
    from agent_backend.backends.base import Closeable
    from agent_backend.backends.scoped import ScopedMemoryBackend
    from agent_backend.backends.status import StatusChangeCallback, Unsubscribe
    from agent_backend.types import ExecOptions, ReadOptions, ScopeConfig


class MemoryBackend:
    """In-memory key/value backend.

    Keys act as pseudo file paths. Does NOT support command execution.
    """

    def __init__(self, config: MemoryBackendConfig | None = None) -> None:
        self._type = BackendType.MEMORY
        self._root_dir = config.root_dir if config else "/"
        self._status_manager = ConnectionStatusManager(ConnectionStatus.CONNECTED)
        self._store: dict[str, str | bytes] = {}
        self._active_scopes: set[ScopedMemoryBackend] = set()
        self._closeables: set[Closeable] = set()

        if config and config.initial_data:
            for key, value in config.initial_data.items():
                self._store[key] = value

    @property
    def type(self) -> BackendType:
        return self._type

    @property
    def root_dir(self) -> str:
        return self._root_dir

    @property
    def status(self) -> ConnectionStatus:
        return self._status_manager.status

    def on_status_change(self, cb: StatusChangeCallback) -> Unsubscribe:
        return self._status_manager.on_status_change(cb)

    def track_closeable(self, closeable: Closeable) -> None:
        self._closeables.add(closeable)

    async def exec(
        self, command: str, options: ExecOptions | None = None
    ) -> str | bytes:
        raise NotImplementedBackendError("exec", "memory")

    async def read(
        self, key: str, options: ReadOptions | None = None
    ) -> str | bytes:
        value = self._store.get(key)
        if value is None:
            raise BackendError(f"Key not found: {key}", ErrorCode.KEY_NOT_FOUND, "read")

        if options and options.encoding == "buffer":
            if isinstance(value, str):
                return value.encode("utf-8")
            return value
        if isinstance(value, bytes):
            return value.decode("utf-8")
        return value

    async def write(self, key: str, content: str | bytes) -> None:
        self._store[key] = content

    async def rename(self, old_key: str, new_key: str) -> None:
        value = self._store.get(old_key)
        if value is None:
            raise BackendError(
                f"Key not found: {old_key}", ErrorCode.KEY_NOT_FOUND, "rename"
            )
        self._store[new_key] = value
        del self._store[old_key]

    async def rm(
        self, key: str, *, recursive: bool = False, force: bool = False
    ) -> None:
        if recursive:
            keys_to_delete: list[str] = []
            prefix = key if key.endswith("/") else f"{key}/"

            if key in self._store:
                keys_to_delete.append(key)

            for k in self._store:
                if k.startswith(prefix):
                    keys_to_delete.append(k)

            for k in keys_to_delete:
                del self._store[k]

            if not force and not keys_to_delete:
                raise BackendError(
                    f"Key not found: {key}", ErrorCode.KEY_NOT_FOUND, "rm"
                )
        else:
            if key not in self._store:
                if not force:
                    raise BackendError(
                        f"Key not found: {key}", ErrorCode.KEY_NOT_FOUND, "rm"
                    )
            else:
                del self._store[key]

    async def readdir(self, prefix: str) -> list[str]:
        is_root = prefix in ("", ".", "/")
        normalized_prefix = "" if is_root else (prefix if prefix.endswith("/") else f"{prefix}/")

        children: set[str] = set()
        for key in self._store:
            if is_root:
                relative_path = key
            elif key.startswith(normalized_prefix):
                relative_path = key[len(normalized_prefix) :]
            else:
                continue
            parts = relative_path.split("/")
            immediate_child = parts[0]
            if immediate_child:
                children.add(immediate_child)

        return sorted(children)

    async def mkdir(self, path: str, *, recursive: bool = True) -> None:
        # No-op: directories are implicit in memory backend
        pass

    async def touch(self, key: str) -> None:
        if key not in self._store:
            self._store[key] = ""

    async def exists(self, key: str) -> bool:
        return key in self._store

    async def stat(self, key: str) -> FileStat:
        value = self._store.get(key)
        if value is None:
            raise BackendError(
                f"Key not found: {key}", ErrorCode.KEY_NOT_FOUND, "stat"
            )

        size = len(value.encode("utf-8")) if isinstance(value, str) else len(value)
        import time

        return FileStat(
            is_file=True,
            is_directory=False,
            size=size,
            modified=time.time(),
        )

    async def list_active_scopes(self) -> list[str]:
        return [scope.scope_path for scope in self._active_scopes]

    def scope(
        self, scope_path: str, config: ScopeConfig | None = None
    ) -> ScopedMemoryBackend:
        from agent_backend.backends.scoped import ScopedMemoryBackend

        scoped = ScopedMemoryBackend(self, scope_path, config)
        self._active_scopes.add(scoped)
        return scoped

    async def on_child_destroyed(self, child: object) -> None:
        self._active_scopes.discard(child)  # type: ignore[arg-type]

    async def get_mcp_transport(self, scope_path: str | None = None) -> object:
        from agent_backend.mcp_integration.transport import create_backend_mcp_transport

        transport = await create_backend_mcp_transport(self, scope_path)
        self._closeables.add(transport)
        return transport

    async def get_mcp_client(self, scope_path: str | None = None) -> object:
        from agent_backend.mcp_integration.client import create_mcp_client

        effective_root = (
            posixpath.join(self._root_dir, scope_path) if scope_path else self._root_dir
        )
        client = await create_mcp_client(
            backend_type="memory", root_dir=effective_root
        )
        self._closeables.add(client)
        return client

    async def destroy(self) -> None:
        for closeable in list(self._closeables):
            try:
                await closeable.close()
            except Exception:
                pass
        self._closeables.clear()
        self._active_scopes.clear()
        self._store.clear()
        self._status_manager.set_status(ConnectionStatus.DESTROYED)
        self._status_manager.clear_listeners()

    # Memory-specific helpers

    async def delete(self, key: str) -> None:
        """Delete a key (memory-specific helper)."""
        self._store.pop(key, None)

    async def clear(self) -> None:
        """Clear all keys (memory-specific helper)."""
        self._store.clear()

    async def list_keys(self, prefix: str | None = None) -> list[str]:
        """List all keys matching prefix (memory-specific helper)."""
        if not prefix:
            return sorted(self._store.keys())
        return sorted(k for k in self._store if k.startswith(prefix))
