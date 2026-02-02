"use client";

import {
  Box,
  Group,
  ScrollArea,
  Stack,
  Text,
  Textarea
} from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  role: "user" | "assistant" | "tool_use" | "tool_result";
  content: string;
  toolName?: string;
  params?: any;
  output?: any;
  agentName?: string;
  agentId?: string;
}

interface ChatProps {
  sessionId: string;
  apiKey: string | null;
}

// Separate component for expandable tool output
const ToolOutput = ({ output }: { output: any }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!output) return null;

  const outputStr =
    typeof output === "string" ? output : JSON.stringify(output, null, 2);

  // Always show the expand button if there's output
  return (
    <Box mt="xs" style={{ fontSize: "0.85em", position: "relative" }}>
      {isExpanded && (
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: "400px",
            overflowX: "auto",
            overflowY: "auto",
            maxWidth: "100%",
            backgroundColor: "rgba(10, 15, 30, 0.8)",
            padding: "12px",
            borderRadius: "6px",
            border: "1px solid rgba(34, 139, 230, 0.15)",
            fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
            fontSize: "12px",
            color: "rgba(148, 163, 184, 0.9)",
          }}
        >
          {outputStr}
        </pre>
      )}
      <Box
        style={{
          marginTop: "8px",
        }}
      >
        <Text
          size="xs"
          style={{
            cursor: "pointer",
            userSelect: "none",
            opacity: 0.8,
            transition: "all 0.2s",
            color: "#60A5FA",
            fontFamily: "monospace",
            letterSpacing: "0.05em",
            fontSize: "11px",
            display: "inline-block",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
            e.currentTarget.style.color = "#93C5FD";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0.8";
            e.currentTarget.style.color = "#60A5FA";
          }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? "[↑ COLLAPSE]" : "[↓ EXPAND]"}
        </Text>
      </Box>
    </Box>
  );
};

ToolOutput.displayName = "ToolOutput";

// Cyberpunk Loading Indicator Component
const CyberLoadingIndicator = ({
  message = "PROCESSING",
  agentName,
}: {
  message?: string;
  agentName?: string;
}) => {
  return (
    <Box className="cyber-loading-container">
      <Box className="cyber-loader">
        <div className="cyber-loader-ring" />
        <div className="cyber-loader-ring" />
        <div className="cyber-loader-core" />
      </Box>

      <Box style={{ flex: 1 }}>
        <Text className="cyber-loading-text">{message}</Text>
        {agentName && (
          <Text
            size="xs"
            style={{
              color: "#A855F7",
              fontFamily: "'SF Mono', Monaco, monospace",
              fontSize: "10px",
              opacity: 0.8,
              letterSpacing: "0.05em",
              marginTop: "2px",
            }}
          >
            AGENT: {agentName.toUpperCase()}
          </Text>
        )}
        <Box mt="xs" className="cyber-loading-dots">
          <div className="cyber-loading-dot" />
          <div className="cyber-loading-dot" />
          <div className="cyber-loading-dot" />
          <div className="cyber-loading-dot" />
        </Box>
      </Box>
    </Box>
  );
};

CyberLoadingIndicator.displayName = "CyberLoadingIndicator";

