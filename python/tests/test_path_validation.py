"""Tests for path validation."""

from __future__ import annotations

import pytest

from agent_backend.backends.path_validation import (
    validate_absolute_within_root,
    validate_within_boundary,
)
from agent_backend.types import PathEscapeError


class TestValidateWithinBoundary:
    def test_relative_path(self):
        result = validate_within_boundary("file.txt", "/workspace")
        assert result == "/workspace/file.txt"

    def test_relative_subdir(self):
        result = validate_within_boundary("subdir/file.txt", "/workspace")
        assert result == "/workspace/subdir/file.txt"

    def test_dot_path(self):
        result = validate_within_boundary(".", "/workspace")
        assert result == "/workspace"

    def test_absolute_matching_boundary(self):
        result = validate_within_boundary("/workspace/file.txt", "/workspace")
        assert result == "/workspace/file.txt"

    def test_absolute_matching_boundary_subdir(self):
        result = validate_within_boundary("/workspace/a/b/c", "/workspace")
        assert result == "/workspace/a/b/c"

    def test_absolute_not_matching_treated_as_relative(self):
        result = validate_within_boundary("/file.txt", "/workspace")
        assert result == "/workspace/file.txt"

    def test_absolute_etc_passwd_treated_as_relative(self):
        result = validate_within_boundary("/etc/passwd", "/workspace")
        assert result == "/workspace/etc/passwd"

    def test_escape_via_parent_directory(self):
        with pytest.raises(PathEscapeError):
            validate_within_boundary("../etc/passwd", "/workspace")

    def test_escape_via_complex_traversal(self):
        with pytest.raises(PathEscapeError):
            validate_within_boundary("a/b/../../../../etc", "/workspace")

    def test_escape_via_root_traversal(self):
        with pytest.raises(PathEscapeError):
            validate_within_boundary("../../..", "/workspace")

    def test_posix_mode(self):
        result = validate_within_boundary("file.txt", "/workspace", use_posix=True)
        assert result == "/workspace/file.txt"

    def test_boundary_exact_match(self):
        result = validate_within_boundary("/workspace", "/workspace")
        assert result == "/workspace"


class TestValidateWithinBoundaryPosix:
    """Tests for validate_within_boundary with use_posix=True.

    The remote backend always uses posix mode, so all three path
    resolution cases and escape prevention must work in this mode.
    """

    def test_posix_relative_path(self):
        result = validate_within_boundary("file.txt", "/workspace", use_posix=True)
        assert result == "/workspace/file.txt"

    def test_posix_relative_subdir(self):
        result = validate_within_boundary("subdir/file.txt", "/workspace", use_posix=True)
        assert result == "/workspace/subdir/file.txt"

    def test_posix_absolute_matching_boundary(self):
        result = validate_within_boundary("/workspace/file.txt", "/workspace", use_posix=True)
        assert result == "/workspace/file.txt"

    def test_posix_absolute_matching_boundary_subdir(self):
        result = validate_within_boundary("/workspace/a/b/c", "/workspace", use_posix=True)
        assert result == "/workspace/a/b/c"

    def test_posix_absolute_not_matching_treated_as_relative(self):
        result = validate_within_boundary("/etc/passwd", "/workspace", use_posix=True)
        assert result == "/workspace/etc/passwd"

    def test_posix_escape_via_parent_directory(self):
        with pytest.raises(PathEscapeError):
            validate_within_boundary("../etc/passwd", "/workspace", use_posix=True)

    def test_posix_escape_via_complex_traversal(self):
        with pytest.raises(PathEscapeError):
            validate_within_boundary("a/b/../../../../etc", "/workspace", use_posix=True)


class TestValidateAbsoluteWithinRoot:
    def test_valid_path(self):
        validate_absolute_within_root("/workspace/file.txt", "/workspace")

    def test_path_equals_root(self):
        validate_absolute_within_root("/workspace", "/workspace")

    def test_path_outside_root(self):
        with pytest.raises(PathEscapeError):
            validate_absolute_within_root("/etc/passwd", "/workspace")
