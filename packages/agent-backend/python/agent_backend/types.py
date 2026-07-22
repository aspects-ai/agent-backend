"""Error classes, enums, and core types for agent-backend."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal


class ErrorCode(StrEnum):
    """Error codes for backend operations."""

    EMPTY_COMMAND = "EMPTY_COMMAND"
    UNSAFE_COMMAND = "UNSAFE_COMMAND"
    EXEC_FAILED = "EXEC_FAILED"
    EXEC_ERROR = "EXEC_ERROR"
    READ_FAILED = "READ_FAILED"
    WRITE_FAILED = "WRITE_FAILED"
    LS_FAILED = "LS_FAILED"
    PATH_ESCAPE_ATTEMPT = "PATH_ESCAPE_ATTEMPT"
    MISSING_UTILITIES = "MISSING_UTILITIES"
    INVALID_CONFIGURATION = "INVALID_CONFIGURATION"
    DANGEROUS_OPERATION = "DANGEROUS_OPERATION"
    CONNECTION_CLOSED = "CONNECTION_CLOSED"
    KEY_NOT_FOUND = "KEY_NOT_FOUND"
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"


class ConnectionStatus(StrEnum):
    """Connection status for backends."""

    CONNECTED = "connected"
    CONNECTING = "connecting"
    DISCONNECTED = "disconnected"
    RECONNECTING = "reconnecting"
    DESTROYED = "destroyed"


class BackendType(StrEnum):
    """Backend type identifier."""

    LOCAL_FILESYSTEM = "local-filesystem"
    REMOTE_FILESYSTEM = "remote-filesystem"
    MEMORY = "memory"


class LoggingMode(StrEnum):
    """Logging mode for workspace operations."""

    STANDARD = "standard"
    VERBOSE = "verbose"


class IsolationMode(StrEnum):
    """Isolation mode for command execution."""

    AUTO = "auto"
    BWRAP = "bwrap"
    SOFTWARE = "software"
    NONE = "none"


class ShellPreference(StrEnum):
    """Shell preference for command execution."""

    BASH = "bash"
    SH = "sh"
    AUTO = "auto"


class BackendError(Exception):
    """Base error class for all backend operations."""

    def __init__(
        self,
        message: str,
        code: str,
        operation: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.operation = operation


class DangerousOperationError(BackendError):
    """Error thrown when a dangerous operation is blocked."""

    def __init__(self, command: str) -> None:
        super().__init__(
            f"Dangerous operation blocked: {command}",
            ErrorCode.DANGEROUS_OPERATION,
            command,
        )


class PathEscapeError(BackendError):
    """Error thrown when a path attempts to escape the scope boundary."""

    def __init__(self, path: str) -> None:
        super().__init__(
            f"Path escapes scope boundary: {path}",
            ErrorCode.PATH_ESCAPE_ATTEMPT,
            path,
        )


class NotImplementedBackendError(BackendError):
    """Error thrown when an operation is not supported by the backend type."""

    def __init__(self, operation: str, backend_type: str) -> None:
        super().__init__(
            f"Operation '{operation}' not implemented for {backend_type} backend",
            ErrorCode.NOT_IMPLEMENTED,
            operation,
        )


@dataclass
class StatusChangeEvent:
    """Event emitted when connection status changes."""

    from_status: ConnectionStatus
    to_status: ConnectionStatus
    timestamp: float
    error: Exception | None = None


@dataclass
class FileStat:
    """File metadata information."""

    is_file: bool
    is_directory: bool
    size: int
    modified: float


@dataclass
class ReconnectionConfig:
    """Configuration for automatic reconnection."""

    enabled: bool = True
    max_retries: int = 5
    initial_delay_ms: int = 1000
    max_delay_ms: int = 30000
    backoff_multiplier: float = 2.0


@dataclass
class ScopeConfig:
    """Configuration for creating a scoped backend."""

    env: dict[str, str] = field(default_factory=dict)
    operations_logger: object | None = None


@dataclass
class ExecOptions:
    """Options for exec command."""

    encoding: Literal["utf8", "buffer"] = "utf8"
    cwd: str | None = None
    env: dict[str, str] | None = None


@dataclass
class ReadOptions:
    """Options for read command."""

    encoding: Literal["utf8", "buffer"] = "utf8"


@dataclass
class LocalFilesystemBackendConfig:
    """Configuration for LocalFilesystemBackend."""

    root_dir: str
    isolation: IsolationMode = IsolationMode.AUTO
    prevent_dangerous: bool = True
    on_dangerous_operation: object | None = None
    max_output_length: int | None = None
    shell: ShellPreference = ShellPreference.AUTO
    validate_utils: bool = False


@dataclass
class RemoteFilesystemBackendConfig:
    """Configuration for RemoteFilesystemBackend."""

    root_dir: str
    host: str
    auth_token: str | None = None
    port: int | None = None
    mcp_port: int = 3001
    mcp_server_host_override: str | None = None
    operation_timeout_ms: int | None = None
    keepalive_interval_ms: int = 30000
    keepalive_count_max: int = 3
    reconnection: ReconnectionConfig = field(default_factory=ReconnectionConfig)
    isolation: IsolationMode = IsolationMode.AUTO
    prevent_dangerous: bool = True
    max_output_length: int | None = None


@dataclass
class MemoryBackendConfig:
    """Configuration for MemoryBackend."""

    root_dir: str = "/"
    initial_data: dict[str, str | bytes] | None = None


OperationType = Literal[
    "exec",
    "write",
    "touch",
    "mkdir",
    "delete",
    "read",
    "readdir",
    "exists",
    "stat",
    "rename",
    "rm",
]

MODIFYING_OPERATIONS: frozenset[str] = frozenset(
    {"exec", "write", "touch", "mkdir", "delete", "rename", "rm"}
)