// Agent Banner Component
const AgentBanner = ({
  agentName,
  agentId,
}: {
  agentName: string;
  agentId: string;
}) => {
  // Color coding for different agents
  const getAgentColor = (agentId: string) => {
    const colors: Record<
      string,
      { primary: string; secondary: string; accent: string }
    > = {
      orchestrator: {
        primary: "#228BE6",
        secondary: "#1C7ED6",
        accent: "#74C0FC",
      },
      "react-typescript-builder": {
        primary: "#A855F7",
        secondary: "#9333EA",
        accent: "#C084FC",
      },
      "etl-manager": {
        primary: "#10B981",
        secondary: "#059669",
        accent: "#6EE7B7",
      },
      "extract-agent": {
        primary: "#F59E0B",
        secondary: "#D97706",
        accent: "#FCD34D",
      },
      "transform-agent": {
        primary: "#EF4444",
        secondary: "#DC2626",
        accent: "#FCA5A5",
      },
      "load-agent": {
        primary: "#8B5CF6",
        secondary: "#7C3AED",
        accent: "#C4B5FD",
      },
      "file-picker": {
        primary: "#06B6D4",
        secondary: "#0891B2",
        accent: "#67E8F9",
      },
      thinker: { primary: "#F97316", secondary: "#EA580C", accent: "#FDBA74" },
    };
    return (
      colors[agentId] || {
        primary: "#6B7280",
        secondary: "#4B5563",
        accent: "#9CA3AF",
      }
    );
  };

  const colors = getAgentColor(agentId);
  const displayName = agentName.replace(/\s+/g, "_").toUpperCase();

  return (
    <Box
      style={{
        background: `linear-gradient(135deg, ${colors.primary}15 0%, ${colors.secondary}08 100%)`,
        border: `1px solid ${colors.primary}40`,
        borderRadius: "8px",
        padding: "8px 16px",
        margin: "8px 0",
        position: "relative",
        overflow: "hidden",
        backdropFilter: "blur(10px)",
      }}
    >
      <style>{`
        @keyframes agent-pulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
        @keyframes agent-scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>

      {/* Animated scan line */}
      <Box
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "2px",
          background: `linear-gradient(90deg, transparent, ${colors.accent}, transparent)`,
          animation: "agent-scan 2s ease-in-out infinite",
        }}
      />

      <Group gap="xs" align="center">
        <Box
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${colors.primary}, ${colors.secondary})`,
            animation: "agent-pulse 2s ease-in-out infinite",
            boxShadow: `0 0 10px ${colors.primary}60`,
          }}
        />
        <Text
          size="xs"
          fw={600}
          style={{
            color: colors.accent,
            fontFamily: "'SF Mono', Monaco, monospace",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          🤖 {displayName} ACTIVE
        </Text>
      </Group>
    </Box>
  );
};

AgentBanner.displayName = "AgentBanner";

// Helper functions for agent display and colors
const getAgentDisplayName = (agentName?: string) => {
  if (!agentName) return "CYBERBUFFY.RX";

  // Map agent names to shorter display names
  const agentDisplayMap: Record<string, string> = {
    "Task Orchestrator": "ORCHESTRATOR.RX",
    "React TypeScript Builder": "BUILDER.RX",
    "ETL Manager": "ETL.RX",
    "Extract Agent": "EXTRACT.RX",
    "Transform Agent": "TRANSFORM.RX",
    "Load Agent": "LOAD.RX",
    "File Picker": "PICKER.RX",
    Thinker: "THINKER.RX",
  };

  return (
    agentDisplayMap[agentName] ||
    `${agentName.toUpperCase().replace(/\s+/g, "_")}.RX`
  );
};

// Group messages by agent
interface MessageGroup {
  agentName?: string;
  agentId?: string;
  role: "user" | "assistant";
  messages: Message[];
}

const groupMessagesByAgent = (messages: Message[]): MessageGroup[] => {
  const groups: MessageGroup[] = [];
  let currentGroup: MessageGroup | null = null;

  for (const message of messages) {
    // Skip tool messages for grouping purposes - they'll be handled within agent groups
    if (message.role === "tool_use" || message.role === "tool_result") {
      if (currentGroup && currentGroup.role === "assistant") {
        currentGroup.messages.push(message);
      }
      continue;
    }

    const messageAgentKey =
      message.role === "user"
        ? "user"
        : message.agentName || "Task Orchestrator";
    const currentAgentKey =
      currentGroup?.role === "user"
        ? "user"
        : currentGroup?.agentName || "Task Orchestrator";

    // Start new group if agent changes or if switching between user/assistant
    if (
      !currentGroup ||
      currentAgentKey !== messageAgentKey ||
      currentGroup.role !== message.role
    ) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        agentName: message.agentName,
        agentId: message.agentId,
        role: message.role,
        messages: [message],
      };
    } else {
      // Add to current group
      currentGroup.messages.push(message);
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
};

const getAgentColors = (agentName?: string) => {
  const colors: Record<string, { border: string; bg: string; text: string }> = {
    "Task Orchestrator": {
      border: "#228BE6",
      bg: "rgba(34, 139, 230, 0.08)",
      text: "#74C0FC",
    },
    "React TypeScript Builder": {
      border: "#A855F7",
      bg: "rgba(168, 85, 247, 0.08)",
      text: "#C084FC",
    },
    "ETL Manager": {
      border: "#10B981",
      bg: "rgba(16, 185, 129, 0.08)",
      text: "#6EE7B7",
    },
    "Extract Agent": {
      border: "#F59E0B",
      bg: "rgba(245, 158, 11, 0.08)",
      text: "#FCD34D",
    },
    "Transform Agent": {
      border: "#EF4444",
      bg: "rgba(239, 68, 68, 0.08)",
      text: "#FCA5A5",
    },
    "Load Agent": {
      border: "#8B5CF6",
      bg: "rgba(139, 92, 246, 0.08)",
      text: "#C4B5FD",
    },
    "File Picker": {
      border: "#06B6D4",
      bg: "rgba(6, 182, 212, 0.08)",
      text: "#67E8F9",
    },
    Thinker: {
      border: "#F97316",
      bg: "rgba(249, 115, 22, 0.08)",
      text: "#FDBA74",
    },
  };
  return (
    colors[agentName || ""] || {
      border: "#228BE6",
      bg: "rgba(34, 139, 230, 0.08)",
      text: "#228BE6",
    }
  );
};

// Message component
const MessageComponent = ({ message }: { message: Message }) => {
  const renderToolParams = useCallback((params: any) => {
    if (!params || Object.keys(params).length === 0) return null;

    return (
      <Box mt="xs" style={{ fontSize: "0.85em", opacity: 0.9 }}>
        {Object.entries(params).map(([key, value]) => (
          <div key={key} style={{ marginBottom: "4px" }}>
            <Text span fw={500} style={{ color: "#A78BFA" }}>
              {key}:
            </Text>{" "}
            <span style={{ color: "var(--mantine-color-gray-4)" }}>
              {JSON.stringify(value, null, 2)}
            </span>
          </div>
        ))}
      </Box>
    );
  }, []);

  // Tool messages
  if (message.role === "tool_use" || message.role === "tool_result") {
    return (
      <Box
        className="tool-message"
        p="md"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.9)",
          borderLeft:
            message.role === "tool_use"
              ? "3px solid #228BE6"
              : "3px solid #10B981",
          borderRadius: "8px",
          fontSize: "0.9em",
          border: "1px solid rgba(34, 139, 230, 0.2)",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
          position: "relative",
        }}
      >
        <Text
          size="sm"
          fw={600}
          style={{
            color: message.role === "tool_use" ? "#60A5FA" : "#34D399",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {message.role === "tool_use" ? "[EXEC]" : "[RESULT]"}{" "}
          {message.toolName}
        </Text>
        {message.role === "tool_use" && renderToolParams(message.params)}
        {message.role === "tool_result" && message.output && (
          <ToolOutput output={message.output} />
        )}
      </Box>
    );
  }

  // Regular messages
  const agentColors =
    message.role === "assistant" ? getAgentColors(message.agentName) : null;

  return (
    <Box
      className={message.role === "user" ? "user-message" : "assistant-message"}
      p="lg"
      style={{
        background:
          message.role === "user"
            ? "linear-gradient(135deg, rgba(64, 36, 20, 0.95) 0%, rgba(92, 44, 28, 0.9) 50%, rgba(120, 52, 32, 0.85) 100%)"
            : agentColors
              ? `linear-gradient(135deg, rgba(20, 27, 45, 0.95) 0%, ${agentColors.bg} 50%, rgba(15, 23, 42, 0.9) 100%)`
              : "linear-gradient(135deg, rgba(20, 27, 45, 0.95) 0%, rgba(15, 23, 42, 0.9) 100%)",
        marginLeft: message.role === "user" ? "auto" : "0",
        marginRight: message.role === "user" ? "0" : "auto",
        maxWidth: message.role === "user" ? "75%" : "85%",
        minWidth: 0,
        width: message.role === "user" ? "100%" : "fit-content",
        overflowWrap: "break-word",
        wordBreak: "break-word",
        overflowX: "hidden",
        borderLeft:
          message.role === "user"
            ? "1px solid rgba(249, 115, 22, 0.3)"
            : agentColors
              ? `3px solid ${agentColors.border}`
              : "3px solid #228BE6",
        borderRight:
          message.role === "user"
            ? "3px solid #F97316"
            : "1px solid rgba(34, 139, 230, 0.2)",
        borderRadius: "0 8px 8px 0",
        position: "relative",
        boxShadow: "0 4px 24px rgba(0, 0, 0, 0.3)",
        clipPath:
          message.role === "user"
            ? "polygon(8px 0, 100% 0, 100% 100%, calc(100% - 8px) 100%, 0 calc(100% - 8px), 0 8px)"
            : "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)",
      }}
      data-agent-name={
        message.role === "assistant"
          ? getAgentDisplayName(message.agentName)
          : undefined
      }
    >
      <Box
        style={{
          overflowWrap: "break-word",
          wordBreak: "break-word",
          minWidth: 0,

          color: message.role === "user" ? "#FED7AA" : "#CBD5E1",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "16px",
          lineHeight: "1.6",
          letterSpacing: "0.02em",
          "& code": {
            backgroundColor: "rgba(10, 15, 30, 0.6)",
            padding: "2px 6px",
            borderRadius: "3px",
            fontSize: "0.9em",
            fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
            color: message.role === "user" ? "#FB923C" : "#60A5FA",
            border: "1px solid rgba(34, 139, 230, 0.2)",
            overflowWrap: "break-word",
            wordBreak: "break-all",
          },
          "& pre": {
            backgroundColor: "rgba(10, 15, 30, 0.8)",
            padding: "16px",
            borderRadius: "6px",
            overflowX: "auto",
            maxWidth: "100%",
            width: "100%",
            border: "1px solid rgba(34, 139, 230, 0.15)",
            boxShadow: "inset 0 2px 8px rgba(0, 0, 0, 0.4)",
            margin: "12px 0",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowWrap: "break-word",
          },
          "& pre code": {
            backgroundColor: "transparent",
            padding: 0,
            border: "none",
            overflowWrap: "normal",
            wordBreak: "normal",
            color: "#94A3B8",
          },
          "& p": {
            margin: "0 0 8px 0",
          },
        }}
      >
        {message.role === "assistant" ? (
          <ReactMarkdown>{message.content}</ReactMarkdown>
        ) : (
          <Text
            style={{
              color: "inherit",
              fontSize: "inherit",
              lineHeight: "inherit",
              whiteSpace: "pre-wrap",
              textAlign: "right",
            }}
          >
            {message.content}
          </Text>
        )}
      </Box>
    </Box>
  );
};

