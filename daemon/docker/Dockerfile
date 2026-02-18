# agentbe-daemon
# Extensible Docker image for the agent-backend daemon service.
#
# Extension points:
#   - FROM + RUN: Install additional packages (pip, npm, apt-get)
#   - /docker-entrypoint.d/*.sh: Runtime init scripts (run before daemon starts)
#   - CMD override: Replace the default command (e.g., docker run agentbe-daemon bash)
#
# Build args:
#   - AGENTBE_VERSION: Package version or "local" for local build
#   - INCLUDE_SSHD: Set to "true" to include openssh-server for conventional SSH

FROM ubuntu:22.04

# Build arg to include sshd (for conventional SSH support)
ARG INCLUDE_SSHD=true

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install base packages (including Python 3 for AI agent workspaces)
RUN apt-get update && apt-get install -y \
    sudo \
    curl \
    wget \
    tree \
    ripgrep \
    git \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Optionally install openssh-server for conventional SSH support
RUN if [ "$INCLUDE_SSHD" = "true" ]; then \
      apt-get update && apt-get install -y openssh-server && rm -rf /var/lib/apt/lists/*; \
    fi

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install global npm packages
RUN npm i -g pnpm && \
    npm i -g tsx

# Install agent-backend from local build (for development) or npm (for production)
ARG AGENTBE_VERSION=local
RUN --mount=type=bind,source=typescript,target=/tmp/agent-backend-src \
    if [ "$AGENTBE_VERSION" = "local" ]; then \
      mkdir -p /tmp/agent-backend && \
      cp /tmp/agent-backend-src/package.json /tmp/agent-backend/ && \
      cp -r /tmp/agent-backend-src/dist /tmp/agent-backend/dist && \
      cp -r /tmp/agent-backend-src/bin /tmp/agent-backend/bin && \
      cd /tmp/agent-backend && npm install && npm link; \
    else \
      npm i -g agent-backend@${AGENTBE_VERSION}; \
    fi

# Create workspace and entrypoint hooks directory
RUN mkdir -p /var/workspace /docker-entrypoint.d
WORKDIR /var/workspace

# Set up SSH configuration (only if sshd is installed for conventional SSH)
RUN if [ "$INCLUDE_SSHD" = "true" ]; then \
      mkdir -p /var/run/sshd /run/sshd && \
      ssh-keygen -A && \
      sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config && \
      sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
      sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config && \
      sed -i 's/#Port 22/Port 22/' /etc/ssh/sshd_config && \
      sed -i 's/#AddressFamily any/AddressFamily any/' /etc/ssh/sshd_config && \
      sed -i 's/#ListenAddress 0.0.0.0/ListenAddress 0.0.0.0/' /etc/ssh/sshd_config && \
      mkdir -p /etc/ssh/sshd_config.d && \
      echo 'PasswordAuthentication yes' > /etc/ssh/sshd_config.d/agentbe.conf && \
      echo 'PermitRootLogin yes' >> /etc/ssh/sshd_config.d/agentbe.conf && \
      echo 'ChallengeResponseAuthentication yes' >> /etc/ssh/sshd_config.d/agentbe.conf && \
      echo 'MaxSessions 64' >> /etc/ssh/sshd_config.d/agentbe.conf && \
      echo 'MaxStartups 10:30:100' >> /etc/ssh/sshd_config.d/agentbe.conf && \
      echo 'ClientAliveInterval 60' >> /etc/ssh/sshd_config.d/agentbe.conf && \
      echo 'ClientAliveCountMax 3' >> /etc/ssh/sshd_config.d/agentbe.conf && \
      sed -i 's@session\s*required\s*pam_loginuid.so@session optional pam_loginuid.so@g' /etc/pam.d/sshd && \
      mkdir -p /root/.ssh && \
      chmod 700 /root/.ssh && \
      touch /root/.ssh/authorized_keys && \
      chmod 600 /root/.ssh/authorized_keys && \
      echo 'root:agents' | chpasswd; \
    fi

# Copy entrypoint
COPY daemon/docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Set workspace permissions
RUN chmod 755 /var/workspace && \
    chown -R root:root /var/workspace

# Default ports:
#   - 3001: MCP server (HTTP/WebSocket) + SSH-WS endpoint (ws://host:3001/ssh)
#   - 22: Conventional SSH (only used if CONVENTIONAL_SSH=true)
EXPOSE 3001 22

# Health check for MCP server (uses default port 3001)
# If using custom PORT, override with: --health-cmd "curl -f http://localhost:$PORT/health"
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3001}/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["agent-backend", "daemon"]
