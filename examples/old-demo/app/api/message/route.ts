import type { FileSystem } from "agent-backend";
import { stepCountIs, streamText } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createFileSystem, initAgentBackend, isMCPMode } from "../../../lib/backends-init";
import { broadcastToStream } from "../../../lib/streams";
import { createMCPToolsClient, getModel, SYSTEM_PROMPT, type MCPToolsClient } from "../../../lib/vercel-ai-init";

export async function POST(request: NextRequest) {
  try {
    // Check if request has a body
    const contentType = request.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      console.error("[API] Invalid content type");
      return NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 400 },
      );
    }

    // Parse JSON with better error handling
    let body;
    try {
      const text = await request.text();
      if (!text) {
        console.error("[API] Empty request body");
        return NextResponse.json(
          { error: "Request body is empty" },
          { status: 400 },
        );
      }
      body = JSON.parse(text);
    } catch (parseError) {
      console.error("[API] JSON parse error:", parseError);
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    const { message, sessionId, previousRunState, previousMessages } = body;
    console.log(
      "[API] Message:",
      message?.substring(0, 100) + (message?.length > 100 ? "..." : ""),
    );
    console.log("[API] Session ID:", sessionId);

    if (!sessionId) {
      console.log("[API] Missing sessionId");
      return NextResponse.json(
        { error: "SessionId is required" },
        { status: 400 },
      );
    }

    // Check if this is an initialization request (empty message)
    const isInitializationOnly = !message || message.trim() === "";
    if (isInitializationOnly) {
      console.log("[API] Initialization request detected");
    }

    // Create a unique stream ID for this request
    const streamId = uuidv4();
    console.log("[API] Stream ID created:", streamId);

    // Initialize AgentBackend configuration
    initAgentBackend()

    // Create FileSystem instance
    console.log("[API] Initializing FileSystem");
    const fs = createFileSystem(sessionId);
    console.log("[API] FileSystem initialized");

    // Initialize workspace with sample files if empty
    console.log("[API] Initializing workspace...");
    await initializeWorkspace(fs);
    console.log("[API] Workspace initialized");

    // If this is just initialization, return early without starting AI processing
    if (isInitializationOnly) {
      console.log("[API] Initialization complete - skipping AI processing");
      return NextResponse.json({ success: true, initialized: true });
    }

    // Route to appropriate AI backend based on USE_MCP env var
    if (isMCPMode()) {
      console.log("[API] Using Vercel AI SDK + MCP mode");
      processWithVercelAI(message, sessionId, previousMessages || []);
    }

    console.log("[API] Returning stream ID:", streamId);
    return NextResponse.json({ streamId });
  } catch (error) {
    console.error("[API] Critical error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

async function initializeWorkspace(fs: FileSystem) {
  console.log("[WORKSPACE] Checking workspace contents...");
  try {
    const workspace = await fs.getWorkspace('default');
    const result = await workspace.exec("ls");
    if (typeof result !== 'string') {
      throw new Error('Output is not a string')
    }
    const files = result ? result.split("\n").filter(Boolean) : [];
    console.log("[WORKSPACE] Found", files.length, "files:", files.slice(0, 5));

    // If workspace is empty, create a README
    if (files.length === 0) {
      workspace.write("README.md", "# Workspace\n\nThis is your workspace. You can ask the AI to create files and run commands here.");
    } else {
      console.log("[WORKSPACE] Workspace already contains files");
    }
  } catch (error) {
    console.error("[WORKSPACE] Failed to initialize workspace:", error);
  }
}

// ============================================================================
// Vercel AI SDK + MCP Code Path
// ============================================================================

async function processWithVercelAI(
  message: string,
  sessionId: string,
  previousMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
) {
  console.log("[VERCEL-AI] Starting processing for session:", sessionId);

  let mcpClient: MCPToolsClient | undefined;

  try {
    // Create MCP client and get tools
    mcpClient = await createMCPToolsClient(sessionId);

    const agentName = "Assistant (MCP)";
    const agentId = "vercel-mcp";

    // Start streaming response
    broadcastToStream(sessionId, {
      type: "message_start",
      role: "assistant",
      agentName,
      agentId,
    });

    // Build messages array
    const messages = [
      ...previousMessages,
      { role: 'user' as const, content: message }
    ];

    console.log("[VERCEL-AI] Running with", Object.keys(mcpClient.tools).length, "tools");
    console.log("[VERCEL-AI] Message history length:", messages.length);

    // Run the model with MCP tools
    const result = await streamText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      tools: mcpClient.tools,
      messages,
      stopWhen: stepCountIs(10), // Allow multi-step tool use
    });

    // Process the stream and broadcast events
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          broadcastToStream(sessionId, {
            type: "assistant_delta",
            text: part.text,
          });
          break;

        case 'tool-call':
          console.log("[VERCEL-AI] Tool call:", part.toolName, part.input);
          broadcastToStream(sessionId, {
            type: "tool_use",
            id: part.toolCallId,
            toolName: part.toolName,
            params: part.input,
          });
          break;

        case 'tool-result':
          console.log("[VERCEL-AI] Tool result for:", part.toolName);
          broadcastToStream(sessionId, {
            type: "tool_result",
            id: part.toolCallId,
            toolName: part.toolName,
            output: part.output,
          });
          break;

        case 'error':
          console.error("[VERCEL-AI] Stream error:", part.error);
          break;
      }
    }

    console.log("[VERCEL-AI] Processing completed successfully");

    // End message and signal completion
    broadcastToStream(sessionId, {
      type: "message_end",
      id: uuidv4(),
      role: "assistant",
    });
    broadcastToStream(sessionId, { type: "done" });

  } catch (error) {
    console.error("[VERCEL-AI] Processing error:", error);
    broadcastToStream(sessionId, {
      type: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    // Always close the MCP client to clean up the spawned process
    if (mcpClient) {
      await mcpClient.close();
    }
  }
}
