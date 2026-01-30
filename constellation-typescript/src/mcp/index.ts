// Client helpers
export { createConstellationMCPClient, createConstellationMCPTransport, type ConstellationMCPClient, type ConstellationMCPClientOptions } from './client.js'

// TODO Phase 8: local-client.ts uses archived Config.js - temporarily excluded
// export { createLocalConstellationMCPClient, type LocalConstellationMCPClient, type LocalConstellationMCPClientOptions } from './local-client.js'

// Tools registration (for custom server implementations)
export { registerTools } from './tools.js'
