"""Backend Protocol/ABC definitions."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from collections.abc import Callable

    from agent_backend.types import (
        ConnectionStatus,
        ExecOptions,
        FileStat,
        ReadOptions,
        ScopeConfig,
        StatusChangeEvent,
    )


class Closeable(Protocol):
    """Protocol for objects with an async close method."""

    async def close(self) -> None: ...


@runtime_checkable
class Backend(Protocol):
    """Base interface for all backend types."""

    @property
    def type(self) -> str: ...

    @property
    def status(self) -> ConnectionStatus: ...

    def on_status_change(self, cb: Callable[[StatusChangeEvent], None]) -> Callable[[], None]: ...

    def track_closeable(self, closeable: Closeable) -> None: ...

    async def destroy(self) -> None: ...

    async def on_child_destroyed(self, child: Backend) -> None: ...


@runtime_checkable
class FileBasedBackend(Backend, Protocol):
    """Interface for backends that support file-based operations."""

    @property
    def root_dir(self) -> str: ...

    async def exec(self, command: str, options: ExecOptions | None = None) -> str | bytes: ...

    async def read(self, path: str, options: ReadOptions | None = None) -> str | bytes: ...

    async def write(self, path: str, content: str | bytes) -> None: ...

    async def rename(self, old_path: str, new_path: str) -> None: ...

    async def rm(
        self, path: str, *, recursive: bool = False, force: bool = False
    ) -> None: ...

    async def readdir(self, path: str) -> list[str]: ...

    async def mkdir(self, path: str, *, recursive: bool = True) -> None: ...

    async def touch(self, path: str) -> None: ...

    async def exists(self, path: str) -> bool: ...

    async def stat(self, path: str) -> FileStat: ...

    def scope(self, path: str, config: ScopeConfig | None = None) -> ScopedBackend: ...

    async def list_active_scopes(self) -> list[str]: ...

    async def get_mcp_transport(self, scope_path: str | None = None) -> object: ...

    async def get_mcp_client(self, scope_path: str | None = None) -> object: ...


@runtime_checkable
class ScopedBackend(FileBasedBackend, Protocol):
    """Scoped backend wraps a backend with path restriction."""

    @property
    def parent(self) -> FileBasedBackend: ...

    @property
    def scope_path(self) -> str: ...
