"""
PyBasic — Interactive CLI chat with an AI agent backed by agent-backend

The agent has full filesystem + exec tools via MCP, just like the NextJS demo
but in a minimal terminal interface using the Python client library.

Usage:
  make pybasic                           # local backend (default)
  BACKEND_TYPE=remote make pybasic       # remote backend (requires daemon)

Environment variables:
  OPENROUTER_API_KEY  - Required. OpenRouter API key
  BACKEND_TYPE        - "local" (default) or "remote"
  ROOT_DIR            - Workspace root (default: /tmp/agentbe-workspace)
  MODEL               - Model ID (default: anthropic/claude-sonnet-4.5)
  REMOTE_HOST         - Remote host (default: localhost)
  REMOTE_PORT         - Remote port (default: 3001)
  AUTH_TOKEN           - Auth token for remote backend
"""

import asyncio
import os
import sys

from chat import run_chat

from agent_backend import (
    ConnectionStatus,
    IsolationMode,
    LocalFilesystemBackend,
    LocalFilesystemBackendConfig,
    RemoteFilesystemBackend,
    RemoteFilesystemBackendConfig,
    VercelAIAdapter,
)

BACKEND_TYPE = os.environ.get("BACKEND_TYPE", "local")
ROOT_DIR = os.environ.get(
    "ROOT_DIR",
    "/var/workspace" if BACKEND_TYPE == "remote" else "/tmp/agentbe-workspace",
)
MODEL = os.environ.get("MODEL", "anthropic/claude-sonnet-4.5")


def create_backend() -> LocalFilesystemBackend | RemoteFilesystemBackend:
    if BACKEND_TYPE == "remote":
        return RemoteFilesystemBackend(
            RemoteFilesystemBackendConfig(
                root_dir=ROOT_DIR,
                host=os.environ.get("REMOTE_HOST", "localhost"),
                port=int(os.environ.get("REMOTE_PORT", "3001")),
                auth_token=os.environ.get("AUTH_TOKEN"),
            )
        )
    return LocalFilesystemBackend(
        LocalFilesystemBackendConfig(
            root_dir=ROOT_DIR,
            isolation=IsolationMode.NONE,
            prevent_dangerous=False,
        )
    )


async def main() -> None:
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("Error: OPENROUTER_API_KEY is required. Set it in .env or export it.", file=sys.stderr)
        sys.exit(1)

    print("\nPyBasic — Agent Backend CLI Chat")
    print(f"Backend: {BACKEND_TYPE} | Root: {ROOT_DIR} | Model: {MODEL}")
    if BACKEND_TYPE == "local":
        print("\x1b[2mSwitch to remote: BACKEND_TYPE=remote make pybasic\x1b[0m\n")
    else:
        print("\x1b[2mSwitch to local:  make pybasic\x1b[0m\n")

    backend = create_backend()

    # Show backend connection status
    status_labels = {
        ConnectionStatus.CONNECTED: "\x1b[32m connected\x1b[0m",
        ConnectionStatus.CONNECTING: "\x1b[33m connecting...\x1b[0m",
        ConnectionStatus.DISCONNECTED: "\x1b[31m disconnected\x1b[0m",
        ConnectionStatus.RECONNECTING: "\x1b[33m reconnecting...\x1b[0m",
        ConnectionStatus.DESTROYED: "\x1b[90m destroyed\x1b[0m",
    }

    def on_status(event):
        label = status_labels.get(event.to_status, f" {event.to_status}")
        sys.stderr.write(f"\n[status]{label}")
        if event.error:
            sys.stderr.write(f" ({event.error})")
        sys.stderr.write("\n")
        sys.stderr.flush()

    backend.on_status_change(on_status)

    # Smoke-test file operations (exercises ssh-over-ws for remote backends)
    await backend.write("test.txt", "Hello World")
    cwd = await backend.exec("pwd")
    files = await backend.readdir(".")
    print(f"Workspace: {cwd.strip()}")
    print(f"Files: {', '.join(files) or '(empty)'}")

    # Get MCP client and list tools
    adapter = VercelAIAdapter(backend)
    session = await adapter.get_mcp_client()
    tools_result = await session.list_tools()
    tool_names = [t.name for t in tools_result.tools]

    sys.stdout.write(f" connected! (tools: {', '.join(tool_names)})\n")
    sys.stdout.flush()

    try:
        await run_chat(model=MODEL, mcp_tools=tools_result.tools, session=session)
    finally:
        print("\nShutting down...")
        await backend.destroy()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
