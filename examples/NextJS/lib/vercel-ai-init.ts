import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createFileSystem } from './backends-init'

/**
 * MCP client wrapper that holds the client and tools.
 * Must be closed after use to clean up the spawned MCP server process.
 */
export interface MCPToolsClient {
  tools: Awaited<ReturnType<Awaited<ReturnType<typeof createMCPClient>>['tools']>>
  close: () => Promise<void>
}

/**
 * Create an MCP client connected to the AgentBackend MCP server.
 * Returns tools that can be passed to Vercel AI SDK's streamText/generateText.
 *
 * Uses FileSystem.getMCPTransport() which automatically handles:
 * - Local backends: Spawns MCP server via stdio
 * - Remote backends: Connects via HTTP (if mcpAuth is configured)
 *
 * @param sessionId - Session ID for workspace isolation
 * @returns MCP tools client with tools and close method
 */
export async function createMCPToolsClient(sessionId: string): Promise<MCPToolsClient> {
  const fs = createFileSystem(sessionId)
  const transport = fs.getMCPTransport('default')

  console.log('[VERCEL-AI] Creating MCP client with transport type:', fs.isRemote ? 'http' : 'stdio')

  const mcpClient = await createMCPClient({ transport })
  const tools = await mcpClient.tools()

  console.log('[VERCEL-AI] MCP client created, tools:', Object.keys(tools))

  return {
    tools,
    close: async () => {
      console.log('[VERCEL-AI] Closing MCP client')
      await mcpClient.close()
    }
  }
}

/**
 * Get the model for use with Vercel AI SDK via OpenRouter.
 * Uses OPENROUTER_API_KEY environment variable.
 */
export function getModel() {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  })
  return openrouter('anthropic/claude-sonnet-4')
}

/**
 * System prompt for the MCP-enabled assistant.
 */
export const SYSTEM_PROMPT = `You are a helpful coding assistant with access to a filesystem through MCP tools.

You have access to the following filesystem tools:
- read_text_file: Read file contents
- read_multiple_files: Read multiple files at once
- write_file: Create or overwrite files
- edit_file: Make selective edits to files
- create_directory: Create directories
- list_directory: List directory contents
- directory_tree: Get recursive directory structure
- move_file: Move or rename files
- search_files: Search for files by pattern
- get_file_info: Get file metadata
- exec: Execute shell commands

Always use read_text_file to examine files before modifying them.
Use exec to run shell commands when needed (e.g., npm install, git commands).
When creating new files, ensure parent directories exist first.`
