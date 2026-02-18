"""Backend pool manager for connection reuse.

Provides key-based pooling of backend instances for stateless servers.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, TypeVar

from agent_backend.types import ConnectionStatus

logger = logging.getLogger(__name__)

T = TypeVar("T")
R = TypeVar("R")


@dataclass
class PoolManagerConfig:
    """Configuration for BackendPoolManager."""

    backend_factory: Callable[..., Any]
    default_config: dict[str, Any] = field(default_factory=dict)
    idle_timeout_ms: int = 5 * 60 * 1000
    enable_periodic_cleanup: bool = False
    cleanup_interval_ms: int = 60 * 1000


@dataclass
class PoolStats:
    """Pool statistics."""

    total_backends: int
    active_backends: int
    idle_backends: int
    backends_by_key: dict[str, int]


@dataclass
class _PooledBackend:
    backend: Any
    in_use: int = 0
    last_used: float = 0.0


class BackendPoolManager:
    """Generic backend pool manager.

    Manages pooled connections for any Backend type with automatic cleanup.
    """

    def __init__(self, config: PoolManagerConfig) -> None:
        self._config = config
        self._backends: dict[str, _PooledBackend] = {}
        self._cleanup_task: asyncio.Task[None] | None = None

        if config.enable_periodic_cleanup:
            self._start_periodic_cleanup()

    async def acquire_backend(
        self,
        key: str | None = None,
        config_override: dict[str, Any] | None = None,
    ) -> tuple[Any, Callable[[], None]]:
        """Acquire a backend from the pool.

        Args:
            key: Key for backend identification. None creates non-pooled instance.
            config_override: Per-request configuration overrides.

        Returns:
            Tuple of (backend, release_function).
        """
        merged_config = {**self._config.default_config, **(config_override or {})}

        if key is None:
            backend = self._config.backend_factory(**merged_config)
            return backend, lambda: None

        pooled = self._backends.get(key)

        if not pooled or pooled.backend.status != ConnectionStatus.CONNECTED:
            backend = self._config.backend_factory(**merged_config)
            pooled = _PooledBackend(backend=backend, in_use=0, last_used=time.time())
            self._backends[key] = pooled

        pooled.in_use += 1
        pooled.last_used = time.time()

        def release() -> None:
            pooled.in_use -= 1
            pooled.last_used = time.time()

        return pooled.backend, release

    async def with_backend(
        self,
        fn: Callable[..., Any],
        key: str | None = None,
        config_override: dict[str, Any] | None = None,
    ) -> Any:
        """Execute function with backend from pool (automatic cleanup).

        Args:
            fn: Async function to execute with backend.
            key: Key for backend identification.
            config_override: Per-request configuration overrides.

        Returns:
            Result of function execution.
        """
        backend, release = await self.acquire_backend(key, config_override)
        try:
            return await fn(backend)
        finally:
            release()

    def get_stats(self) -> PoolStats:
        """Get pool statistics."""
        active = 0
        idle = 0
        by_key: dict[str, int] = {}

        for key, pooled in self._backends.items():
            by_key[key] = 1
            if pooled.in_use > 0:
                active += 1
            else:
                idle += 1

        return PoolStats(
            total_backends=len(self._backends),
            active_backends=active,
            idle_backends=idle,
            backends_by_key=by_key,
        )

    async def destroy_all(self) -> None:
        """Destroy all backends in pool."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            self._cleanup_task = None

        for key, pooled in list(self._backends.items()):
            try:
                await pooled.backend.destroy()
            except Exception:
                logger.error("Error destroying backend for key %s", key)
            del self._backends[key]

    def _start_periodic_cleanup(self) -> None:
        """Start periodic cleanup of idle backends."""
        async def _run() -> None:
            while True:
                await asyncio.sleep(self._config.cleanup_interval_ms / 1000.0)
                await self._cleanup_idle_backends()

        self._cleanup_task = asyncio.create_task(_run())

    async def _cleanup_idle_backends(self) -> None:
        """Cleanup idle backends that exceed timeout."""
        now = time.time()
        timeout_s = self._config.idle_timeout_ms / 1000.0

        to_cleanup: list[str] = []
        for key, pooled in self._backends.items():
            if pooled.in_use == 0 and (now - pooled.last_used) > timeout_s:
                to_cleanup.append(key)

        for key in to_cleanup:
            pooled = self._backends.pop(key, None)
            if pooled:
                try:
                    await pooled.backend.destroy()
                except Exception:
                    logger.error("Error destroying idle backend for key %s", key)
