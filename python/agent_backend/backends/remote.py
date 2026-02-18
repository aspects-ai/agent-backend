"""Remote filesystem backend implementation.

Same operations as local, but executed on a remote host via SSH-over-WebSocket
(for file ops) and MCP over HTTP (for tool calls).
"""

from __future__ import annotations

import asyncio
import logging
import posixpath
from typing import TYPE_CHECKING

from agent_backend.backends.path_validation import (
    validate_within_boundary,
)
from agent_backend.backends.status import ConnectionStatusManager
from agent_backend.backends.transports.websocket_ssh import WebSocketSSHTransport
from agent_backend.safety import is_command_safe, is_dangerous
from agent_backend.types import (
    BackendError,
    BackendType,
    ConnectionStatus,
    DangerousOperationError,
    ErrorCode,
    FileStat,
    RemoteFilesystemBackendConfig,
)

if TYPE_CHECKING:
    from agent_backend.backends.base import Closeable
    from agent_backend.backends.status import StatusChangeCallback, Unsubscribe
    from agent_backend.types import ExecOptions, ReadOptions, ScopeConfig

logger = logging.getLogger(__name__)


class RemoteFilesystemBackend:
    """Remote filesystem backend.

    Executes commands and file operations on a remote host via SSH-over-WebSocket
    and MCP over HTTP.
    """

    def __init__(self, config: RemoteFilesystemBackendConfig) -> None:
        self._type = BackendType.REMOTE_FILESYSTEM
        self._root_dir = config.root_dir
        self._config = config
        self._host = config.host
        self._port = config.port or config.mcp_port
        self._auth_token = config.auth_token
        self._mcp_port = config.mcp_port
        self._mcp_host_override = config.mcp_server_host_override
        self._operation_timeout_ms = config.operation_timeout_ms
        self._keepalive_interval = config.keepalive_interval_ms / 1000.0
        self._keepalive_count_max = config.keepalive_count_max
        self._reconnection = config.reconnection
        self._prevent_dangerous = config.prevent_dangerous
        self._max_output_length = config.max_output_length

        self._status_manager = ConnectionStatusManager(ConnectionStatus.DISCONNECTED)
        self._transport: WebSocketSSHTransport | None = None
        self._active_scopes: set[object] = set()
        self._closeables: set[Closeable] = set()
        self._reconnect_task: asyncio.Task[None] | None = None
        self._retry_count = 0

    @property
    def type(self) -> BackendType:
        return self._type

    @property
    def root_dir(self) -> str:
        return self._root_dir

    @property
    def status(self) -> ConnectionStatus:
        return self._status_manager.status

    @property
    def config(self) -> RemoteFilesystemBackendConfig:
        return self._config

    def on_status_change(self, cb: StatusChangeCallback) -> Unsubscribe:
        return self._status_manager.on_status_change(cb)

    def track_closeable(self, closeable: Closeable) -> None:
        self._closeables.add(closeable)

    async def connect(self) -> None:
        """Establish connection to remote host."""
        self._status_manager.set_status(ConnectionStatus.CONNECTING)
        try:
            self._transport = WebSocketSSHTransport(
                host=self._host,
                port=self._port,
                auth_token=self._auth_token,
                keepalive_interval=self._keepalive_interval,
                keepalive_count_max=self._keepalive_count_max,
            )
            await self._transport.connect()
            self._status_manager.set_status(ConnectionStatus.CONNECTED)
            self._retry_count = 0
        except Exception as e:
            self._status_manager.set_status(ConnectionStatus.DISCONNECTED, error=e)
            if self._reconnection.enabled:
                self._schedule_reconnect()
            raise

    async def _ensure_connected(self) -> None:
        """Ensure transport is connected, connecting if needed."""
        if self._status_manager.status == ConnectionStatus.DESTROYED:
            raise BackendError("Backend is destroyed", ErrorCode.CONNECTION_CLOSED)
        if self._status_manager.status == ConnectionStatus.CONNECTED and self._transport:
            return
        await self.connect()

    def _schedule_reconnect(self) -> None:
        """Schedule a reconnection attempt with exponential backoff."""
        if not self._reconnection.enabled:
            return
        if (
            self._reconnection.max_retries > 0
            and self._retry_count >= self._reconnection.max_retries
        ):
            return

        delay = min(
            self._reconnection.initial_delay_ms
            * (self._reconnection.backoff_multiplier ** self._retry_count)
            / 1000.0,
            self._reconnection.max_delay_ms / 1000.0,
        )

        self._status_manager.set_status(ConnectionStatus.RECONNECTING)
        self._reconnect_task = asyncio.create_task(self._reconnect(delay))

    async def _reconnect(self, delay: float) -> None:
        """Attempt reconnection after delay."""
        await asyncio.sleep(delay)
        self._retry_count += 1
        try:
            await self.connect()
        except Exception:
            logger.debug("Reconnection attempt %d failed", self._retry_count)

    def _resolve_path(self, relative_path: str) -> str:
        """Resolve path using posixpath (remote is always Unix)."""
        return validate_within_boundary(
            relative_path, self._root_dir, use_posix=True
        )

    async def exec(
        self, command: str, options: ExecOptions | None = None
    ) -> str | bytes:
        if not command.strip():
            raise BackendError("Command cannot be empty", ErrorCode.EMPTY_COMMAND)

        if self._prevent_dangerous:
            if is_dangerous(command):
                raise DangerousOperationError(command)
            safety_check = is_command_safe(command)
            if not safety_check.safe:
                raise BackendError(
                    safety_check.reason or "Command failed safety check",
                    ErrorCode.UNSAFE_COMMAND,
                    command,
                )

        await self._ensure_connected()
        assert self._transport is not None

        cwd = options.cwd if options and options.cwd else self._root_dir
        env_str = ""
        if options and options.env:
            env_str = " ".join(f"{k}={v}" for k, v in options.env.items()) + " "
        full_command = f"cd {cwd} && HOME={cwd} {env_str}{command}"

        result = await self._transport.run(full_command, check=False)

        if result.returncode == 0:
            output = (result.stdout or "").strip()
            if self._max_output_length and len(output) > self._max_output_length:
                truncated_length = self._max_output_length - 50
                output = (
                    f"{output[:truncated_length]}\n\n"
                    f"... [Output truncated. Full output was {len(output)} characters, "
                    f"showing first {truncated_length}]"
                )
            encoding = options.encoding if options else "utf8"
            if encoding == "buffer":
                return output.encode("utf-8")
            return output
        else:
            error_msg = (result.stderr or result.stdout or "").strip()
            raise BackendError(
                f"Command execution failed with exit code {result.returncode}: {error_msg}",
                ErrorCode.EXEC_FAILED,
                command,
            )

    async def read(
        self, relative_path: str, options: ReadOptions | None = None
    ) -> str | bytes:
        resolved = self._resolve_path(relative_path)
        full_path = posixpath.normpath(posixpath.join("/", resolved))
        await self._ensure_connected()
        assert self._transport is not None

        sftp = await self._transport.get_sftp()
        try:
            data = await sftp.getfo(full_path)
            content = data.read()
            encoding = options.encoding if options else "utf8"
            if encoding == "buffer":
                return content if isinstance(content, bytes) else content.encode("utf-8")
            return content.decode("utf-8") if isinstance(content, bytes) else content
        except Exception as e:
            raise BackendError(
                f"Failed to read file: {relative_path}",
                ErrorCode.READ_FAILED,
                str(e),
            ) from e

    async def write(self, relative_path: str, content: str | bytes) -> None:
        resolved = self._resolve_path(relative_path)
        full_path = posixpath.normpath(posixpath.join("/", resolved))
        await self._ensure_connected()
        assert self._transport is not None

        sftp = await self._transport.get_sftp()
        try:
            # Ensure parent directory exists (use workspace-relative path
            # because the SFTP server is chrooted to root_dir)
            parent = posixpath.dirname(full_path)
            rel_parent = posixpath.relpath(parent, self._root_dir)
            if rel_parent != ".":
                await sftp.makedirs(rel_parent, exist_ok=True)
            data = content.encode("utf-8") if isinstance(content, str) else content
            async with sftp.open(full_path, "wb") as f:
                await f.write(data)
        except Exception as e:
            raise BackendError(
                f"Failed to write file: {relative_path}",
                ErrorCode.WRITE_FAILED,
                str(e),
            ) from e

    async def rename(self, old_path: str, new_path: str) -> None:
        old_resolved = self._resolve_path(old_path)
        new_resolved = self._resolve_path(new_path)
        await self._ensure_connected()
        assert self._transport is not None

        sftp = await self._transport.get_sftp()
        try:
            await sftp.rename(old_resolved, new_resolved)
        except Exception as e:
            raise BackendError(
                f"Failed to rename {old_path} to {new_path}",
                ErrorCode.WRITE_FAILED,
                str(e),
            ) from e

    async def rm(
        self, relative_path: str, *, recursive: bool = False, force: bool = False
    ) -> None:
        resolved = self._resolve_path(relative_path)
        await self._ensure_connected()
        assert self._transport is not None

        try:
            if recursive:
                cmd = f"rm -rf {resolved}" if force else f"rm -r {resolved}"
            else:
                cmd = f"rm -f {resolved}" if force else f"rm {resolved}"
            result = await self._transport.run(cmd, check=False)
            if result.returncode != 0 and not force:
                raise BackendError(
                    f"Failed to delete: {relative_path}",
                    ErrorCode.WRITE_FAILED,
                    (result.stderr or "").strip(),
                )
        except BackendError:
            raise
        except Exception as e:
            raise BackendError(
                f"Failed to delete: {relative_path}",
                ErrorCode.WRITE_FAILED,
                str(e),
            ) from e

    async def readdir(self, relative_path: str) -> list[str]:
        resolved = self._resolve_path(relative_path)
        full_path = posixpath.normpath(posixpath.join("/", resolved))
        await self._ensure_connected()
        assert self._transport is not None

        sftp = await self._transport.get_sftp()
        try:
            entries = await sftp.listdir(full_path)
            return sorted(entries)
        except Exception as e:
            raise BackendError(
                f"Failed to read directory: {relative_path}",
                ErrorCode.LS_FAILED,
                str(e),
            ) from e

    async def mkdir(self, relative_path: str, *, recursive: bool = True) -> None:
        resolved = self._resolve_path(relative_path)
        full_path = posixpath.normpath(posixpath.join("/", resolved))
        await self._ensure_connected()
        assert self._transport is not None

        sftp = await self._transport.get_sftp()
        try:
            if recursive:
                # Use workspace-relative path because the SFTP server
                # is chrooted to root_dir
                rel_path = posixpath.relpath(full_path, self._root_dir)
                await sftp.makedirs(rel_path, exist_ok=True)
            else:
                await sftp.mkdir(full_path)
        except Exception as e:
            raise BackendError(
                f"Failed to create directory: {relative_path}",
                ErrorCode.WRITE_FAILED,
                str(e),
            ) from e

    async def touch(self, relative_path: str) -> None:
        resolved = self._resolve_path(relative_path)
        await self._ensure_connected()
        assert self._transport is not None

        result = await self._transport.run(f"touch {resolved}", check=False)
        if result.returncode != 0:
            raise BackendError(
                f"Failed to touch: {relative_path}",
                ErrorCode.WRITE_FAILED,
                (result.stderr or "").strip(),
            )

    async def exists(self, relative_path: str) -> bool:
        resolved = self._resolve_path(relative_path)
        await self._ensure_connected()
        assert self._transport is not None

        result = await self._transport.run(f"test -e {resolved}", check=False)
        return result.returncode == 0

    async def stat(self, relative_path: str) -> FileStat:
        resolved = self._resolve_path(relative_path)
        full_path = posixpath.normpath(posixpath.join("/", resolved))
        await self._ensure_connected()
        assert self._transport is not None

        sftp = await self._transport.get_sftp()
        try:
            attrs = await sftp.stat(full_path)
            import stat as stat_mod

            return FileStat(
                is_file=stat_mod.S_ISREG(attrs.permissions or 0),
                is_directory=stat_mod.S_ISDIR(attrs.permissions or 0),
                size=attrs.size or 0,
                modified=attrs.mtime or 0.0,
            )
        except Exception as e:
            raise BackendError(
                f"Failed to stat path: {relative_path}",
                ErrorCode.READ_FAILED,
                str(e),
            ) from e

    def scope(
        self, scope_path: str, config: ScopeConfig | None = None
    ) -> object:
        from agent_backend.backends.scoped import ScopedFilesystemBackend

        scoped = ScopedFilesystemBackend(self, scope_path, config)  # type: ignore[arg-type]
        self._active_scopes.add(scoped)
        return scoped

    async def on_child_destroyed(self, child: object) -> None:
        self._active_scopes.discard(child)

    async def list_active_scopes(self) -> list[str]:
        return [getattr(s, "scope_path", "") for s in self._active_scopes]

    async def get_mcp_transport(self, scope_path: str | None = None) -> object:
        from agent_backend.mcp_integration.transport import create_backend_mcp_transport

        transport = await create_backend_mcp_transport(self, scope_path)
        self._closeables.add(transport)
        return transport

    async def get_mcp_client(self, scope_path: str | None = None) -> object:
        from agent_backend.mcp_integration.client import create_remote_mcp_client

        mcp_host = self._mcp_host_override or self._host
        mcp_port = self._mcp_port
        effective_root = (
            posixpath.join(self._root_dir, scope_path) if scope_path else self._root_dir
        )
        client = await create_remote_mcp_client(
            url=f"http://{mcp_host}:{mcp_port}",
            auth_token=self._auth_token or "",
            root_dir=effective_root,
            scope_path=scope_path,
        )
        self._closeables.add(client)
        return client

    async def destroy(self) -> None:
        if self._reconnect_task:
            self._reconnect_task.cancel()
            self._reconnect_task = None

        for closeable in list(self._closeables):
            try:
                await closeable.close()
            except Exception:
                pass
        self._closeables.clear()

        if self._transport:
            await self._transport.close()
            self._transport = None

        self._active_scopes.clear()
        self._status_manager.set_status(ConnectionStatus.DESTROYED)
        self._status_manager.clear_listeners()
