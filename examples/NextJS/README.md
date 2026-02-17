# Agent Backend - NextJS Demo

Demo app showcasing agent-backend with AI chat, file management, and code editing.

## Getting Started

### 1. Install Dependencies (from monorepo root)

```bash
make install
```

### 2. Configure Environment

```bash
cd examples/NextJS
cp .env.example .env.local
```

Edit `.env.local` and set your `OPENROUTER_API_KEY`.

### 3. Run

```bash
make nextjs
```

This starts everything via [mprocs](https://github.com/pvolok/mprocs): TypeScript watch mode, the NextJS dev server, and (if Docker is available) a remote daemon container. Open [http://localhost:3001](http://localhost:3001).

To configure the app for a remote backend, click the **Settings** icon in the header, switch to **Remote**, and enter your connection details. The remote daemon uses SSH-over-WebSocket on the same port as the MCP server (no separate SSH port needed).

## Architecture

The NextJS app connects to an `agent-backend` instance (local or remote) that provides filesystem operations and MCP tools to the AI. Chat uses the Vercel AI SDK (`useChat` hook) which streams responses and automatically executes tool calls in a multi-step loop. On the server side, `streamText()` receives messages and invokes MCP tools exposed by the backend. For local mode, the backend spawns the daemon as a subprocess automatically. For remote mode, it connects over HTTP + SSH-over-WebSocket to a running daemon.

## Troubleshooting

### "Cannot find module 'agent-backend'"

```bash
cd examples/NextJS
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Changes to agent-backend not appearing

```bash
rm -rf .next
pnpm run dev
```

### NextJS won't start

```bash
rm -rf .next node_modules pnpm-lock.yaml
pnpm install
pnpm run dev
```

### AI not responding

- Verify `OPENROUTER_API_KEY` is set correctly in `.env.local`
- Check OpenRouter API status
- Review browser network tab for API errors
