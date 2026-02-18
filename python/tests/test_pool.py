"""Tests for BackendPoolManager."""

from __future__ import annotations

import pytest

from agent_backend.backends.memory import MemoryBackend
from agent_backend.pool import BackendPoolManager, PoolManagerConfig, PoolStats
from agent_backend.types import ConnectionStatus


def make_backend(**kwargs):
    return MemoryBackend()


class TestBackendPoolManager:
    @pytest.fixture
    def pool(self):
        config = PoolManagerConfig(backend_factory=make_backend)
        return BackendPoolManager(config)

    async def test_acquire_with_key(self, pool):
        backend, release = await pool.acquire_backend(key="user1")
        assert backend is not None
        assert backend.status == ConnectionStatus.CONNECTED
        release()

    async def test_acquire_reuses_backend(self, pool):
        b1, r1 = await pool.acquire_backend(key="user1")
        r1()
        b2, r2 = await pool.acquire_backend(key="user1")
        r2()
        assert b1 is b2

    async def test_acquire_without_key_creates_fresh(self, pool):
        b1, r1 = await pool.acquire_backend()
        b2, r2 = await pool.acquire_backend()
        assert b1 is not b2
        r1()
        r2()

    async def test_with_backend(self, pool):
        await pool.with_backend(
            lambda b: b.write("key", "value"),
            key="user1",
        )

    async def test_with_backend_releases_on_error(self, pool):
        with pytest.raises(ValueError):
            await pool.with_backend(
                lambda b: (_ for _ in ()).throw(ValueError("test")),
                key="user1",
            )
        stats = pool.get_stats()
        assert stats.active_backends == 0

    async def test_get_stats(self, pool):
        _b1, r1 = await pool.acquire_backend(key="user1")
        _b2, r2 = await pool.acquire_backend(key="user2")

        stats = pool.get_stats()
        assert stats.total_backends == 2
        assert stats.active_backends == 2
        assert stats.idle_backends == 0

        r1()
        stats = pool.get_stats()
        assert stats.active_backends == 1
        assert stats.idle_backends == 1
        r2()

    async def test_destroy_all(self, pool):
        b1, r1 = await pool.acquire_backend(key="user1")
        r1()
        await pool.destroy_all()
        assert b1.status == ConnectionStatus.DESTROYED

    async def test_different_keys_different_backends(self, pool):
        b1, r1 = await pool.acquire_backend(key="user1")
        b2, r2 = await pool.acquire_backend(key="user2")
        assert b1 is not b2
        r1()
        r2()

    async def test_acquire_replaces_destroyed_backend(self, pool):
        b1, r1 = await pool.acquire_backend(key="user1")
        r1()
        await b1.destroy()
        b2, r2 = await pool.acquire_backend(key="user1")
        assert b1 is not b2
        r2()

    async def test_with_backend_no_key(self, pool):
        await pool.with_backend(
            lambda b: b.write("key", "value"),
        )

    async def test_config_override(self):
        configs_received = []

        def factory(**kwargs):
            configs_received.append(kwargs)
            return MemoryBackend()

        config = PoolManagerConfig(
            backend_factory=factory,
            default_config={"root_dir": "/default"},
        )
        pool = BackendPoolManager(config)
        _, release = await pool.acquire_backend(
            key="user1",
            config_override={"extra": "value"},
        )
        release()
        assert configs_received[0] == {"root_dir": "/default", "extra": "value"}

    async def test_stats_backends_by_key(self, pool):
        _, r1 = await pool.acquire_backend(key="user1")
        _, r2 = await pool.acquire_backend(key="user2")
        stats = pool.get_stats()
        assert "user1" in stats.backends_by_key
        assert "user2" in stats.backends_by_key
        r1()
        r2()

    async def test_destroy_all_handles_errors(self):
        class BadBackend:
            status = ConnectionStatus.CONNECTED

            async def destroy(self):
                raise RuntimeError("fail")

        config = PoolManagerConfig(backend_factory=lambda **kw: BadBackend())
        pool = BackendPoolManager(config)
        _, r = await pool.acquire_backend(key="k")
        r()
        # Should not raise
        await pool.destroy_all()

    async def test_release_without_key_is_noop(self, pool):
        _, release = await pool.acquire_backend()
        release()  # Should be a no-op lambda


class TestPoolStats:
    def test_pool_stats_fields(self):
        stats = PoolStats(
            total_backends=3,
            active_backends=2,
            idle_backends=1,
            backends_by_key={"a": 1, "b": 1, "c": 1},
        )
        assert stats.total_backends == 3
        assert stats.active_backends == 2
        assert stats.idle_backends == 1