MessageComponent.displayName = "MessageComponent";

// Message Group Component
const MessageGroupComponent = ({ group }: { group: MessageGroup }) => {
  const agentColors =
    group.role === "assistant" ? getAgentColors(group.agentName) : null;

  return (
    <Box>
      {/* Agent header for assistant messages */}
      {group.role === "assistant" && (
        <Text
          size="xs"
          style={{
            fontFamily: "'SF Mono', Monaco, monospace",
            color: agentColors?.text || "#228BE6",
            letterSpacing: "0.05em",
            opacity: 0.7,
            marginBottom: "8px",
            marginLeft: "0px",
          }}
        >
          [{getAgentDisplayName(group.agentName)}]
        </Text>
      )}

      {/* User header for user messages */}
      {group.role === "user" && (
        <Text
          size="xs"
          style={{
            fontFamily: "'SF Mono', Monaco, monospace",
            color: "#FB923C",
            letterSpacing: "0.05em",
            opacity: 0.7,
            marginBottom: "8px",
            marginRight: "0px",
            textAlign: "right",
          }}
        >
          [USER.TX]
        </Text>
      )}

      {/* Group container with agent-themed styling */}
      <Box
        style={{
          border:
            group.role === "assistant"
              ? `1px solid ${agentColors?.border || "#228BE6"}20`
              : "1px solid rgba(168, 85, 247, 0.2)",
          borderRadius: "12px",
          padding: "8px",
          background:
            group.role === "assistant"
              ? `linear-gradient(135deg, ${agentColors?.bg || "rgba(34, 139, 230, 0.08)"} 0%, rgba(15, 23, 42, 0.5) 100%)`
              : "linear-gradient(135deg, rgba(249, 115, 22, 0.08) 0%, rgba(15, 23, 42, 0.5) 100%)",          alignSelf: group.role === "user" ? "flex-end" : "flex-start",
          maxWidth: group.role === "user" ? "80%" : "100%",
          marginLeft: group.role === "user" ? "auto" : "0",
        }}
      >
        <Stack gap="sm">
          {group.messages.map((message, index) => (
            <Box key={message.id}>
              <MessageComponent message={message} />
            </Box>
          ))}
        </Stack>
      </Box>
    </Box>
  );
};

