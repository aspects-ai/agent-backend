"use client";

import { Box, Button, Container, Group, Tabs, Text } from '@mantine/core';
import { IconReload } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import ApiKeyModal from './components/ApiKeyModal';
import Chat from './components/Chat';
import ComponentSandbox from './components/ComponentSandbox';
import FileExplorer from './components/FileExplorer';
import FileViewer from './components/FileViewer';
import StatusBar from './components/StatusBar';

function FileExplorerTab({
  sessionId,
}: {
  sessionId: string;
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <Box style={{ height: "100%", display: "flex", overflow: "hidden" }}>
      <FileExplorer
        sessionId={sessionId}
        onFileSelect={setSelectedFile}
        selectedFile={selectedFile}
      />
      <FileViewer
        sessionId={sessionId}
        selectedFile={selectedFile}
      />
    </Box>
  );
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string>("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>("files");
  // Get backend type from environment (set at build time)
  const backendType = (process.env.NEXT_PUBLIC_AGENTBE_TYPE as 'local' | 'remote') || 'local';
  const [showTabs, setShowTabs] = useState(true);
  const [sandboxFileCount, setSandboxFileCount] = useState(0);
  const [sandboxForceRestart, setSandboxForceRestart] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [matrixData, setMatrixData] = useState<
    Array<{ chars: string[]; delay: number; duration: number }>
  >([]);

  useEffect(() => {
    setIsClient(true);

    const id = Math.random()
      .toString(36)
      .substring(2, 10)
      .replace(/[^a-z0-9]/g, "x");
    setSessionId(id);

    // Generate deterministic matrix data
    const columns = Array(20)
      .fill(0)
      .map((_, i) => {
        const chars = Array(100)
          .fill(0)
          .map((_, j) => {
            // Use a deterministic seed based on column and row
            const seed = (i * 100 + j) * 1234567;
            return seed % 2 === 0 ? "1" : "0";
          });
        return {
          chars,
          delay: (i * 2) % 20, // Deterministic delay
          duration: 15 + (i % 10), // Deterministic duration
        };
      });
    setMatrixData(columns);

    const envApiKey = process.env.NEXT_PUBLIC_CODEBUFF_API_KEY;
    if (envApiKey) {
      setApiKey(envApiKey);
      setShowApiKeyModal(false);
    } else {
      setShowApiKeyModal(true);
    }

  }, []);

  const handleApiKeySubmit = (key: string) => {
    setApiKey(key);
    setShowApiKeyModal(false);
  };


  if (!sessionId) {
    return (
      <Container
        size="xl"
        h="100vh"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0F172A",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <style>{`
          @keyframes matrix-rain {
            0% { transform: translateY(-100%); }
            100% { transform: translateY(100vh); }
          }

          @keyframes neon-flicker {
            0%, 19%, 21%, 23%, 25%, 54%, 56%, 100% {
              text-shadow:
                0 0 4px #fff,
                0 0 11px #fff,
                0 0 19px #fff,
                0 0 40px #228BE6,
                0 0 80px #228BE6,
                0 0 90px #228BE6,
                0 0 100px #228BE6,
                0 0 150px #228BE6;
            }
            20%, 24%, 55% {
              text-shadow: none;
            }
          }

          @keyframes cyber-glitch {
            0%, 100% {
              clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
            }
            25% {
              clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%);
              transform: translateX(-2px);
            }
            50% {
              clip-path: polygon(0 55%, 100% 55%, 100% 100%, 0 100%);
              transform: translateX(2px);
            }
            75% {
              clip-path: polygon(0 40%, 100% 40%, 100% 60%, 0 60%);
              transform: translateY(2px);
            }
          }

          .matrix-bg {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            opacity: 0.05;
          }

          .matrix-column {
            position: absolute;
            top: -100%;
            font-family: monospace;
            font-size: 12px;
            color: #228BE6;
            animation: matrix-rain 20s linear infinite;
            text-shadow: 0 0 5px currentColor;
          }

          .init-container {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 30px;
          }

          .cyber-border {
            position: absolute;
            inset: -2px;
            background: linear-gradient(45deg, #228BE6, #A855F7, #F783AC, #228BE6);
            background-size: 400% 400%;
            animation: gradient-shift 3s ease infinite;
            clip-path: polygon(
              0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%,
              0 100%, 0 0,
              2px 2px, 2px calc(100% - 2px), calc(100% - 20px - 2px) calc(100% - 2px),
              calc(100% - 2px) calc(100% - 20px - 2px), calc(100% - 2px) 2px, 2px 2px
            );
          }

          @keyframes gradient-shift {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
          }
        `}</style>

        <div className="matrix-bg">
          {isClient &&
            matrixData.map((column, i) => (
              <div
                key={i}
                className="matrix-column"
                style={{
                  left: `${i * 5}%`,
                  animationDelay: `${column.delay}s`,
                  animationDuration: `${column.duration}s`,
                }}
              >
                {column.chars.map((char, j) => (
                  <div key={j}>{char}</div>
                ))}
              </div>
            ))}
        </div>

        <div className="init-container">
          <Box style={{ position: "relative", padding: "40px 60px" }}>
            <div className="cyber-border" />
            <Text
              size="xl"
              fw={700}
              style={{
                fontFamily: "monospace",
                letterSpacing: "0.2em",
                animation: "neon-flicker 1.5s infinite alternate",
                color: "#fff",
                position: "relative",
              }}
            >
              <span style={{ animation: "cyber-glitch 3s infinite" }}>
                SYSTEM.INIT
              </span>
            </Text>
          </Box>

          <Box style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {[...Array(3)].map((_, i) => (
              <Box
                key={i}
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "linear-gradient(45deg, #228BE6, #A855F7)",
                  animation: `cyber-pulse 1.5s ${i * 0.3}s ease-in-out infinite`,
                }}
              />
            ))}
          </Box>

          <Text
            size="xs"
            style={{
              fontFamily: "monospace",
              color: "var(--mantine-color-blue-4)",
              opacity: 0.8,
              letterSpacing: "0.1em",
            }}
          >
            [ESTABLISHING_NEURAL_LINK]
          </Text>
        </div>
      </Container>
    );
  }

  return (
    <>
      <ApiKeyModal opened={showApiKeyModal} onSubmit={handleApiKeySubmit} />

      <Box
        style={{
          height: "100vh",
          display: "flex",
          backgroundColor: "#0F172A",
        }}
      >
        {/* Left Ribbon Bar */}
        <Box
          style={{
            width: "20px",
            background:
              "linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.95) 100%)",
            borderRight: "2px solid transparent",
            borderImage: "linear-gradient(180deg, #228BE6, #A855F7, #F783AC) 1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flexShrink: 0,
            boxShadow:
              "8px 0 32px rgba(0, 0, 0, 0.3), inset -1px 0 0 rgba(255, 255, 255, 0.1)",
            backdropFilter: "blur(20px)",
            position: "relative",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <Box
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background:
                "radial-gradient(circle at 50% 20%, rgba(34, 139, 230, 0.05) 0%, transparent 50%), radial-gradient(circle at 50% 80%, rgba(168, 85, 247, 0.05) 0%, transparent 50%)",
              animation: "headerGlow 8s ease-in-out infinite alternate",
            }}
          />

          <Box
            style={{
              position: "relative",
              zIndex: 1,
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              overflow: "hidden",
            }}
          >
            <Box
              style={{
                transform: "rotate(-90deg)",
                transformOrigin: "center",
                whiteSpace: "nowrap",
                height: "100vh",
                display: "flex",
                alignItems: "center",
                position: "relative",
                overflow: "hidden",
                width: "100vh",
              }}
            >
              <Text
                size="xs"
                fw={600}
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, #228BE6 0%, #A855F7 50%, #F783AC 100%)",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  fontSize: "9px",
                  letterSpacing: "0.1em",
                  animation: "scrollBanner 30s linear infinite",
                  position: "absolute",
                }}
              >
                ✨ BUILD • CODE • DREAM • SHIP • REPEAT ✨ POWERED BY AI •
                INFINITE POSSIBILITIES • CREATE THE FUTURE ✨ BUILD • CODE •
                DREAM • SHIP • REPEAT ✨ POWERED BY AI • INFINITE POSSIBILITIES
                • CREATE THE FUTURE ✨ BUILD • CODE • DREAM • SHIP • REPEAT ✨
                POWERED BY AI • INFINITE POSSIBILITIES • CREATE THE FUTURE ✨
                BUILD • CODE • DREAM • SHIP • REPEAT ✨ POWERED BY AI • INFINITE
                POSSIBILITIES • CREATE THE FUTURE ✨ BUILD • CODE • DREAM • SHIP
                • REPEAT ✨ POWERED BY AI • INFINITE POSSIBILITIES • CREATE THE
                FUTURE ✨
              </Text>
            </Box>
          </Box>
        </Box>

        {/* Main content area */}
        <Box
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            padding: "24px",
            gap: "24px",
            overflow: "hidden",
          }}
        >
          <Box
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Box
              style={{
                flex: 1,
                minHeight: 0,
                background:
                  "linear-gradient(135deg, var(--mantine-color-dark-6) 0%, var(--mantine-color-dark-7) 100%)",
                backgroundImage:
                  "radial-gradient(circle at 30% 70%, rgba(34, 139, 230, 0.05) 0%, transparent 50%)",
                borderRadius: "20px",
                border: "1px solid rgba(34, 139, 230, 0.2)",
                boxShadow:
                  "0 12px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                transition: "all 0.3s ease",
              }}
            >
              <Tabs
                value={activeTab}
                onChange={setActiveTab}
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                }}
                styles={{
                  list: {
                    backgroundColor: "var(--mantine-color-dark-5)",
                    borderBottom: "1px solid var(--mantine-color-dark-4)",
                    padding: "0 24px",
                    paddingTop: "8px",
                    display: showTabs ? "flex" : "none",
                  },
                  tab: {
                    fontSize: "14px",
                    fontWeight: 500,
                    padding: "12px 20px",
                    "&:hover": {
                      backgroundColor: "var(--mantine-color-dark-4)",
                    },
                    "&[dataActive]": {
                      backgroundColor: "var(--mantine-color-blue-9)",
                      color: "var(--mantine-color-blue-1)",
                    },
                  },
                }}
              >
                <Tabs.List>
                  <Tabs.Tab value="files">Workspace Files</Tabs.Tab>
                  <Tabs.Tab value="sandbox">Component Sandbox</Tabs.Tab>
                  {activeTab === "sandbox" && showTabs && (
                    <Box style={{ marginLeft: "auto", padding: "8px 12px" }}>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={() => {
                          setSandboxForceRestart(true);
                          setTimeout(() => setSandboxForceRestart(false), 100);
                        }}
                        leftSection={<IconReload size={12} />}
                      >
                        Force Restart
                      </Button>
                    </Box>
                  )}
                </Tabs.List>

                <Box style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                  <Tabs.Panel
                    value="files"
                    style={{ height: "100%", overflow: "hidden" }}
                  >
                    <FileExplorerTab
                      sessionId={sessionId}
                    />
                  </Tabs.Panel>

                  <Tabs.Panel
                    value="sandbox"
                    style={{
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <ComponentSandbox
                      sessionId={sessionId}
                      onFileCountChange={setSandboxFileCount}
                      forceRestart={sandboxForceRestart}
                      showTabs={showTabs}
                    />
                  </Tabs.Panel>

                </Box>
              </Tabs>
            </Box>
          </Box>

          {/* Chat side panel */}
          <Box
            style={{
              width: "400px",
              flexShrink: 0,
              background:
                "linear-gradient(135deg, var(--mantine-color-dark-6) 0%, var(--mantine-color-dark-7) 100%)",
              backgroundImage:
                "radial-gradient(circle at 70% 30%, rgba(168, 85, 247, 0.05) 0%, transparent 50%)",
              borderRadius: "20px",
              border: "1px solid rgba(34, 139, 230, 0.2)",
              boxShadow:
                "0 12px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              transition: "all 0.3s ease",
            }}
          >
            <Box
              p="md"
              pb="xs"
              style={{
                borderBottom: "2px solid transparent",
                borderImage:
                  "linear-gradient(90deg, rgba(34, 139, 230, 0.3), rgba(168, 85, 247, 0.3), rgba(247, 131, 172, 0.3)) 1",
                background:
                  "linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 100%)",
                padding: "20px 24px",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <style>{`
                @keyframes cyber-scan {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(200%); }
                }

                @keyframes status-pulse {
                  0%, 100% { opacity: 0.4; }
                  50% { opacity: 1; }
                }

                .status-indicator {
                  display: inline-block;
                  width: 8px;
                  height: 8px;
                  background: radial-gradient(circle, #10B981, #059669);
                  border-radius: 50%;
                  margin-right: 8px;
                  animation: status-pulse 2s ease-in-out infinite;
                  box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
                }
              `}</style>

              <Box className="cyber-header" style={{ position: "relative" }}>
                <Group justify="space-between" align="center">
                  <Box>
                    <Group gap="xs" align="center">
                      <Text
                        size="lg"
                        fw={700}
                        style={{
                          fontFamily:
                            "'SF Mono', Monaco, 'Cascadia Code', monospace",
                          letterSpacing: "0.1em",
                          background:
                            "linear-gradient(135deg, #60A5FA 0%, #A78BFA 50%, #F9A8D4 100%)",
                          backgroundClip: "text",
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                          textTransform: "uppercase",
                          fontSize: "16px",
                        }}
                      >
                        CYBERBUFFY_v2.0
                      </Text>
                      <span className="status-indicator" />
                      <Text
                        size="xs"
                        style={{
                          color: "#10B981",
                          fontFamily: "monospace",
                          letterSpacing: "0.05em",
                          opacity: 0.9,
                        }}
                      >
                        [ONLINE]
                      </Text>
                    </Group>
                    <Text
                      size="xs"
                      style={{
                        fontFamily: "monospace",
                        color: "rgba(148, 163, 184, 0.7)",
                        letterSpacing: "0.05em",
                        marginTop: "4px",
                      }}
                    >
                      NEURAL.LINK::ACTIVE | CODEGEN.MODULE::READY
                    </Text>
                  </Box>

                  <Group
                    gap="lg"
                    style={{
                      fontFamily: "monospace",
                      fontSize: "11px",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {sandboxFileCount > 0 && (
                      <Text
                        size="xs"
                        style={{
                          color: "rgba(96, 165, 250, 0.7)",
                        }}
                      >
                        SANDBOX.FILES::{sandboxFileCount}
                      </Text>
                    )}
                  </Group>
                </Group>
              </Box>
            </Box>
            <StatusBar sessionId={sessionId} backendType={backendType} />
            <Box style={{ flex: 1, minHeight: 0 }}>
              <Chat
                sessionId={sessionId}
                apiKey={apiKey}
              />
            </Box>
          </Box>
        </Box>

        {/* Right Ribbon Bar */}
        <Box
          style={{
            width: "20px",
            background:
              "linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.95) 100%)",
            borderLeft: "2px solid transparent",
            borderImage: "linear-gradient(180deg, #228BE6, #A855F7, #F783AC) 1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flexShrink: 0,
            boxShadow:
              "-8px 0 32px rgba(0, 0, 0, 0.3), inset 1px 0 0 rgba(255, 255, 255, 0.1)",
            backdropFilter: "blur(20px)",
            position: "relative",
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <Box
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background:
                "radial-gradient(circle at 50% 20%, rgba(34, 139, 230, 0.05) 0%, transparent 50%), radial-gradient(circle at 50% 80%, rgba(168, 85, 247, 0.05) 0%, transparent 50%)",
              animation: "headerGlow 8s ease-in-out infinite alternate",
            }}
          />

          <Box
            style={{
              position: "relative",
              zIndex: 1,
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              overflow: "hidden",
            }}
          >
            <Box
              style={{
                transform: "rotate(90deg)",
                transformOrigin: "center",
                whiteSpace: "nowrap",
                height: "100vh",
                display: "flex",
                alignItems: "center",
                position: "relative",
                overflow: "hidden",
                width: "100vh",
              }}
            >
              <Text
                size="xs"
                fw={600}
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, #228BE6 0%, #A855F7 50%, #F783AC 100%)",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  fontSize: "9px",
                  letterSpacing: "0.1em",
                  animation: "scrollBannerLeftToRight 30s linear infinite",
                  position: "absolute",
                }}
              >
                ✨ SECURE • SANDBOXED • FILESYSTEM • CHARLES ✨ THE • SARDINE 🐟
                • EATER • EXCELLENCE ✨ FUSE • SSH • DOCKER • AGENT ✨
                SECURE • SANDBOXED • FILESYSTEM • INNOVATION ✨ TYPESCRIPT •
                PYTHON • MULTI-BACKEND • EXCELLENCE ✨ FUSE • SSH • DOCKER •
                AGENT ✨ SECURE • SANDBOXED • FILESYSTEM • FIRE 🔥
                TYPESCRIPT • PYTHON • MULTI-BACKEND • EXCELLENCE ✨ FUSE • SSH •
                DOCKER • AGENT ✨
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  );
}
