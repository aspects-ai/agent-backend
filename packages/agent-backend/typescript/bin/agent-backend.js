#!/usr/bin/env node

/**
 * agent-backend CLI (production entry point)
 *
 * This is a thin wrapper that imports the compiled CLI from dist/.
 * All CLI logic lives in src/cli.ts (compiled to dist/cli.js by vite).
 *
 * For development, run the source directly with tsx:
 *   npx tsx --watch src/cli.ts daemon --rootDir /tmp/agentbe-workspace
 */

await import('../dist/cli.js')
