"""WebSocket SSH transport for remote backends.

Establishes SSH connections tunneled over WebSocket for file operations
and command execution on remote hosts.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import asyncssh
import websockets

logger = logging.getLogger(__name__)


class _WebSocketTransport(asyncio.Transport):
    """asyncio.Transport that bridges writes to a WebSocket connection."""

    def __init__(
        self,
        ws: websockets.ClientConnection,
        protocol: asyncio.Protocol,
    ) -> None:
        super().__init__()
        self._ws = ws
        self._protocol = protocol
        self._closing = False
        self._read_task: asyncio.Task[None] | None = None
        self._pending_writes: set[asyncio.Task[None]] = set()

    def get_extra_info(self, name: str, default: Any = None) -> Any:
        if name == "peername":
            remote = getattr(self._ws, "remote_address", None)
            return remote if remote else ("websocket", 0)
        return default

    def is_closing(self) -> bool:
        return self._closing

    def write(self, data: bytes) -> None:
        if self._closing:
            return
        task = asyncio.ensure_future(self._ws.send(data))
        self._pending_writes.add(task)
        task.add_done_callback(self._pending_writes.discard)

    def write_eof(self) -> None:
        pass

    def can_write_eof(self) -> bool:
        return False

    def close(self) -> None:
        if self._closing:
            return
        self._closing = True
        if self._read_task:
            self._read_task.cancel()
        task = asyncio.ensure_future(self._ws.close())
        self._pending_writes.add(task)
        task.add_done_callback(self._pending_writes.discard)

    def abort(self) -> None:
        self.close()

    def start_reading(self, protocol: asyncio.Protocol) -> None:
        """Start reading from WebSocket and feeding data to the protocol."""
        self._read_task = asyncio.ensure_future(self._read_loop(protocol))

    async def _read_loop(self, protocol: asyncio.Protocol) -> None:
        try:
            async for message in self._ws:
                if isinstance(message, bytes):
                    protocol.data_received(message)
                else:
                    protocol.data_received(message.encode())
        except websockets.ConnectionClosed:
            protocol.connection_lost(None)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            protocol.connection_lost(exc)


class _WebSocketTunnel:
    """Wraps a WebSocket as an asyncssh-compatible tunnel.

    asyncssh's ``tunnel`` parameter expects an object with
    ``create_connection(protocol_factory, host, port)`` that returns
    ``(transport, protocol)``.  This class bridges that interface to a
    WebSocket connection.
    """

    def __init__(self, ws: websockets.ClientConnection) -> None:
        self._ws = ws
        self._close_task: asyncio.Task[None] | None = None

    def close(self) -> None:
        self._close_task = asyncio.ensure_future(self._ws.close())

    async def create_connection(
        self,
        protocol_factory: Any,
        host: str,
        port: int,
    ) -> tuple[_WebSocketTransport, Any]:
        protocol = protocol_factory()
        transport = _WebSocketTransport(self._ws, protocol)
        protocol.connection_made(transport)
        transport.start_reading(protocol)
        return transport, protocol


class WebSocketSSHTransport:
    """SSH-over-WebSocket transport.

    Wraps a WebSocket connection that tunnels SSH traffic to the agentbe-daemon.
    """

    def __init__(
        self,
        host: str,
        port: int,
        auth_token: str | None = None,
        keepalive_interval: float = 30.0,
        keepalive_count_max: int = 3,
    ) -> None:
        self._host = host
        self._port = port
        self._auth_token = auth_token
        self._keepalive_interval = keepalive_interval
        self._keepalive_count_max = keepalive_count_max
        self._ws: websockets.ClientConnection | None = None
        self._ssh_conn: asyncssh.SSHClientConnection | None = None
        self._sftp: asyncssh.SFTPClient | None = None
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected

    async def connect(self) -> None:
        """Establish WebSocket connection and SSH session over it."""
        protocol = "ws"
        headers = {}
        if self._auth_token:
            headers["Authorization"] = f"Bearer {self._auth_token}"

        ws_url = f"{protocol}://{self._host}:{self._port}/ssh"
        self._ws = await websockets.connect(ws_url, additional_headers=headers)

        # Create an SSH connection tunneled over the WebSocket.
        # We wrap the WebSocket in a _WebSocketTunnel that implements the
        # create_connection() interface asyncssh expects for its tunnel param.
        tunnel = _WebSocketTunnel(self._ws)
        self._ssh_conn = await asyncssh.connect(
            self._host,
            tunnel=tunnel,
            known_hosts=None,
            username="agent",
            password=self._auth_token or "",
            keepalive_interval=self._keepalive_interval,
            keepalive_count_max=self._keepalive_count_max,
        )

        self._connected = True

    async def get_sftp(self) -> asyncssh.SFTPClient:
        """Get or create an SFTP session."""
        if self._sftp is None:
            if not self._ssh_conn:
                raise ConnectionError("SSH connection not established")
            self._sftp = await self._ssh_conn.start_sftp_client()
        return self._sftp

    async def run(self, command: str, **kwargs: object) -> asyncssh.SSHCompletedProcess:
        """Run a command over SSH."""
        if not self._ssh_conn:
            raise ConnectionError("SSH connection not established")
        return await self._ssh_conn.run(command, **kwargs)

    async def close(self) -> None:
        """Close all connections."""
        self._connected = False
        if self._sftp:
            self._sftp.exit()
            self._sftp = None
        if self._ssh_conn:
            self._ssh_conn.close()
            await self._ssh_conn.wait_closed()
            self._ssh_conn = None
        if self._ws:
            await self._ws.close()
            self._ws = None
