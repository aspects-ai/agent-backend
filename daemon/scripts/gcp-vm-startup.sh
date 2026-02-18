#!/bin/bash
# AgentBackend Remote Backend - GCP VM Startup Script
# This script is passed to GCP VM as a startup script

set -e

echo "=== AgentBackend GCP VM Setup Starting ==="

# These are replaced by the deploy tool with actual values
AUTH_TOKEN="__AUTH_TOKEN__"
PORT="__PORT__"
SSH_USERS="__SSH_USERS__"
WORKSPACE_ROOT="__WORKSPACE_ROOT__"
SSH_PORT="__SSH_PORT__"
SSH_HOST_PORT="__SSH_HOST_PORT__"

# Install Docker
echo "[1/5] Installing Docker..."
curl -fsSL https://get.docker.com | sh

# Start Docker service
systemctl enable docker
systemctl start docker

# Wait for Docker to be ready
echo "[2/5] Waiting for Docker to start..."
sleep 5

# Pull the AgentBackend remote backend image
echo "[3/5] Pulling AgentBackend remote backend image..."
docker pull ghcr.io/aspects-ai/agentbe-daemon:latest

# Create workspace directory
mkdir -p /var/workspace
chmod 755 /var/workspace

# Run the container
echo "[4/5] Starting AgentBackend container..."
docker run -d \
  --restart unless-stopped \
  --name agentbe-daemon \
  -p ${SSH_HOST_PORT}:${SSH_PORT} \
  -p ${PORT}:${PORT} \
  -v /var/workspace:/var/workspace \
  -e AUTH_TOKEN="${AUTH_TOKEN}" \
  -e PORT="${PORT}" \
  -e SSH_PORT="${SSH_PORT}" \
  -e SSH_USERS="${SSH_USERS}" \
  -e WORKSPACE_ROOT="${WORKSPACE_ROOT}" \
  ghcr.io/aspects-ai/agentbe-daemon:latest

# Wait for container to start
sleep 5

# Check container status
echo "[5/5] Verifying container status..."
if docker ps | grep -q agentbe-daemon; then
  echo "[OK] AgentBackend container is running"
else
  echo "[ERROR] Container failed to start. Checking logs..."
  docker logs agentbe-daemon
  exit 1
fi

echo ""
echo "=== AgentBackend GCP VM Setup Complete ==="
echo "Services available:"
echo "  SSH: port ${SSH_HOST_PORT}"
echo "  MCP: port ${PORT}"
echo ""
