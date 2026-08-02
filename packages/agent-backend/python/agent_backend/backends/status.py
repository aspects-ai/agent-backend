"""Connection status management with subscription callbacks."""

from __future__ import annotations

import time
from collections.abc import Callable

from agent_backend.types import ConnectionStatus, StatusChangeEvent

StatusChangeCallback = Callable[[StatusChangeEvent], None]
Unsubscribe = Callable[[], None]


class ConnectionStatusManager:
    """Internal helper that encapsulates connection status state and listener management.

    Used by all backend implementations.
    """

    def __init__(self, initial_status: ConnectionStatus) -> None:
        self._status = initial_status
        self._listeners: set[StatusChangeCallback] = set()

    @property
    def status(self) -> ConnectionStatus:
        return self._status

    def set_status(
        self,
        new_status: ConnectionStatus,
        error: Exception | None = None,
    ) -> None:
        """Transition to a new status and notify listeners.

        No-op if the new status is the same as the current status.
        """
        if self._status == new_status:
            return

        event = StatusChangeEvent(
            from_status=self._status,
            to_status=new_status,
            timestamp=time.time(),
            error=error,
        )

        self._status = new_status

        for listener in list(self._listeners):
            try:
                listener(event)
            except Exception:
                # Swallow listener errors to prevent cascading failures
                pass

    def on_status_change(self, cb: StatusChangeCallback) -> Unsubscribe:
        """Subscribe to status changes. Returns an unsubscribe function."""
        self._listeners.add(cb)

        def unsubscribe() -> None:
            self._listeners.discard(cb)

        return unsubscribe

    def clear_listeners(self) -> None:
        """Remove all listeners. Called during destroy."""
        self._listeners.clear()
