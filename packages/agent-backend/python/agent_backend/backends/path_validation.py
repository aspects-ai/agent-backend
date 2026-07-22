"""Path resolution and escape prevention.

Implements the three-case resolution logic from docs/filepaths.md:
1. Relative paths: resolved relative to boundary
2. Absolute paths matching boundary: used directly
3. Absolute paths not matching boundary: treated as relative (leading slash stripped)
"""

from __future__ import annotations

import os.path
import posixpath
from types import ModuleType

from agent_backend.types import PathEscapeError


def _get_pathmod(use_posix: bool) -> ModuleType:
    """Return the appropriate path module."""
    return posixpath if use_posix else os.path


def validate_within_boundary(
    relative_path: str,
    boundary: str,
    *,
    use_posix: bool = False,
) -> str:
    """Validate that a path stays within a boundary and return combined path.

    Args:
        relative_path: The path to validate (can be relative or absolute).
        boundary: The boundary path (root_dir or scope_path).
        use_posix: If True, always use posixpath. If False, use os.path.

    Returns:
        Combined path (boundary + relative_path) or the absolute path if it
        matches boundary.

    Raises:
        PathEscapeError: If path escapes boundary.
    """
    pathmod = _get_pathmod(use_posix)
    boundary_resolved = _resolve(boundary, pathmod)

    # Check if path is absolute and already within boundary
    if pathmod.isabs(relative_path):
        path_resolved = _resolve(relative_path, pathmod)

        sep = pathmod.sep
        if path_resolved.startswith(boundary_resolved + sep) or path_resolved == boundary_resolved:
            return path_resolved

        # Absolute path doesn't match boundary - treat as relative (strip leading slashes)

    # Strip leading slash from absolute paths
    normalized_path = relative_path
    if pathmod.isabs(relative_path):
        normalized_path = relative_path.lstrip("/")

    # Combine boundary with relative path
    combined = pathmod.join(boundary, normalized_path)

    # Normalize (remove .. and .) by resolving
    resolved = _resolve(combined, pathmod)

    # Validate stays within boundary
    sep = pathmod.sep
    if not resolved.startswith(boundary_resolved + sep) and resolved != boundary_resolved:
        raise PathEscapeError(relative_path)

    return pathmod.normpath(combined)


def validate_absolute_within_root(
    absolute_path: str,
    root_dir: str,
    *,
    use_posix: bool = False,
) -> None:
    """Validate that an absolute path stays within a root directory.

    Args:
        absolute_path: The absolute path to validate.
        root_dir: The root directory boundary.
        use_posix: If True, always use posixpath.

    Raises:
        PathEscapeError: If path is outside root_dir.
    """
    pathmod = _get_pathmod(use_posix)
    normalized_path = _resolve(absolute_path, pathmod)
    normalized_root = _resolve(root_dir, pathmod)

    sep = pathmod.sep
    if not normalized_path.startswith(normalized_root + sep) and normalized_path != normalized_root:
        raise PathEscapeError(absolute_path)


def _resolve(p: str, pathmod: ModuleType) -> str:
    """Resolve a path to its normalized absolute form."""
    return pathmod.normpath(pathmod.join("/", p))
