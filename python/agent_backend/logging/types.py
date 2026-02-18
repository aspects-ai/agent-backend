"""Logging types and protocols."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from agent_backend.types import MODIFYING_OPERATIONS, LoggingMode, OperationType


@dataclass
class OperationLogEntry:
    """Entry representing a logged operation."""

    timestamp: float
    operation: OperationType
    user_id: str
    workspace_name: str
    workspace_path: str
    command: str
    success: bool
    duration_ms: float
    stdout: str | None = None
    stderr: str | None = None
    exit_code: int | None = None
    error: str | None = None


class OperationsLogger(Protocol):
    """Interface for workspace operations logger."""

    @property
    def mode(self) -> LoggingMode: ...

    def log(self, entry: OperationLogEntry) -> None: ...


def should_log_operation(operation: str, mode: LoggingMode) -> bool:
    """Determine if an operation should be logged based on mode."""
    if mode == LoggingMode.VERBOSE:
        return True
    return operation in MODIFYING_OPERATIONS
