"""Shared fixtures for tests."""

from __future__ import annotations

import pytest

from agent_backend.backends.local import LocalFilesystemBackend
from agent_backend.backends.memory import MemoryBackend
from agent_backend.types import LocalFilesystemBackendConfig, MemoryBackendConfig


@pytest.fixture
def tmp_workspace(tmp_path):
    """Create a temporary workspace directory."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    return str(workspace)


@pytest.fixture
def memory_backend():
    """Create a MemoryBackend with some initial data."""
    config = MemoryBackendConfig(
        root_dir="/",
        initial_data={
            "file1.txt": "hello",
            "file2.txt": "world",
            "dir/nested.txt": "nested content",
            "dir/deep/file.txt": "deep content",
        },
    )
    return MemoryBackend(config)


@pytest.fixture
def empty_memory_backend():
    """Create an empty MemoryBackend."""
    return MemoryBackend()


@pytest.fixture
def local_backend(tmp_workspace):
    """Create a LocalFilesystemBackend."""
    config = LocalFilesystemBackendConfig(
        root_dir=tmp_workspace,
        prevent_dangerous=True,
    )
    return LocalFilesystemBackend(config)
