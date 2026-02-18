"""Local filesystem backend implementation.

Executes commands and file operations on the local machine.
"""

from __future__ import annotations

import asyncio
import os
import os.path
import shutil
from typing import TYPE_CHECKING

from agent_backend.backends.path_validation import (
    validate_absolute_within_root,
    validate_within_boundary,
)
from agent_backend.backends.status import ConnectionStatusManager
from agent_backend.safety import is_command_safe, is_dangerous
from agent_backend.types import (
    BackendError,
    BackendType,
    ConnectionStatus,
    DangerousOperationError,
    ErrorCode,
    FileStat,
    IsolationMode,
    LocalFilesystemBackendConfig,
    ShellPreference,
)

if TYPE_CHECKING:
    from agent_backend.backends.base import Closeable
    from agent_backend.backends.scoped import ScopedFilesystemBackend
    from agent_backend.backends.status import StatusChangeCallback, Unsubscribe
    from agent_backend.types import ExecOptions, ReadOptions, ScopeConfig


class LocalFilesystemBackend:
    """Local filesystem backend implementation.

    Executes commands and file operations on the local machine using OS-level APIs.
    """

    def __init__(self, config: LocalFilesystemBackendConfig) -> None:
        self._type = BackendType.LOCAL_FILESYSTEM
        self._root_dir = os.path.abspath(config.root_dir)
        self._shell = config.shell
        self._isolation = config.isolation
        self._prevent_dangerous = config.prevent_dangerous
        self._on_dangerous_operation = config.on_dangerous_operation
        self._max_output_length = config.max_output_length
        self._status_manager = ConnectionStatusManager(ConnectionStatus.CONNECTED)
        self._active_scopes: set[ScopedFilesystemBackend] = set()
        self._closeables: set[Closeable] = set()

        # Ensure root dir exists
        os.makedirs(self._root_dir, exist_ok=True)

        # Detect actual isolation method
        self._actual_isolation = self._detect_isolation()

        if self._isolation == IsolationMode.BWRAP and self._actual_isolation != IsolationMode.BWRAP:
            raise BackendError(
                "bwrap isolation requested but bubblewrap is not installed.",
                ErrorCode.MISSING_UTILITIES,
                "bwrap",
            )

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

    def _detect_isolation(self) -> IsolationMode:
        if self._isolation != IsolationMode.AUTO:
            return self._isolation
        if shutil.which("bwrap"):
            return IsolationMode.BWRAP
        return IsolationMode.SOFTWARE

    def _detect_shell(self) -> str:
        if self._shell != ShellPreference.AUTO:
            return self._shell
        if shutil.which("bash"):
            return "bash"
        return "sh"

    def _resolve_path(self, relative_path: str) -> str:
        combined = validate_within_boundary(relative_path, self._root_dir)
        return os.path.abspath(combined)

    def _build_env(
        self, cwd: str, custom_env: dict[str, str] | None = None
    ) -> dict[str, str]:
        env = {**os.environ, "HOME": cwd}
        if custom_env:
            env.update(custom_env)
        return env

    async def exec(
        self, command: str, options: ExecOptions | None = None
    ) -> str | bytes:
        if not command.strip():
            raise BackendError("Command cannot be empty", ErrorCode.EMPTY_COMMAND)

        if self._prevent_dangerous:
            if is_dangerous(command):
                error = DangerousOperationError(command)
                if self._on_dangerous_operation and callable(self._on_dangerous_operation):
                    self._on_dangerous_operation(command)
                    return ""
                raise error

            safety_check = is_command_safe(command)
            if not safety_check.safe:
                raise BackendError(
                    safety_check.reason or "Command failed safety check",
                    ErrorCode.UNSAFE_COMMAND,
                    command,
                )

        if self._actual_isolation == IsolationMode.BWRAP:
            return await self._exec_with_bwrap(command, options)
        return await self._exec_direct(command, options)

    async def _exec_with_bwrap(
        self, command: str, options: ExecOptions | None = None
    ) -> str | bytes:
        shell = self._detect_shell()
        encoding = options.encoding if options else "utf8"
        requested_cwd = options.cwd if options else self._root_dir
        if not requested_cwd:
            requested_cwd = self._root_dir

        validate_absolute_within_root(requested_cwd, self._root_dir)

        relative_cwd = os.path.relpath(requested_cwd, self._root_dir)
        bwrap_cwd = (
            f"/tmp/agentbe-workspace/{relative_cwd}"
            if relative_cwd != "."
            else "/tmp/agentbe-workspace"
        )

        env = self._build_env(bwrap_cwd, options.env if options else None)

        bwrap_args = [
            "bwrap",
            "--ro-bind", "/usr", "/usr",
            "--ro-bind", "/lib", "/lib",
            "--ro-bind", "/lib64", "/lib64",
            "--ro-bind", "/bin", "/bin",
            "--ro-bind", "/sbin", "/sbin",
            "--bind", self._root_dir, "/tmp/agentbe-workspace",
            "--chdir", bwrap_cwd,
            "--unshare-all",
            "--share-net",
            "--die-with-parent",
            "--dev", "/dev",
            "--proc", "/proc",
            "--tmpfs", "/tmp",
            "--",
            shell, "-c", command,
        ]

        return await self._run_process(bwrap_args, env, encoding, command)

    async def _exec_direct(
        self, command: str, options: ExecOptions | None = None
    ) -> str | bytes:
        shell = self._detect_shell()
        cwd = (options.cwd if options and options.cwd else self._root_dir) or self._root_dir
        env = self._build_env(cwd, options.env if options else None)
        encoding = options.encoding if options else "utf8"

        return await self._run_process(
            [shell, "-c", command], env, encoding, command, cwd=cwd
        )

    async def _run_process(
        self,
        args: list[str],
        env: dict[str, str],
        encoding: str,
        command: str,
        cwd: str | None = None,
    ) -> str | bytes:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=cwd,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode == 0:
            if encoding == "buffer":
                return stdout
            output = stdout.decode("utf-8").strip()
            if self._max_output_length and len(output) > self._max_output_length:
                truncated_length = self._max_output_length - 50
                output = (
                    f"{output[:truncated_length]}\n\n"
                    f"... [Output truncated. Full output was {len(output)} characters, "
                    f"showing first {truncated_length}]"
                )
            return output
        else:
            error_msg = stderr.decode("utf-8").strip() or stdout.decode("utf-8").strip()
            raise BackendError(
                f"Command execution failed with exit code {proc.returncode}: {error_msg}",
                ErrorCode.EXEC_FAILED,
                command,
            )

    async def read(
        self, relative_path: str, options: ReadOptions | None = None
    ) -> str | bytes:
        full_path = self._resolve_path(relative_path)
        encoding = options.encoding if options else "utf8"

        try:
            if encoding == "buffer":
                with open(full_path, "rb") as f:
                    return f.read()
            with open(full_path, encoding="utf-8") as f:
                return f.read()
        except OSError as e:
            raise BackendError(
                f"Failed to read file: {relative_path}",
                ErrorCode.READ_FAILED,
                str(e),
            ) from e

    async def write(self, relative_path: str, content: str | bytes) -> None:
        full_path = self._resolve_path(relative_path)

        try:
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            if isinstance(content, bytes):
                with open(full_path, "wb") as f:
                    f.write(content)
            else:
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(content)
        except OSError as e:
            raise BackendError(
                f"Failed to write file: {relative_path}",
                ErrorCode.WRITE_FAILED,
                str(e),
            ) from e

    async def rename(self, old_path: str, new_path: str) -> None:
        full_old = self._resolve_path(old_path)
        full_new = self._resolve_path(new_path)

        try:
            os.makedirs(os.path.dirname(full_new), exist_ok=True)
            os.rename(full_old, full_new)
        except OSError as e:
            raise BackendError(
                f"Failed to rename {old_path} to {new_path}",
                ErrorCode.WRITE_FAILED,
                str(e),
            ) from e

    async def rm(
        self, relative_path: str, *, recursive: bool = False, force: bool = False
    ) -> None:
        full_path = self._resolve_path(relative_path)

        try:
            if recursive:
                if os.path.isdir(full_path):
                    shutil.rmtree(full_path)
                elif os.path.exists(full_path):
                    os.remove(full_path)
                elif not force:
                    raise FileNotFoundError(f"Path not found: {relative_path}")
            else:
                if os.path.isdir(full_path):
                    os.rmdir(full_path)
                elif os.path.exists(full_path):
                    os.remove(full_path)
                elif not force:
                    raise FileNotFoundError(f"Path not found: {relative_path}")
        except FileNotFoundError as e:
            if not force:
                raise BackendError(
                    f"Failed to delete: {relative_path}",
                    ErrorCode.WRITE_FAILED,
                    "File not found",
                ) from e
        except OSError as e:
            raise BackendError(
                f"Failed to delete: {relative_path}",
                ErrorCode.WRITE_FAILED,
                str(e),
            ) from e

    async def readdir(self, relative_path: str) -> list[str]:
        full_path = self._resolve_path(relative_path)

        try:
            return sorted(os.listdir(full_path))
        except OSError as e:
            raise BackendError(
                f"Failed to read directory: {relative_path}",
                ErrorCode.LS_FAILED,
                str(e),
            ) from e

    async def mkdir(self, relative_path: str, *, recursive: bool = True) -> None:
        full_path = self._resolve_path(relative_path)

        try:
            os.makedirs(full_path, exist_ok=recursive)
        except OSError as e:
            raise BackendError(
                f"Failed to create directory: {relative_path}",
                ErrorCode.WRITE_FAILED,
                str(e),
            ) from e

    async def touch(self, relative_path: str) -> None:
        full_path = self._resolve_path(relative_path)
        if not os.path.exists(full_path):
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            open(full_path, "w").close()

    async def exists(self, relative_path: str) -> bool:
        full_path = self._resolve_path(relative_path)
        return os.path.exists(full_path)

    async def stat(self, relative_path: str) -> FileStat:
        full_path = self._resolve_path(relative_path)

        try:
            st = os.stat(full_path)
            import stat as stat_mod

            return FileStat(
                is_file=stat_mod.S_ISREG(st.st_mode),
                is_directory=stat_mod.S_ISDIR(st.st_mode),
                size=st.st_size,
                modified=st.st_mtime,
            )
        except OSError as e:
            raise BackendError(
                f"Failed to stat path: {relative_path}",
                ErrorCode.READ_FAILED,
                str(e),
            ) from e

    def scope(
        self, scope_path: str, config: ScopeConfig | None = None
    ) -> ScopedFilesystemBackend:
        from agent_backend.backends.scoped import ScopedFilesystemBackend

        scoped = ScopedFilesystemBackend(self, scope_path, config)
        self._active_scopes.add(scoped)
        return scoped

    async def on_child_destroyed(self, child: object) -> None:
        self._active_scopes.discard(child)  # type: ignore[arg-type]

    async def list_active_scopes(self) -> list[str]:
        return [scope.scope_path for scope in self._active_scopes]

    async def get_mcp_transport(self, scope_path: str | None = None) -> object:
        from agent_backend.mcp_integration.transport import create_backend_mcp_transport

        transport = await create_backend_mcp_transport(self, scope_path)
        self._closeables.add(transport)
        return transport

    async def get_mcp_client(self, scope_path: str | None = None) -> object:
        from agent_backend.mcp_integration.client import create_mcp_client

        effective_root = (
            os.path.join(self._root_dir, scope_path) if scope_path else self._root_dir
        )
        client = await create_mcp_client(
            backend_type="local",
            root_dir=effective_root,
            isolation=self._isolation.value,
            shell=self._shell.value,
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
        self._status_manager.set_status(ConnectionStatus.DESTROYED)
        self._status_manager.clear_listeners()
