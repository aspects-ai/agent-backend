#!/bin/bash

# ConstellationFS Remote Backend Entrypoint
# Configures and starts SSH server and MCP server for filesystem access

set -e

echo "🌟 Starting ConstellationFS Remote Backend..."

# Storage configuration
STORAGE_TYPE="${STORAGE_TYPE:-local}"

# MCP server configuration
MCP_PORT="${MCP_PORT:-3001}"
MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN:-}"

# Configure SSH users from environment
MCP_USER="root"
if [ -n "$SSH_USERS" ]; then
  echo "👤 Configuring SSH users..."
  IFS=',' read -ra USERS <<< "$SSH_USERS"
  for user_config in "${USERS[@]}"; do
    IFS=':' read -ra USER <<< "$user_config"
    username="${USER[0]}"
    password="${USER[1]}"

    echo "   Creating user: $username"
    useradd -m -s /bin/bash "$username" 2>/dev/null || echo "   User $username already exists"
    echo "$username:$password" | chpasswd

    # Add user to sudo group for admin operations
    usermod -aG sudo "$username"

    # Create user workspace
    mkdir -p "/workspace/$username"
    chown "$username:$username" "/workspace/$username"
    chmod 755 "/workspace/$username"

    # Set up SSH directory for user (for optional pubkey auth)
    mkdir -p "/home/$username/.ssh"
    touch "/home/$username/.ssh/authorized_keys"
    chown -R "$username:$username" "/home/$username/.ssh"
    chmod 700 "/home/$username/.ssh"
    chmod 600 "/home/$username/.ssh/authorized_keys"

    # Use first user for MCP server
    if [ "$MCP_USER" = "root" ]; then
      MCP_USER="$username"
    fi
  done
fi

# Ensure password authentication is enabled (fix for some base images)
sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^ChallengeResponseAuthentication no/ChallengeResponseAuthentication yes/' /etc/ssh/sshd_config
echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config.d/password.conf 2>/dev/null || true

# Add SSH keys if provided
if [ -n "$SSH_PUBLIC_KEY" ]; then
  echo "🔑 Adding SSH public key..."
  echo "$SSH_PUBLIC_KEY" >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
fi

# Mount SSH keys from volume if available
if [ -f /keys/id_rsa.pub ]; then
  echo "🔑 Adding mounted SSH key..."
  cat /keys/id_rsa.pub >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
fi

# Set workspace root from environment
WORKSPACE_ROOT="${WORKSPACE_ROOT:-/constellationfs}"
echo "📁 Setting workspace root to: $WORKSPACE_ROOT"
mkdir -p "$WORKSPACE_ROOT"
chmod 755 "$WORKSPACE_ROOT"

# Set ownership of workspace root based on MCP user
if [ "$MCP_USER" != "root" ]; then
  chown "$MCP_USER:$MCP_USER" "$WORKSPACE_ROOT"
fi

# Create default workspace structure
mkdir -p /workspace/projects /workspace/temp /workspace/shared
chmod -R 755 /workspace

# Set ownership based on MCP user
if [ "$MCP_USER" != "root" ]; then
  chown -R "$MCP_USER:$MCP_USER" /workspace
else
  chown -R root:root /workspace
fi

# Enable logging if requested
if [ "$ENABLE_LOGGING" = "true" ]; then
  echo "📝 Enabling SSH logging..."
  sed -i 's/#LogLevel INFO/LogLevel VERBOSE/' /etc/ssh/sshd_config
fi

# Start MCP server if auth token is provided
if [ -n "$MCP_AUTH_TOKEN" ]; then
  echo "🔌 Starting MCP server on port $MCP_PORT..."

  # Start MCP server in background
  if [ "$MCP_USER" != "root" ]; then
    su - "$MCP_USER" -c "npx constellationfs mcp-server \
      --workspaceRoot $WORKSPACE_ROOT \
      --http \
      --port $MCP_PORT \
      --authToken $MCP_AUTH_TOKEN" &
  else
    npx constellationfs mcp-server \
      --workspaceRoot "$WORKSPACE_ROOT" \
      --http \
      --port "$MCP_PORT" \
      --authToken "$MCP_AUTH_TOKEN" &
  fi

  MCP_PID=$!
  echo "   MCP server started (PID: $MCP_PID)"
else
  echo "⚠️  MCP_AUTH_TOKEN not set, MCP server will not start"
fi

echo ""
echo "✅ ConstellationFS Remote Backend is ready!"
echo "📡 Connection details:"
echo "   SSH Port: 22"
if [ -n "$MCP_AUTH_TOKEN" ]; then
  echo "   MCP Port: $MCP_PORT"
fi
echo "   Default user: root"
echo "   Default password: constellation"
echo "   Workspace: $WORKSPACE_ROOT"
echo ""
echo "🔧 Test connection:"
echo "   ssh root@localhost -p <mapped-port>"
if [ -n "$MCP_AUTH_TOKEN" ]; then
  echo "   curl http://localhost:$MCP_PORT/health"
fi
echo ""
echo "🚀 Starting SSH daemon..."
echo ""

# Execute the main command (SSH daemon)
exec "$@"
