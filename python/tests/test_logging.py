"""Tests for operations logging."""

from __future__ import annotations

import time

from agent_backend.logging.array import ArrayOperationsLogger
from agent_backend.logging.console import ConsoleOperationsLogger
from agent_backend.logging.types import OperationLogEntry, should_log_operation
from agent_backend.types import LoggingMode, OperationType


def make_entry(
    operation: OperationType = "exec",
    success: bool = True,
    stdout: str | None = None,
    error: str | None = None,
) -> OperationLogEntry:
    return OperationLogEntry(
        timestamp=time.time(),
        operation=operation,
        user_id="test-user",
        workspace_name="test-ws",
        workspace_path="/tmp/test",
        command="echo hello",
        success=success,
        duration_ms=10.0,
        stdout=stdout,
        error=error,
    )


class TestArrayOperationsLogger:
    def test_log_and_retrieve(self):
        logger = ArrayOperationsLogger()
        entry = make_entry()
        logger.log(entry)
        assert logger.length == 1
        assert logger.get_entries()[0] is entry

    def test_filter_by_operation(self):
        logger = ArrayOperationsLogger()
        logger.log(make_entry(operation="exec"))
        logger.log(make_entry(operation="read"))
        logger.log(make_entry(operation="exec"))

        exec_entries = logger.get_entries_by_operation("exec")
        assert len(exec_entries) == 2

    def test_filter_by_status(self):
        logger = ArrayOperationsLogger()
        logger.log(make_entry(success=True))
        logger.log(make_entry(success=False))

        assert len(logger.get_entries_by_status(True)) == 1
        assert len(logger.get_entries_by_status(False)) == 1

    def test_clear(self):
        logger = ArrayOperationsLogger()
        logger.log(make_entry())
        logger.clear()
        assert logger.length == 0

    def test_mode(self):
        assert ArrayOperationsLogger().mode == LoggingMode.STANDARD
        assert ArrayOperationsLogger(LoggingMode.VERBOSE).mode == LoggingMode.VERBOSE


class TestConsoleOperationsLogger:
    def test_log_success(self, capsys):
        logger = ConsoleOperationsLogger()
        logger.log(make_entry())
        captured = capsys.readouterr()
        assert "\u2713" in captured.err
        assert "exec" in captured.err

    def test_log_failure(self, capsys):
        logger = ConsoleOperationsLogger()
        logger.log(make_entry(success=False, error="something broke"))
        captured = capsys.readouterr()
        assert "\u2717" in captured.err
        assert "something broke" in captured.err

    def test_log_exec_stdout(self, capsys):
        logger = ConsoleOperationsLogger()
        logger.log(make_entry(stdout="output text"))
        captured = capsys.readouterr()
        assert "stdout: output text" in captured.err


class TestShouldLogOperation:
    def test_standard_mode_modifying(self):
        assert should_log_operation("exec", LoggingMode.STANDARD)
        assert should_log_operation("write", LoggingMode.STANDARD)
        assert should_log_operation("mkdir", LoggingMode.STANDARD)

    def test_standard_mode_read(self):
        assert not should_log_operation("read", LoggingMode.STANDARD)
        assert not should_log_operation("readdir", LoggingMode.STANDARD)
        assert not should_log_operation("exists", LoggingMode.STANDARD)

    def test_verbose_mode_all(self):
        assert should_log_operation("read", LoggingMode.VERBOSE)
        assert should_log_operation("exec", LoggingMode.VERBOSE)
        assert should_log_operation("exists", LoggingMode.VERBOSE)
