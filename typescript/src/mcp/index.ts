// MCP Client helpers for connecting to MCP servers
export { createAgentBeMCPClient, createAgentBeMCPTransport, type AgentBeMCPClient, type AgentBeMCPClientOptions } from './client.js'

// Local/memory transport helpers
export {
  createLocalMCPTransportOptions,
  createMemoryMCPTransportOptions,
  type LocalMCPTransportOptions,
  type MemoryMCPTransportOptions,
} from './local-transport.js'

// Centralized backend transport creation
export { createBackendMCPTransport, type MCPTransport } from './transport.js'

// Note: MCP server implementation is available at 'agent-backend/server'
