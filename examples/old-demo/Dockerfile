FROM node:18-slim

# Install SSH client, sshpass for password auth, and bash (bash needed for LD_PRELOAD command execution)
RUN apt-get update && apt-get install -y openssh-client sshpass bash && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the local AgentBackend package (for development)
# NOTE: This is development-specific for using file:// dependency
# Production consumers would use published npm package instead
COPY typescript /agent-backend-local

# Copy demo source code (including pre-built native library)
COPY examples/NextJS .

# Fix the AgentBackend dependency path for Docker build
RUN sed -i 's|"agent-backend": "file:../../typescript/"|"agent-backend": "file:/agent-backend-local"|g' package.json

# Install dependencies
RUN npm install

# Build the app
RUN npm run build

# Expose port
EXPOSE 3000

# Default command  
ENTRYPOINT []
CMD ["/usr/local/bin/node", "/app/node_modules/.bin/next", "start"]