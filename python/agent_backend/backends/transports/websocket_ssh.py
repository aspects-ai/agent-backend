"""WebSocket SSH transport for remote backends.

Establishes SSH connections tunneled over WebSocket for file operations
and command execution on remote hosts.
"""

from __future__ import annotations

import logging

import asyncssh
import websockets

logger = logging.getLogger(__name__)


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

        # Create an SSH connection over the WebSocket using asyncssh
        # asyncssh supports custom transports via its tunnel parameter
        self._ssh_conn = await asyncssh.connect(
            self._host,
            tunnel=self._ws,
            known_hosts=None,
            username="agent",
            password=self._auth_token or "",
            keepalive_interval=self._keepalive_interval,
            keepalive_count_max=self._keepalive_count_max,
        )

        self._connected = True

    async def get_sftp(self) -> asyncssh.SFTPClient:
        """Get or create an SFTP session."""
        if self._sftp is None or self._sftp.is_closing():
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
