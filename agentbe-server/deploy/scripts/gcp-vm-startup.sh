#!/bin/bash
# ConstellationFS Remote Backend - GCP VM Startup Script
# This script is passed to GCP VM as a startup script

set -e

echo "=== ConstellationFS GCP VM Setup Starting ==="

# These are replaced by the deploy tool with actual values
MCP_AUTH_TOKEN="__MCP_AUTH_TOKEN__"
MCP_PORT="__MCP_PORT__"
SSH_USERS="__SSH_USERS__"
WORKSPACE_ROOT="__WORKSPACE_ROOT__"

# Install Docker
echo "[1/5] Installing Docker..."
curl -fsSL https://get.docker.com | sh

# Start Docker service
systemctl enable docker
systemctl start docker

# Wait for Docker to be ready
echo "[2/5] Waiting for Docker to start..."
sleep 5

# Pull the ConstellationFS remote backend image
echo "[3/5] Pulling ConstellationFS remote backend image..."
docker pull ghcr.io/aspects-ai/constellation-remote:latest

# Create workspace directory
mkdir -p /workspace
chmod 755 /workspace

# Run the container
echo "[4/5] Starting ConstellationFS container..."
docker run -d \
  --restart unless-stopped \
  --name constellation-remote \
  -p 2222:22 \
  -p ${MCP_PORT}:${MCP_PORT} \
  -v /workspace:/workspace \
  -e MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN}" \
  -e MCP_PORT="${MCP_PORT}" \
  -e SSH_USERS="${SSH_USERS}" \
  -e WORKSPACE_ROOT="${WORKSPACE_ROOT}" \
  ghcr.io/aspects-ai/constellation-remote:latest

# Wait for container to start
sleep 5

# Check container status
echo "[5/5] Verifying container status..."
if docker ps | grep -q constellation-remote; then
  echo "[OK] ConstellationFS container is running"
else
  echo "[ERROR] Container failed to start. Checking logs..."
  docker logs constellation-remote
  exit 1
fi

echo ""
echo "=== ConstellationFS GCP VM Setup Complete ==="
echo "Services available:"
echo "  SSH: port 2222"
echo "  MCP: port ${MCP_PORT}"
echo ""
