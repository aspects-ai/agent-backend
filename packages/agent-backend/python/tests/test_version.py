"""Test basic package functionality."""

import agent_backend


def test_package_imports() -> None:
    """Test that package can be imported."""
    assert agent_backend is not None


def test_all_exports() -> None:
    """Test that all public API exports are accessible."""
    assert agent_backend.MemoryBackend is not None
    assert agent_backend.LocalFilesystemBackend is not None
    assert agent_backend.RemoteFilesystemBackend is not None
    assert agent_backend.BackendError is not None
    assert agent_backend.ConnectionStatus is not None
    assert agent_backend.BackendType is not None
