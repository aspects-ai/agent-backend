"""Console-based operations logger."""

from __future__ import annotations

import sys
from datetime import UTC, datetime

from agent_backend.logging.types import OperationLogEntry
from agent_backend.types import LoggingMode


class ConsoleOperationsLogger:
    """Console-based operations logger.

    Logs workspace operations to stderr with formatted output.
    """

    def __init__(self, mode: LoggingMode = LoggingMode.STANDARD) -> None:
        self._mode = mode

    @property
    def mode(self) -> LoggingMode:
        return self._mode

    def log(self, entry: OperationLogEntry) -> None:
        timestamp = datetime.fromtimestamp(entry.timestamp, tz=UTC).isoformat()
        prefix = f"[{timestamp}] [{entry.user_id}/{entry.workspace_name}]"
        status = "\u2713" if entry.success else "\u2717"
        duration = f"{entry.duration_ms:.0f}ms"

        main_line = f"{prefix} {status} {entry.operation}: {entry.command} ({duration})"

        if entry.success:
            print(main_line, file=sys.stderr)
        else:
            print(main_line, file=sys.stderr)

        if entry.operation == "exec":
            if entry.stdout:
                print(f"  stdout: {self._truncate(entry.stdout, 200)}", file=sys.stderr)
            if entry.stderr:
                print(f"  stderr: {self._truncate(entry.stderr, 200)}", file=sys.stderr)

        if not entry.success and entry.error:
            print(f"  error: {entry.error}", file=sys.stderr)

    @staticmethod
    def _truncate(s: str, max_length: int) -> str:
        single_line = s.replace("\n", "\\n")
        if len(single_line) <= max_length:
            return single_line
        return f"{single_line[:max_length]}..."