MessageGroupComponent.displayName = "MessageGroupComponent";

export default function Chat({ sessionId, apiKey }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [loadingStage, setLoadingStage] =
    useState<string>("NEURAL LINK ACTIVE");

  const [runState, setRunState] = useState<any>(null);
  const [activeAgent, setActiveAgent] = useState<{
    name: string;
    id: string;
  } | null>({ name: "Task Orchestrator", id: "orchestrator" });

  const activeAgentRef = useRef(activeAgent);
  useEffect(() => {
    activeAgentRef.current = activeAgent;
  }, [activeAgent]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageEndProcessed = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  const hasInitialized = useRef(false);

  // Immediate scroll without debouncing
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Optimized message addition with deduplication
  const addMessageWithDuplicateCheck = useCallback((newMessage: Message) => {
    // Don't add empty messages
    if (
      !newMessage.content?.trim() &&
      newMessage.role !== "tool_use" &&
      newMessage.role !== "tool_result"
    ) {
      return;
    }

    setMessages((prev) => {
      const isDuplicate = prev.some((msg) => msg.id === newMessage.id);
      if (isDuplicate) return prev;
      return [...prev, newMessage];
    });
  }, []);

  // Only scroll when new messages are added
  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  // Initialize workspace on component mount
  useEffect(() => {
    const initializeWorkspace = async () => {
      if (hasInitialized.current || !sessionId) return;

      hasInitialized.current = true;
      console.log("[Chat] Initializing workspace on app load...");

      try {
        const requestBody = {
          message: "", // Empty message for initialization only
          sessionId,
        };

        const response = await fetch("/api/message", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (response.ok) {
          console.log("[Chat] ✅ Workspace initialized successfully");
          // Dispatch filesystem update to refresh file explorer
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("filesystem-update"));
          }, 500);
        } else {
          console.warn(
            "[Chat] ⚠️ Workspace initialization failed:",
            response.status,
          );
        }
      } catch (error) {
        console.error("[Chat] ❌ Failed to initialize workspace:", error);
      }
    };

    initializeWorkspace();
  }, [sessionId]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        console.log("[Chat] Cleaning up EventSource on unmount");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading || !apiKey) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    addMessageWithDuplicateCheck(userMessage);
    setInput("");
    setIsLoading(true);
    setCurrentResponse("");

    try {
      const requestBody = {
        message: userMessage.content,
        sessionId,
        ...(runState && { previousRunState: runState }),
      };

      const response = await fetch("/api/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        console.error("[Chat] API error:", errorData);
        throw new Error(errorData.error || "Failed to send message");
      }

      // Clean up any existing EventSource
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      } // Clear any retry timeout
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      // Reset retry count
      retryCountRef.current = 0;

      // Add retry logic for EventSource connection
      const createEventSource = () => {
        try {
          const eventSource = new EventSource(
            `/api/stream?sessionId=${sessionId}`,
          );
          eventSourceRef.current = eventSource;
          return eventSource;
        } catch (error) {
          console.error("[Chat] Failed to create EventSource:", error);
          throw error;
        }
      };

      const eventSource = createEventSource();

      eventSource.onopen = () => {
        console.log("[Chat] EventSource connected successfully");
        setStreamError(null);
        retryCountRef.current = 0; // Reset retry count on successful connection

        // Send a test ping to verify the connection is working
        console.log("[Chat] Connection established, waiting for messages...");
      };

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "message_start") {
          setCurrentResponse("");
          messageEndProcessed.current = false;
          setLoadingStage("PROCESSING QUERY");
        } else if (data.type === "assistant_delta") {
          setCurrentResponse((prev) => prev + data.text);
        } else if (data.type === "assistant_message") {
          const assistantMessage: Message = {
            id: data.id,
            role: "assistant",
            content: data.text,
            agentName: activeAgentRef.current?.name || "Task Orchestrator",
            agentId: activeAgentRef.current?.id || "orchestrator",
          };
          addMessageWithDuplicateCheck(assistantMessage);
        } else if (data.type === "tool_use") {
          // Update loading stage based on tool being used
          const toolStages: Record<string, string> = {
            read_files: "ACCESSING DATASTREAMS",
            write_file: "MATRIX INJECTION",
            str_replace: "NEURAL EDITING",
            run_terminal_command: "SYSTEM BREACH",
            code_search: "PATTERN RECOGNITION",
            spawn_agents: "DEPLOYING SUBROUTINES",
            think_deeply: "DEEP THOUGHT PROCESS",
          };
          setLoadingStage(toolStages[data.toolName] || "EXECUTING PROTOCOLS");

          const toolUseMessage: Message = {
            id: data.id,
            role: "tool_use",
            content: `Using ${data.toolName} tool`,
            toolName: data.toolName,
            params: data.params,
          };
          addMessageWithDuplicateCheck(toolUseMessage);
        } else if (data.type === "tool_result") {
          const asyncTools = [
            "write_file",
            "update_subgoal",
            "add_subgoal",
            "str_replace",
          ];
          const hasEmptyOutput =
            !data.output ||
            (typeof data.output === "object" &&
              Object.keys(data.output).length === 0) ||
            (typeof data.output === "string" && data.output.trim() === "");

          const shouldShowResult = !(
            asyncTools.includes(data.toolName || "") && hasEmptyOutput
          );

          if (shouldShowResult) {
            const toolResultMessage: Message = {
              id: data.id + "_result",
              role: "tool_result",
              content: `Tool result from ${data.toolName}`,
              toolName: data.toolName,
              output: data.output,
            };
            addMessageWithDuplicateCheck(toolResultMessage);
          }

          const fileTools = [
            "write_file",
            "str_replace",
            "edit_file",
            "create_file",
          ];
          if (fileTools.includes(data.toolName || "")) {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent("filesystem-update"));
            }, 100);
          }
        } else if (data.type === "message_end") {
          if (messageEndProcessed.current) return;
          messageEndProcessed.current = true;
          setLoadingStage("FINALIZING TRANSMISSION");

          setCurrentResponse((currentContent) => {
            if (currentContent.trim()) {
              const newMessage: Message = {
                id: data.id || Date.now().toString(),
                role: "assistant",
                content: currentContent,
                agentName: activeAgentRef.current?.name || "Task Orchestrator",
              };
              addMessageWithDuplicateCheck(newMessage);
            }
            return "";
          });
        } else if (data.type === "subagent_start") {
          console.log("[Chat] 🚀 Subagent started:", data.agentName);
          setActiveAgent({ name: data.agentName, id: data.agentId });
        } else if (
          data.type === "agent_end" ||
          data.type === "subagent_finish"
        ) {
          console.log("[Chat] ⏹️ Agent ended:", data.agentName);
          setActiveAgent({ name: "Task Orchestrator", id: "orchestrator" });
        } else if (data.type === "run_state_update") {
          console.log("[Chat] Received runState update:", !!data.runState);
          if (data.runState) {
            console.log("[Chat] Storing runState for next message");
            setRunState(data.runState);
          }
        } else if (data.type === "done") {
          setIsLoading(false);
          setStreamError(null);
          setLoadingStage("NEURAL LINK ACTIVE");
          eventSource.close();
          eventSourceRef.current = null;
          window.dispatchEvent(new CustomEvent("filesystem-update"));
        } else if (data.type === "error") {
          console.error("Stream error:", data.message);
          setStreamError(data.message);
          setIsLoading(false);
          eventSource.close();
          eventSourceRef.current = null;

          // Add error message to chat
          const errorMessage: Message = {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `⚠️ **Error:** ${data.message}`,
          };
          addMessageWithDuplicateCheck(errorMessage);
        }
      };

      eventSource.onerror = (error) => {
        // Get more detailed error information
        const errorDetails = {
          readyState: eventSource.readyState,
          url: eventSource.url,
          type: error.type || "unknown",
          message: (error as any).message || "No message",
          target: error.target
            ? {
                readyState: (error.target as EventSource).readyState,
                url: (error.target as EventSource).url,
              }
            : null,
          timestamp: new Date().toISOString(),
          retryCount: retryCountRef.current,
        };

        console.error("[Chat] EventSource error:", errorDetails);
        console.error("[Chat] Raw error object:", error);

        // Handle different ready states
        if (eventSource.readyState === EventSource.CONNECTING) {
          console.log("[Chat] EventSource is reconnecting...");
          // Don't retry immediately when it's already trying to connect
          return;
        }

        // Close the current connection
        eventSource.close();
        eventSourceRef.current = null;

        // Attempt retry if under max retries
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          console.log(
            `[Chat] Retrying connection (${retryCountRef.current}/${maxRetries})...`,
          );

          setStreamError(
            `Connection interrupted. Retrying... (${retryCountRef.current}/${maxRetries})`,
          );

          // Retry after a short delay with exponential backoff
          const retryDelay = Math.min(
            1000 * Math.pow(2, retryCountRef.current - 1),
            10000,
          ); // Cap at 10 seconds
          console.log(`[Chat] Retrying in ${retryDelay}ms...`);

          retryTimeoutRef.current = setTimeout(() => {
            try {
              const newEventSource = createEventSource();
              // Re-attach all the event handlers
              newEventSource.onopen = eventSource.onopen;
              newEventSource.onmessage = eventSource.onmessage;
              newEventSource.onerror = eventSource.onerror;
              console.log(
                "[Chat] Retry attempt successful, new EventSource created",
              );
            } catch (retryError) {
              console.error("[Chat] Retry failed:", retryError);
              handleFinalError();
            }
          }, retryDelay);
        } else {
          handleFinalError();
        }

        function handleFinalError() {
          setIsLoading(false);

          if (eventSource.readyState === EventSource.CLOSED) {
            setStreamError(
              "Connection lost. Please try sending your message again.",
            );
          } else {
            const errorMsg = `Stream error (state: ${eventSource.readyState}). Please try again.`;
            setStreamError(errorMsg);
          }

          // Add user-friendly error message
          const errorMessage: Message = {
            id: `connection-error-${Date.now()}`,
            role: "assistant",
            content: `🔌 **Connection Error:** The stream connection was lost after ${maxRetries} retries. Please try sending your message again.`,
          };
          addMessageWithDuplicateCheck(errorMessage);
        }
      };
    } catch (error) {
      console.error("Failed to send message:", error);
      setIsLoading(false);
      setStreamError(
        error instanceof Error ? error.message : "Unknown error occurred",
      );

      // Add error message to chat
      const errorMessage: Message = {
        id: `send-error-${Date.now()}`,
        role: "assistant",
        content: `❌ **Send Error:** ${error instanceof Error ? error.message : "Unknown error occurred"}`,
      };
      addMessageWithDuplicateCheck(errorMessage);
    }
  }, [
    input,
    isLoading,
    apiKey,
    sessionId,
    activeAgent,

    addMessageWithDuplicateCheck,
  ]);

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  // Filter out empty messages and group by agent
  const filteredMessages = messages.filter(
    (msg) =>
      msg.content?.trim() ||
      msg.role === "tool_use" ||
      msg.role === "tool_result",
  );

  const messageGroups = groupMessagesByAgent(filteredMessages);

  return (
    <Box h="100%" style={{ display: "flex", flexDirection: "column" }}>
      {/* Loading indicator at top of chat */}
      {isLoading && (
        <Box
          p="sm"
          style={{
            borderBottom: "1px solid rgba(34, 139, 230, 0.1)",
            background: "rgba(15, 23, 42, 0.8)",
          }}
        >
          <CyberLoadingIndicator
            message={loadingStage}
            agentName={activeAgent?.name || "Task Orchestrator"}
          />
        </Box>
      )}

      {/* Stream error indicator */}
      {streamError && (
        <Box
          p="sm"
          style={{
            borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
            background: "rgba(239, 68, 68, 0.1)",
          }}
        >
          <Text size="sm" style={{ color: "#F87171" }}>
            ⚠️ Connection Error: {streamError}
          </Text>
        </Box>
      )}

      {/* Active Agent Banner */}
      {activeAgent && activeAgent.id !== "orchestrator" && (
        <Box
          p="sm"
          style={{
            borderBottom: "1px solid rgba(34, 139, 230, 0.1)",
            background: "rgba(15, 23, 42, 0.8)",
          }}
        >
          <AgentBanner agentName={activeAgent.name} agentId={activeAgent.id} />
        </Box>
      )}

      <style>{`
        @keyframes subtle-glow {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }

        @keyframes pulse-border {
          0%, 100% {
            border-color: rgba(34, 139, 230, 0.2);
            box-shadow: 0 0 10px rgba(34, 139, 230, 0.1);
          }
          50% {
            border-color: rgba(168, 85, 247, 0.3);
            box-shadow: 0 0 20px rgba(168, 85, 247, 0.15);
          }
        }

        @keyframes floating-orb {
          0%, 100% {
            transform: translateY(0px) translateX(0px);
            opacity: 0.3;
          }
          25% {
            transform: translateY(-10px) translateX(5px);
            opacity: 0.5;
          }
          50% {
            transform: translateY(-5px) translateX(-5px);
            opacity: 0.4;
          }
          75% {
            transform: translateY(-15px) translateX(3px);
            opacity: 0.6;
          }
        }

        @keyframes cyber-loader-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes cyber-loader-pulse {
          0%, 100% {
            opacity: 0.4;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.05);
          }
        }

        @keyframes data-stream {
          0% {
            transform: translateX(-100%);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateX(400%);
            opacity: 0;
          }
        }

        @keyframes neural-scan {
          0% {
            box-shadow: 0 0 0 0 rgba(34, 139, 230, 0.7);
          }
          70% {
            box-shadow: 0 0 0 20px rgba(34, 139, 230, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(34, 139, 230, 0);
          }
        }

        @keyframes glitch-text {
          0%, 90%, 100% {
            text-shadow: 0 0 5px rgba(34, 139, 230, 0.8);
          }
          5% {
            text-shadow: 2px 0 0 #ff00ff, -2px 0 0 #00ffff;
            transform: translateX(1px);
          }
          10% {
            text-shadow: -1px 0 0 #ff00ff, 1px 0 0 #00ffff;
            transform: translateX(-1px);
          }
        }

        .cyber-loading-container {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 100%);
          border: 1px solid rgba(34, 139, 230, 0.3);
          border-radius: 12px;
          position: relative;
          overflow: hidden;
          backdrop-filter: blur(10px);
        }

        .cyber-loading-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(34, 139, 230, 0.1), transparent);
          animation: data-stream 2s ease-in-out infinite;
        }

        .cyber-loader {
          position: relative;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .cyber-loader-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border: 2px solid transparent;
          border-top: 2px solid #228BE6;
          border-right: 2px solid #A855F7;
          border-radius: 50%;
          animation: cyber-loader-spin 1s linear infinite;
        }

        .cyber-loader-ring:nth-child(2) {
          width: 80%;
          height: 80%;
          border-top: 2px solid #F783AC;
          border-right: 2px solid #228BE6;
          animation-duration: 1.5s;
          animation-direction: reverse;
        }

        .cyber-loader-core {
          width: 12px;
          height: 12px;
          background: radial-gradient(circle, #228BE6, #A855F7);
          border-radius: 50%;
          animation: cyber-loader-pulse 1.5s ease-in-out infinite, neural-scan 2s infinite;
          z-index: 1;
        }

        .cyber-loading-text {
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
          font-size: 13px;
          color: #60A5FA;
          letter-spacing: 0.1em;
          animation: glitch-text 3s ease-in-out infinite;
          text-transform: uppercase;
          font-weight: 600;
        }

        .cyber-loading-dots {
          display: flex;
          gap: 4px;
        }

        .cyber-loading-dot {
          width: 6px;
          height: 6px;
          background: linear-gradient(45deg, #228BE6, #A855F7);
          border-radius: 50%;
          animation: cyber-loader-pulse 1.2s ease-in-out infinite;
        }

        .cyber-loading-dot:nth-child(1) { animation-delay: 0s; }
        .cyber-loading-dot:nth-child(2) { animation-delay: 0.2s; }
        .cyber-loading-dot:nth-child(3) { animation-delay: 0.4s; }
        .cyber-loading-dot:nth-child(4) { animation-delay: 0.6s; }

        .cyber-status-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          height: 2px;
          background: linear-gradient(90deg, #228BE6, #A855F7, #F783AC);
          width: 0;
          animation: loading-progress 3s ease-out infinite;
        }

        @keyframes loading-progress {
          0% { width: 0%; }
          50% { width: 75%; }
          100% { width: 100%; }
        }

        .cyber-message {
          position: relative;
        }

        .cyber-message::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(34, 139, 230, 0.2), transparent);
          animation: subtle-glow 4s ease-in-out infinite;
        }

        .cyber-floating-orbs {
          position: absolute;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(34, 139, 230, 0.4), rgba(168, 85, 247, 0.2));
          animation: floating-orb 12s infinite linear;
        }

        .cyber-floating-orbs:nth-child(1) {
          top: 20%;
          left: 10%;
          animation-delay: 0s;
          animation-duration: 15s;
        }

        .cyber-floating-orbs:nth-child(2) {
          top: 60%;
          right: 15%;
          animation-delay: -3s;
          animation-duration: 18s;
          background: radial-gradient(circle, rgba(168, 85, 247, 0.4), rgba(247, 131, 172, 0.2));
        }

        .cyber-floating-orbs:nth-child(3) {
          top: 80%;
          left: 70%;
          animation-delay: -7s;
          animation-duration: 20s;
          background: radial-gradient(circle, rgba(247, 131, 172, 0.3), rgba(34, 139, 230, 0.2));
        }

        .tool-message {
          font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace;
          position: relative;
          overflow: hidden;
        }

        .tool-message::after {
          content: '';
          position: absolute;
          top: -2px;
          left: -2px;
          right: -2px;
          bottom: -2px;
          background: linear-gradient(45deg, rgba(34, 139, 230, 0.1), rgba(168, 85, 247, 0.1));
          opacity: 0;
          transition: opacity 0.3s;
          border-radius: 12px;
          z-index: -1;
        }

        .tool-message:hover::after {
          opacity: 1;
        }

        .typing-indicator {
          display: inline-flex;
          gap: 4px;
          padding: 4px;
        }

        .typing-indicator span {
          width: 6px;
          height: 6px;
          background: rgba(34, 139, 230, 0.7);
          border-radius: 50%;
          animation: typing-pulse 1.4s infinite;
        }

        .typing-indicator span:nth-child(2) {
          animation-delay: 0.2s;
        }

        .typing-indicator span:nth-child(3) {
          animation-delay: 0.4s;
        }

        @keyframes typing-pulse {
          0%, 60%, 100% {
            transform: scale(0.8);
            opacity: 0.4;
          }
          30% {
            transform: scale(1);
            opacity: 1;
          }
        }

        .assistant-message::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: linear-gradient(90deg,
            transparent,
            currentColor 20%,
            currentColor 80%,
            transparent);
          opacity: 0.3;
        }

        .assistant-message:hover {
          transform: translateX(2px);
          transition: transform 0.2s ease;
        }

        .user-message:hover {
          transform: translateX(-2px);
          transition: transform 0.2s ease;
        }

        .assistant-message {
          border-right: 1px solid rgba(34, 139, 230, 0.2);
        }

        @keyframes pulse-glow {
          0%, 100% {
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), 0 0 20px rgba(34, 139, 230, 0.1);
          }
          50% {
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3), 0 0 30px rgba(34, 139, 230, 0.2);
          }
        }

        .typing-message::before {
          animation: blink 1s infinite;
        }

        @keyframes blink {
          0%, 50% { opacity: 0.7; }
          51%, 100% { opacity: 0.3; }
        }
      `}</style>

      <ScrollArea
        flex={1}
        p="lg"
        style={{
          background:
            "linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(20, 27, 45, 0.95) 100%)",
          backgroundImage: `
            radial-gradient(circle at 20% 80%, rgba(34, 139, 230, 0.03) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(168, 85, 247, 0.03) 0%, transparent 50%),
            radial-gradient(circle at 50% 50%, rgba(247, 131, 172, 0.02) 0%, transparent 60%)
          `,
          position: "relative",
          overflow: "hidden",
          overflowX: "hidden",
          width: "100%",
        }}
      >
        <Box
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: `
              repeating-linear-gradient(
                0deg,
                transparent 0px,
                transparent 2px,
                rgba(34, 139, 230, 0.005) 2px,
                rgba(34, 139, 230, 0.005) 4px
              )
            `,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        {/* Floating orbs */}
        <div className="cyber-floating-orbs" />
        <div className="cyber-floating-orbs" />
        <div className="cyber-floating-orbs" />
        <Box
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            maxWidth: "100%",
          }}
        >
          <Stack gap="lg" style={{ width: "100%", maxWidth: "100%" }}>
            {messageGroups.map((group, groupIndex) => (
              <MessageGroupComponent
                key={`group-${groupIndex}`}
                group={group}
              />
            ))}

            {/* Show streaming response with enhanced typing indicator */}
            {isLoading && currentResponse && (
              <Box>
                {/* Agent header for streaming */}
                <Text
                  size="xs"
                  style={{
                    fontFamily: "'SF Mono', Monaco, monospace",
                    color: getAgentColors(activeAgent?.name)?.text || "#228BE6",
                    letterSpacing: "0.05em",
                    opacity: 0.7,
                    marginBottom: "8px",
                    marginLeft: "0px",
                  }}
                >
                  [{getAgentDisplayName(activeAgent?.name)}]
                </Text>

                {/* Streaming group container */}
                <Box
                  style={{
                    border: `1px solid ${getAgentColors(activeAgent?.name)?.border || "#228BE6"}20`,
                    borderRadius: "12px",
                    padding: "8px",
                    background: `linear-gradient(135deg, ${getAgentColors(activeAgent?.name)?.bg || "rgba(34, 139, 230, 0.08)"} 0%, rgba(15, 23, 42, 0.5) 100%)`,
                  }}
                >
                  <Box
                    className="assistant-message typing-message"
                    p="lg"
                    data-agent-name={activeAgent?.name}
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(20, 27, 45, 0.95) 0%, rgba(15, 23, 42, 0.9) 100%)",
                      alignSelf: "flex-start",
                      maxWidth: "100%",
                      minWidth: 0,
                      width: "fit-content",
                      overflowWrap: "break-word",
                      wordBreak: "break-word",
                      overflowX: "hidden",
                      borderLeft: `3px solid ${getAgentColors(activeAgent?.name)?.border || "#228BE6"}`,
                      borderRadius: "0 8px 8px 0",
                      position: "relative",
                      boxShadow: "0 4px 24px rgba(0, 0, 0, 0.3)",
                      clipPath:
                        "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)",
                      marginTop: "0px",
                      borderRight: `1px solid ${getAgentColors(activeAgent?.name)?.border || "#228BE6"}20`,
                      animation: "pulse-glow 2s ease-in-out infinite",
                    }}
                  >
                    <Group gap="xs" align="flex-start">
                      <Box
                        flex={1}
                        style={{
                          minWidth: 0,
                          maxWidth: "100%",
                          width: "100%",
                          overflowWrap: "break-word",
                          wordBreak: "break-word",
                          overflowX: "hidden",
                          color: "#CBD5E1",
                          fontFamily: "system-ui, -apple-system, sans-serif",
                          fontSize: "14px",
                          lineHeight: "1.6",
                          letterSpacing: "0.02em",
                        }}
                      >
                        <ReactMarkdown>{currentResponse}</ReactMarkdown>
                      </Box>
                      <div className="typing-indicator">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </Group>
                  </Box>
                </Box>
              </Box>
            )}
            <div ref={messagesEndRef} />
          </Stack>
        </Box>
      </ScrollArea>

      <Box
        p="lg"
        style={{
          borderTop: "2px solid rgba(34, 139, 230, 0.4)",
          background:
            "linear-gradient(135deg, rgba(30, 41, 59, 0.98) 0%, rgba(51, 65, 85, 0.95) 100%)",
          backgroundImage: `
            radial-gradient(circle at 20% 80%, rgba(34, 139, 230, 0.08) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(168, 85, 247, 0.08) 0%, transparent 50%)
          `,
          boxShadow:
            "0 -8px 32px rgba(0, 0, 0, 0.4), 0 0 60px rgba(34, 139, 230, 0.15)",
          position: "relative",
        }}
      >
        <Group gap="sm" align="flex-end">
          <Textarea
            style={{ flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={
              apiKey
                ? "Let's start"
                : "Please enter your API key to start chatting"
            }
            disabled={isLoading || !apiKey}
            autosize
            minRows={1}
            maxRows={8}
            styles={{
              input: {
                backgroundColor: "rgba(15, 23, 42, 0.95)",
                border: "2px solid rgba(34, 139, 230, 0.3)",
                borderRadius: "12px",
                padding: "16px 20px",
                fontSize: "16px",
                lineHeight: "1.5",
                resize: "none",
                transition: "all 0.2s ease",
                fontFamily: "system-ui, -apple-system, sans-serif",
                "&:focus": {
                  borderColor: "rgba(34, 139, 230, 0.6)",
                  boxShadow:
                    "0 0 0 3px rgba(34, 139, 230, 0.1), 0 0 20px rgba(34, 139, 230, 0.15), 0 4px 20px rgba(0, 0, 0, 0.15)",
                  transform: "translateY(-1px)",
                  backgroundColor: "rgba(15, 23, 42, 1)",
                },
                "&:hover:not(:disabled)": {
                  borderColor: "rgba(34, 139, 230, 0.4)",
                  transform: "translateY(-1px)",
                  boxShadow: "0 2px 12px rgba(34, 139, 230, 0.1)",
                },
                "&::placeholder": {
                  color: "rgba(148, 163, 184, 0.6)",
                  fontSize: "15px",
                  letterSpacing: "0.02em",
                },
              },
            }}
          />
        </Group>

        {apiKey && (
          <Text
            size="xs"
            mt="sm"
            ta="center"
            style={{
              opacity: 0.6,
              fontFamily: "monospace",
              letterSpacing: "0.05em",
              color: "rgba(148, 163, 184, 0.8)",
              textTransform: "uppercase",
              fontSize: "11px",
            }}
          >
            [ENTER] → TRANSMIT • [SHIFT+ENTER] → NEWLINE
          </Text>
        )}
      </Box>
    </Box>
  );
}
