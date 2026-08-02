/**
 * MCP Server implementation for Agent Backend.
 *
 * This module provides an MCP (Model Context Protocol) server that wraps
 * Agent Backend instances and exposes their capabilities as MCP tools.
 *
 * @module server
 * @internal This module is intended for CLI and internal use only.
 *           The main library API is exported from the root index.ts.
 */

export { AgentBackendMCPServer } from './AgentBackendMCPServer.js'
export { registerFilesystemTools, registerExecTool, DEFAULT_EXCLUDE_PATTERNS } from './tools.js'
export { createWebSocketSSHServer } from './WebSocketSSHServer.js'
export type { WebSocketSSHServerOptions, WebSocketSSHServerInstance } from './WebSocketSSHServer.js'
export { createSFTPHandler } from './SFTPHandler.js'
