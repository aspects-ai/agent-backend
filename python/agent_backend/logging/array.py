"""In-memory array-based operations logger."""

from __future__ import annotations

from agent_backend.logging.types import OperationLogEntry
from agent_backend.types import LoggingMode


class ArrayOperationsLogger:
    """In-memory array-based operations logger.

    Stores all logged operations in a list for later retrieval.
    Useful for testing, debugging, or building audit trails.
    """

    def __init__(self, mode: LoggingMode = LoggingMode.STANDARD) -> None:
        self._mode = mode
        self._entries: list[OperationLogEntry] = []

    @property
    def mode(self) -> LoggingMode:
        return self._mode

    def log(self, entry: OperationLogEntry) -> None:
        self._entries.append(entry)

    def get_entries(self) -> list[OperationLogEntry]:
        """Get all logged entries."""
        return list(self._entries)

    def get_entries_by_operation(
        self, operation: str
    ) -> list[OperationLogEntry]:
        """Get entries filtered by operation type."""
        return [e for e in self._entries if e.operation == operation]

    def get_entries_by_status(self, success: bool) -> list[OperationLogEntry]:
        """Get entries filtered by success status."""
        return [e for e in self._entries if e.success is success]

    @property
    def length(self) -> int:
        """Get the count of logged entries."""
        return len(self._entries)

    def clear(self) -> None:
        """Clear all logged entries."""
        self._entries.clear()

    def get_entries_in_range(
        self, start: float, end: float
    ) -> list[OperationLogEntry]:
        """Get entries within a time range (timestamps as floats)."""
        return [
            e for e in self._entries if start <= e.timestamp <= end
        ]
