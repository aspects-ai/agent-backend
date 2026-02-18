"""Tests for MCP module."""

from __future__ import annotations

import pytest

from agent_backend.mcp_integration.client import create_http_transport
from agent_backend.mcp_integration.transport import (
    _StdioTransportWrapper,
    create_backend_mcp_transport,
)
from agent_backend.types import BackendError, BackendType


class TestMCPTransportCreation:
    async def test_unsupported_backend_type(self):
        class FakeBackend:
            type = "unsupported"

        with pytest.raises(BackendError):
            await create_backend_mcp_transport(FakeBackend())

    def test_stdio_wrapper_close(self):
        wrapper = _StdioTransportWrapper(None)
        import asyncio

        asyncio.get_event_loop().run_until_complete(wrapper.close())

    async def test_local_transport_creation(self):
        class FakeLocalBackend:
            type = BackendType.LOCAL_FILESYSTEM
            root_dir = "/workspace"
            _isolation = "software"
            _shell = "bash"

        transport = await create_backend_mcp_transport(FakeLocalBackend())
        assert hasattr(transport, "params")
        assert transport.params.command == "agent-backend"
        assert "--rootDir" in transport.params.args
        assert "/workspace" in transport.params.args
        assert "--local-only" in transport.params.args
        assert "--isolation" in transport.params.args
        assert "--shell" in transport.params.args

    async def test_local_transport_with_scope(self):
        class FakeLocalBackend:
            type = BackendType.LOCAL_FILESYSTEM
            root_dir = "/workspace"
            _isolation = None
            _shell = None

        transport = await create_backend_mcp_transport(FakeLocalBackend(), scope_path="sub")
        assert "/workspace/sub" in transport.params.args

    async def test_memory_transport_creation(self):
        class FakeMemoryBackend:
            type = BackendType.MEMORY
            root_dir = "/"

        transport = await create_backend_mcp_transport(FakeMemoryBackend())
        assert hasattr(transport, "params")
        assert "--backend" in transport.params.args
        assert "memory" in transport.params.args

    async def test_memory_transport_with_scope(self):
        class FakeMemoryBackend:
            type = BackendType.MEMORY
            root_dir = "/"

        transport = await create_backend_mcp_transport(FakeMemoryBackend(), scope_path="data")
        assert "//data" in transport.params.args

    async def test_remote_transport_creation(self):
        class FakeRemoteConfig:
            mcp_server_host_override = None
            host = "example.com"
            mcp_port = 3001
            auth_token = "tok"

        class FakeRemoteBackend:
            type = BackendType.REMOTE_FILESYSTEM
            root_dir = "/remote"
            config = FakeRemoteConfig()

        transport = await create_backend_mcp_transport(FakeRemoteBackend())
        assert hasattr(transport, "url")
        assert transport.url == "http://example.com:3001"
        assert transport.auth_token == "tok"
        assert transport.root_dir == "/remote"

    async def test_remote_transport_with_mcp_host_override(self):
        class FakeRemoteConfig:
            mcp_server_host_override = "override.host"
            host = "original.host"
            mcp_port = 4000
            auth_token = "tok"

        class FakeRemoteBackend:
            type = BackendType.REMOTE_FILESYSTEM
            root_dir = "/remote"
            config = FakeRemoteConfig()

        transport = await create_backend_mcp_transport(FakeRemoteBackend())
        assert transport.url == "http://override.host:4000"


class TestStdioTransportWrapper:
    def test_wrapper_params(self):
        wrapper = _StdioTransportWrapper("test-params")
        assert wrapper.params == "test-params"
        assert wrapper._process is None

    async def test_wrapper_close_with_process(self):
        class FakeProcess:
            def terminate(self):
                self.terminated = True

        wrapper = _StdioTransportWrapper(None)
        wrapper._process = FakeProcess()
        await wrapper.close()
        assert wrapper._process.terminated

    async def test_wrapper_close_with_failing_process(self):
        class BadProcess:
            def terminate(self):
                raise RuntimeError("already dead")

        wrapper = _StdioTransportWrapper(None)
        wrapper._process = BadProcess()
        # Should not raise
        await wrapper.close()


class TestHttpTransport:
    def test_create_http_transport(self):
        transport = create_http_transport(
            url="http://example.com",
            auth_token="token123",
            root_dir="/root",
            scope_path="scope/path",
        )
        assert transport.url == "http://example.com"
        assert transport.auth_token == "token123"
        assert transport.root_dir == "/root"
        assert transport.scope_path == "scope/path"

    def test_create_http_transport_no_scope(self):
        transport = create_http_transport(
            url="http://example.com",
            auth_token="tok",
            root_dir="/root",
        )
        assert transport.scope_path is None

    async def test_http_transport_close(self):
        transport = create_http_transport(
            url="http://example.com",
            auth_token="tok",
            root_dir="/root",
        )
        # Should be a no-op but not raise
        await transport.close()
