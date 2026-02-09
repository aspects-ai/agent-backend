#!/bin/bash

# agentbe-daemon Docker Entrypoint
# Translates environment variables to CLI arguments
#
# Environment variables (all optional, CLI has defaults):
#   WORKSPACE_ROOT    - Root directory to serve (default: /var/workspace)
#   MCP_PORT          - HTTP/WebSocket server port (default: 3001)
#   AUTH_TOKEN        - Bearer token for MCP and SSH-WS authentication (unified)
#   MCP_AUTH_TOKEN    - (legacy) Alias for AUTH_TOKEN
#   SSH_HOST_KEY      - Path to SSH host key for SSH-WS
#   SHELL_TYPE        - Shell to use: bash, sh, auto
#   DISABLE_SSH_WS    - Set to "true" to disable SSH-over-WebSocket
#
# Conventional SSH (opt-in, requires openssh-server):
#   CONVENTIONAL_SSH  - Set to "true" to enable conventional sshd
#   SSH_PORT          - SSH daemon port (default: 22)
#   SSH_USERS         - Comma-separated user:pass pairs
#   SSH_PUBLIC_KEY    - SSH public key to add to authorized_keys
#
# Can also mount /keys/authorized_keys for SSH key auth

set -e

# Only WORKSPACE_ROOT needs a default since rootDir is required by CLI
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/var/workspace}"

# Create workspace directory
mkdir -p "$WORKSPACE_ROOT"
chmod 755 "$WORKSPACE_ROOT"

echo "Starting agentbe-daemon..."
echo "  Workspace: $WORKSPACE_ROOT"

# Build command arguments - only add flags if env vars are set
DAEMON_ARGS=(--rootDir "$WORKSPACE_ROOT")

if [ -n "$MCP_PORT" ]; then
  DAEMON_ARGS+=(--mcp-port "$MCP_PORT")
  echo "  Port: $MCP_PORT"
fi

# Unified auth token (used for both MCP and SSH-WS)
if [ -n "$AUTH_TOKEN" ]; then
  DAEMON_ARGS+=(--mcp-auth-token "$AUTH_TOKEN")
  echo "  Auth: enabled (unified token)"
elif [ -n "$MCP_AUTH_TOKEN" ]; then
  # Legacy env var name
  DAEMON_ARGS+=(--mcp-auth-token "$MCP_AUTH_TOKEN")
  echo "  Auth: enabled (unified token)"
fi

if [ -n "$SSH_HOST_KEY" ]; then
  DAEMON_ARGS+=(--ssh-host-key "$SSH_HOST_KEY")
  echo "  SSH Host Key: $SSH_HOST_KEY"
fi

if [ -n "$SHELL_TYPE" ]; then
  DAEMON_ARGS+=(--shell "$SHELL_TYPE")
  echo "  Shell: $SHELL_TYPE"
fi

# SSH-WS is enabled by default
if [ "$DISABLE_SSH_WS" = "true" ]; then
  DAEMON_ARGS+=(--disable-ssh-ws)
  echo "  SSH-WS: disabled"
else
  echo "  SSH-WS: enabled (ws://0.0.0.0:${MCP_PORT:-3001}/ssh)"
fi

# Conventional SSH (opt-in)
if [ "$CONVENTIONAL_SSH" = "true" ]; then
  DAEMON_ARGS+=(--conventional-ssh)
  echo "  Conventional SSH: enabled"

  if [ -n "$SSH_PORT" ]; then
    DAEMON_ARGS+=(--ssh-port "$SSH_PORT")
    echo "    Port: $SSH_PORT"
  fi

  if [ -n "$SSH_USERS" ]; then
    DAEMON_ARGS+=(--ssh-users "$SSH_USERS")
    echo "    Users: $SSH_USERS"
  fi

  if [ -n "$SSH_PUBLIC_KEY" ]; then
    DAEMON_ARGS+=(--ssh-public-key "$SSH_PUBLIC_KEY")
    echo "    Key: provided via env"
  fi

  if [ -f /keys/authorized_keys ]; then
    DAEMON_ARGS+=(--ssh-authorized-keys /keys/authorized_keys)
    echo "    Keys: /keys/authorized_keys"
  fi
fi

echo ""

# Ensure we're in a valid directory
cd "$WORKSPACE_ROOT"

# Use local mounted build with nodemon for hot-reload in dev mode
if [ "$USE_LOCAL_BUILD" = "1" ] && [ -d /app/agent-backend ]; then
  echo "🔥 Hot-reload enabled (watching /app/agent-backend)"
  exec npx nodemon \
    --watch /app/agent-backend \
    --ext js \
    --exec "cd $WORKSPACE_ROOT && node /app/agent-backend/bin/agent-backend.js daemon ${DAEMON_ARGS[*]}"
else
  exec agent-backend daemon "${DAEMON_ARGS[@]}"
fi
