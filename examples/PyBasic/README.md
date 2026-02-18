# Agent Backend - PyBasic Demo

Minimal CLI chat with an AI agent that has full filesystem and exec tools via MCP — same capabilities as the NextJS demo, just in a terminal using the Python client library.

## Getting Started

### 1. Install Dependencies (from monorepo root)

```bash
make install
```

### 2. Set your API key

```bash
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

### 3. Run

```bash
make pybasic
```

This installs the Python package dependencies and starts the CLI. Type messages to chat with the agent, which can read/write files, execute commands, and more. Type `exit` to quit.

### Remote mode

To connect to a running daemon instead of using a local backend:

```bash
BACKEND_TYPE=remote make pybasic
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | (required) | OpenRouter API key |
| `BACKEND_TYPE` | `local` | `local` or `remote` |
| `ROOT_DIR` | `/tmp/agentbe-workspace` | Workspace root directory |
| `MODEL` | `anthropic/claude-sonnet-4.5` | Model ID |
| `REMOTE_HOST` | `localhost` | Remote daemon host |
| `REMOTE_PORT` | `3001` | Remote daemon port |
| `AUTH_TOKEN` | — | Auth token for remote daemon |
