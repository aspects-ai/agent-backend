import { getMCPClientForSession } from '@/lib/mcp-client'
import { openrouter } from '@openrouter/ai-sdk-provider'
import { convertToModelMessages, streamText } from 'ai'

export async function POST(req: Request) {
  const { messages, sessionId } = await req.json()

  // Get AI SDK MCP client (cached per session, cleared on backend config change)
  // Tools are already in AI SDK format - no manual transformation needed
  const mcpClient = await getMCPClientForSession(sessionId)
  const tools = await mcpClient.tools()

  // Convert UI messages to model messages
  const modelMessages = await convertToModelMessages(messages, { tools })

  // Stream AI response with tools
  const result = streamText({
    model: openrouter('anthropic/claude-4.5-sonnet'),
    messages: modelMessages,
    tools,
  })

  return result.toUIMessageStreamResponse()
}
