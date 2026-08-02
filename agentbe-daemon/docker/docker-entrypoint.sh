#!/bin/bash

# agentbe-daemon Docker Entrypoint
#
# When CMD is "agent-backend daemon" (the default):
#   1. Runs /docker-entrypoint.d/*.sh init scripts (if any)
#   2. Translates environment variables to CLI arguments
#   3. Starts the daemon via exec (becomes PID 1)
#
# For any other command (e.g., bash), runs it directly via exec.
#
# Environment variables (all optional, CLI has defaults):
#   WORKSPACE_ROOT    - Root directory to serve (default: /var/workspace)
#   PORT              - HTTP/WebSocket server port (default: 3001)
#   AUTH_TOKEN        - Bearer token for MCP and SSH-WS authentication (unified)
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

# Only run daemon setup when CMD is "agent-backend daemon"
if [ "$1" = "agent-backend" ] && [ "${2:-}" = "daemon" ]; then
  shift 2

  WORKSPACE_ROOT="${WORKSPACE_ROOT:-/var/workspace}"
  mkdir -p "$WORKSPACE_ROOT"
  chmod 755 "$WORKSPACE_ROOT"

  # Run init scripts from /docker-entrypoint.d/ (nginx-style)
  if [ -d /docker-entrypoint.d ] && [ "$(ls -A /docker-entrypoint.d/ 2>/dev/null)" ]; then
    echo "Running initialization scripts..."
    find "/docker-entrypoint.d/" -follow -type f -print | sort -V | while read -r f; do
      case "$f" in
        *.sh)
          if [ -x "$f" ]; then
            echo "  Running $f"
            "$f"
          else
            echo "  Ignoring $f (not executable)"
          fi
          ;;
        *) echo "  Ignoring $f";;
      esac
    done
  fi

  echo "Starting agentbe-daemon..."
  echo "  Workspace: $WORKSPACE_ROOT"

  # Build CLI args from environment variables
  DAEMON_ARGS=(--rootDir "$WORKSPACE_ROOT")

  if [ -n "$PORT" ]; then
    DAEMON_ARGS+=(--port "$PORT")
    echo "  Port: $PORT"
  fi

  # Unified auth token (used for both MCP and SSH-WS)
  if [ -n "$AUTH_TOKEN" ]; then
    DAEMON_ARGS+=(--auth-token "$AUTH_TOKEN")
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
    echo "  SSH-WS: enabled (ws://0.0.0.0:${PORT:-3001}/ssh)"
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
  cd "$WORKSPACE_ROOT"

  # Dev hot-reload mode
  if [ "$USE_LOCAL_BUILD" = "1" ] && [ -d /app/agent-backend/src ]; then
    echo "Hot-reload enabled (tsx --watch)"
    exec tsx --watch /app/agent-backend/src/cli.ts daemon "${DAEMON_ARGS[@]}" "$@"
  else
    exec agent-backend daemon "${DAEMON_ARGS[@]}" "$@"
  fi
fi

# Non-daemon command (e.g., bash) — run it directly
exec "$@"
