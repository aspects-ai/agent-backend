"""Agent Backend - Python Client Library.

Provides file operations, command execution, and MCP tool access for AI agents.
"""

from agent_backend.adapters.vercel import VercelAIAdapter
from agent_backend.backends.local import LocalFilesystemBackend
from agent_backend.backends.memory import MemoryBackend
from agent_backend.backends.remote import RemoteFilesystemBackend
from agent_backend.backends.scoped import ScopedFilesystemBackend, ScopedMemoryBackend
from agent_backend.backends.status import ConnectionStatusManager
from agent_backend.logging.array import ArrayOperationsLogger
from agent_backend.logging.console import ConsoleOperationsLogger
from agent_backend.logging.types import OperationLogEntry, OperationsLogger, should_log_operation
from agent_backend.pool import BackendPoolManager, PoolManagerConfig, PoolStats
from agent_backend.safety import SafetyConfig, SafetyResult, is_command_safe, is_dangerous
from agent_backend.types import (
    BackendError,
    BackendType,
    ConnectionStatus,
    DangerousOperationError,
    ErrorCode,
    ExecOptions,
    FileStat,
    IsolationMode,
    LocalFilesystemBackendConfig,
    LoggingMode,
    MemoryBackendConfig,
    NotImplementedBackendError,
    PathEscapeError,
    ReadOptions,
    ReconnectionConfig,
    RemoteFilesystemBackendConfig,
    ScopeConfig,
    ShellPreference,
    StatusChangeEvent,
)

__version__ = "0.8.9"

__all__ = [
    "ArrayOperationsLogger",
    "BackendError",
    "BackendPoolManager",
    "BackendType",
    "ConnectionStatus",
    "ConnectionStatusManager",
    "ConsoleOperationsLogger",
    "DangerousOperationError",
    "ErrorCode",
    "ExecOptions",
    "FileStat",
    "IsolationMode",
    "LocalFilesystemBackend",
    "LocalFilesystemBackendConfig",
    "LoggingMode",
    "MemoryBackend",
    "MemoryBackendConfig",
    "NotImplementedBackendError",
    "OperationLogEntry",
    "OperationsLogger",
    "PathEscapeError",
    "PoolManagerConfig",
    "PoolStats",
    "ReadOptions",
    "ReconnectionConfig",
    "RemoteFilesystemBackend",
    "RemoteFilesystemBackendConfig",
    "SafetyConfig",
    "SafetyResult",
    "ScopeConfig",
    "ScopedFilesystemBackend",
    "ScopedMemoryBackend",
    "ShellPreference",
    "StatusChangeEvent",
    "VercelAIAdapter",
    "__version__",
    "is_command_safe",
    "is_dangerous",
    "should_log_operation",
]
