"use client";

import {
  SandpackCodeEditor,
  SandpackFileExplorer,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  SandpackStack,
} from "@codesandbox/sandpack-react";
import { Box, Button, Text } from "@mantine/core";
import { IconReload } from "@tabler/icons-react";
import {
  Component,
  ErrorInfo,
  ReactNode,
  useEffect,
  useState,
} from "react";

interface ComponentSandboxProps {
  sessionId: string;
  onFileCountChange?: (count: number) => void;
  forceRestart?: boolean;
  showTabs?: boolean;
}

// Custom Error Boundary for Sandpack
interface SandpackErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class SandpackErrorBoundary extends Component<
  { children: ReactNode },
  SandpackErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): SandpackErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Sandpack Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box
          p="xl"
          style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          <div>
            <Text c="red" size="lg" fw={500} mb="md">
              Sandbox Error
            </Text>
            <Text c="dimmed" size="sm" mb="lg">
              The sandbox encountered an error and couldn't load.
            </Text>
            <Button
              onClick={() => {
                this.setState({ hasError: false, error: undefined });
                window.location.reload();
              }}
              leftSection={<IconReload size={16} />}
            >
              Restart Sandbox
            </Button>
          </div>
        </Box>
      );
    }

    return this.props.children;
  }
}

interface WorkspaceFile {
  path: string;
  content: string;
}

export default function ComponentSandbox({
  sessionId,
  onFileCountChange,
  forceRestart,
  showTabs = false,
}: ComponentSandboxProps) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packageJsonDeps, setPackageJsonDeps] = useState<
    Record<string, string>
  >({});
  const [sandpackKey, setSandpackKey] = useState(0); // Force Sandpack to re-instantiate
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadWorkspaceFiles = async (forceRefresh = false) => {
    return;
  };

  // const loadWorkspaceFiles = async (forceRefresh = false) => {
  //   if (forceRefresh) {
  //     setIsRefreshing(true);
  //     // Clear existing files for a clean slate
  //     setFiles({});
  //   } else {
  //     setLoading(true);
  //   }
  //   setError(null);

  //   try {
  //     // Fetch files via API with cache buster
  //     const params = new URLSearchParams({
  //       sessionId,
  //       backendType: backendConfig.type,
  //       timestamp: Date.now().toString(), // Cache buster
  //       ...(backendConfig.type === "remote" && {
  //         host: backendConfig.host || "",
  //         username: backendConfig.username || "",
  //         workspace: backendConfig.workspace || "",
  //       }),
  //     });

  //     const response = await fetch(`/api/sandbox-files?${params}`, {
  //       cache: "no-store",
  //       headers: {
  //         "Cache-Control": "no-cache",
  //       },
  //     });
  //     if (!response.ok) {
  //       throw new Error(`Failed to fetch files: ${response.statusText}`);
  //     }

  //     const data = await response.json();
  //     const sandpackFiles: Record<string, string> = {};
  //     let deps: Record<string, string> = {};

  //     console.log(
  //       "[ComponentSandbox] Loading",
  //       data.files?.length || 0,
  //       "files from workspace",
  //     );

  //     // Process files from API response
  //     if (data.files && data.files.length > 0) {
  //       console.log(
  //         "[ComponentSandbox] Processing",
  //         data.files.length,
  //         "files from API",
  //       );
  //       for (const file of data.files) {
  //         let sandpackPath = file.path.startsWith("/")
  //           ? file.path
  //           : `/${file.path}`;

  //         // Handle src directory files - map them to root for Sandpack
  //         if (sandpackPath.startsWith("/src/")) {
  //           // Also include the file at root level for Sandpack compatibility
  //           const rootPath = sandpackPath.replace("/src/", "/");
  //           sandpackFiles[rootPath] = file.content;
  //           console.log(
  //             "[ComponentSandbox] Mapped src file to root:",
  //             rootPath,
  //           );
  //         }

  //         sandpackFiles[sandpackPath] = file.content;
  //         console.log("[ComponentSandbox] Added to sandpack:", sandpackPath);

  //         // Extract dependencies from package.json
  //         if (
  //           file.path === "package.json" ||
  //           file.path.endsWith("/package.json")
  //         ) {
  //           try {
  //             const pkg = JSON.parse(file.content);
  //             deps = { ...pkg.dependencies, ...pkg.devDependencies };
  //             // Filter out local dependencies and AgentBackend
  //             delete deps["agent-backend"];
  //             Object.keys(deps).forEach((key) => {
  //               if (
  //                 deps[key].startsWith("file:") ||
  //                 deps[key].startsWith("link:")
  //               ) {
  //                 delete deps[key];
  //               }
  //             });
  //           } catch {}
  //         }
  //       }
  //     }

  //     // Log what we're setting
  //     console.log(
  //       "[ComponentSandbox] Setting files:",
  //       Object.keys(sandpackFiles),
  //     );
  //     console.log("[ComponentSandbox] Setting deps:", Object.keys(deps));

  //     setFiles(sandpackFiles);
  //     setPackageJsonDeps(deps);
  //     onFileCountChange?.(Object.keys(sandpackFiles).length);
  //     // Force Sandpack to completely re-instantiate with new files
  //     setSandpackKey((prev) => {
  //       const newKey = prev + 1;
  //       console.log(
  //         "[ComponentSandbox] Incrementing sandpackKey from",
  //         prev,
  //         "to",
  //         newKey,
  //       );
  //       return newKey;
  //     });
  //   } catch (err) {
  //     console.error("Failed to load workspace files:", err);
  //     setError(
  //       err instanceof Error ? err.message : "Failed to load workspace files",
  //     );
  //   } finally {
  //     setLoading(false);
  //     setIsRefreshing(false);
  //   }
  // };

  // Load files on mount and when backend config changes
  useEffect(() => {
    loadWorkspaceFiles();
  }, [sessionId]);

  // Listen for filesystem updates from chat
  useEffect(() => {
    const handleUpdate = () => {
      console.log(
        "[ComponentSandbox] Received filesystem-update event, reloading files...",
      );
      // Add a small delay to ensure files are written
      setTimeout(() => {
        loadWorkspaceFiles(true);
      }, 500);
    };

    window.addEventListener("filesystem-update", handleUpdate);
    return () => {
      window.removeEventListener("filesystem-update", handleUpdate);
    };
  }, [sessionId]);

  // Handle force restart from parent - must be before conditional returns
  useEffect(() => {
    if (forceRestart) {
      const doRestart = async () => {
        console.log("[ComponentSandbox] Force restart initiated");
        setFiles({});
        setPackageJsonDeps({});
        setError(null);
        setSandpackKey((prev) => prev + 100);
        await new Promise((resolve) => setTimeout(resolve, 500));
        await loadWorkspaceFiles(true);
      };
      doRestart();
    }
  }, [forceRestart]);

  if (loading) {
    return (
      <Box
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background:
            "radial-gradient(circle at 50% 50%, rgba(34, 139, 230, 0.03) 0%, transparent 50%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <style>{`
          @keyframes glitch {
            0%, 100% {
              text-shadow:
                0.02em 0 0 rgba(255, 0, 0, 0.75),
                -0.02em -0 0 rgba(0, 255, 255, 0.75);
            }
            25% {
              text-shadow:
                0.05em 0 0 rgba(255, 0, 0, 0.75),
                -0.05em -0 0 rgba(0, 255, 255, 0.75);
            }
            50% {
              text-shadow:
                -0.025em 0.025em 0 rgba(255, 0, 0, 0.75),
                0.025em -0.025em 0 rgba(0, 255, 255, 0.75);
            }
            75% {
              text-shadow:
                -0.05em 0 0 rgba(255, 0, 0, 0.75),
                0.05em -0 0 rgba(0, 255, 255, 0.75);
            }
          }

          @keyframes cyber-pulse {
            0%, 100% {
              opacity: 0.5;
              transform: scale(0.8);
            }
            50% {
              opacity: 1;
              transform: scale(1);
            }
          }

          @keyframes data-stream {
            0% { transform: translateY(100%); opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { transform: translateY(-100%); opacity: 0; }
          }

          .cyber-loader {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
          }

          .cyber-spinner {
            width: 60px;
            height: 60px;
            position: relative;
            animation: cyber-pulse 2s ease-in-out infinite;
          }

          .cyber-spinner::before,
          .cyber-spinner::after {
            content: '';
            position: absolute;
            border: 2px solid transparent;
            border-top-color: #228BE6;
            border-right-color: #A855F7;
            border-radius: 50%;
            inset: 0;
          }

          .cyber-spinner::before {
            animation: spin 1s linear infinite;
          }

          .cyber-spinner::after {
            animation: spin 1.5s linear infinite reverse;
            inset: 6px;
            border-bottom-color: #F783AC;
            border-left-color: #228BE6;
          }

          @keyframes spin {
            to { transform: rotate(360deg); }
          }

          .data-rain {
            position: absolute;
            width: 100%;
            height: 100%;
            overflow: hidden;
            opacity: 0.1;
          }

          .data-stream {
            position: absolute;
            font-family: monospace;
            font-size: 10px;
            color: #228BE6;
            animation: data-stream 3s linear infinite;
          }
        `}</style>

        <div className="data-rain">
          {[...Array(10)].map((_, i) => (
            <div
              key={i}
              className="data-stream"
              style={{
                left: `${i * 10}%`,
                animationDelay: `${i * 0.3}s`,
                fontSize: `${8 + Math.random() * 4}px`,
              }}
            >
              {Array(20)
                .fill(0)
                .map(() => (Math.random() > 0.5 ? "1" : "0"))
                .join("")}
            </div>
          ))}
        </div>

        <div className="cyber-loader">
          <div className="cyber-spinner" />
          <Text
            size="md"
            fw={500}
            style={{
              fontFamily: "monospace",
              letterSpacing: "0.1em",
              animation: "glitch 2s infinite",
              color: "var(--mantine-color-blue-4)",
            }}
          >
            INITIALIZING WORKSPACE
          </Text>
          <Text
            size="xs"
            style={{
              fontFamily: "monospace",
              color: "var(--mantine-color-dimmed)",
              opacity: 0.8,
            }}
          >
            [LOADING FILES...]
          </Text>
        </div>
      </Box>
    );
  }

  if (error) {
    return (
      <Box p="xl" style={{ height: "100%" }}>
        <Text c="red" mb="md">
          Error: {error}
        </Text>
        <Button
          onClick={() => loadWorkspaceFiles(true)}
          leftSection={<IconReload size={16} />}
        >
          Retry
        </Button>
      </Box>
    );
  }

  if (Object.keys(files).length === 0) {
    return (
      <Box
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "radial-gradient(circle at 50% 50%, rgba(34, 139, 230, 0.03) 0%, transparent 50%)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Animated background grid */}
        <style>{`
          @keyframes pulseGrid {
            0%, 100% { opacity: 0.05; }
            50% { opacity: 0.15; }
          }
          @keyframes scanline {
            0% { transform: translateY(-2px); }
            100% { transform: translateY(calc(100vh + 2px)); }
          }
          @keyframes flicker {
            0%, 100% { opacity: 0.8; }
            50% { opacity: 1; }
          }
          .cyber-grid {
            position: absolute;
            width: 100%;
            height: 100%;
            background-image:
              linear-gradient(0deg, transparent 24%, rgba(34, 139, 230, 0.05) 25%, rgba(34, 139, 230, 0.05) 26%, transparent 27%, transparent 74%, rgba(168, 85, 247, 0.05) 75%, rgba(168, 85, 247, 0.05) 76%, transparent 77%, transparent),
              linear-gradient(90deg, transparent 24%, rgba(34, 139, 230, 0.05) 25%, rgba(34, 139, 230, 0.05) 26%, transparent 27%, transparent 74%, rgba(168, 85, 247, 0.05) 75%, rgba(168, 85, 247, 0.05) 76%, transparent 77%, transparent);
            background-size: 50px 50px;
            animation: pulseGrid 20s ease-in-out infinite;
          }
          .scanline {
            position: absolute;
            width: 100%;
            height: 2px;
            background: linear-gradient(90deg, transparent, rgba(34, 139, 230, 0.8), transparent);
            animation: scanline 30s linear infinite;
            top: 0;
          }
          .scanline:nth-child(3) {
            animation-delay: 10s;
            opacity: 0.6;
          }
          .scanline:nth-child(4) {
            animation-delay: 20s;
            opacity: 0.4;
          }
        `}</style>
        <div className="cyber-grid" />
        <div className="scanline" />
        <div className="scanline" />
        <div className="scanline" />

        <Box
          style={{
            textAlign: "center",
            maxWidth: "500px",
            position: "relative",
            zIndex: 1,
          }}
        >
          <Text
            size="xl"
            fw={300}
            mb="sm"
            style={{
              backgroundImage:
                "linear-gradient(135deg, #228BE6 0%, #A855F7 100%)",
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              animation: "flicker 10s ease-in-out infinite",
            }}
          >
            The Grid Awaits
          </Text>
          <Text size="sm" c="dimmed" mb="lg" style={{ lineHeight: 1.6 }}>
            Neural pathways ready. Data streams initialized.
          </Text>
          <Text
            size="sm"
            fw={500}
            style={{
              color: "var(--mantine-color-blue-4)",
              animation: "flicker 8s ease-in-out infinite",
            }}
          >
            → Ask the AI to craft your first component
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box style={{ height: "100%", overflow: "hidden" }}>
      <style>{`
          /* Sandpack container constraints */
          .sp-wrapper {
            height: 100%;
            max-height: 100%;
          }
          .sp-layout {
            height: 100%;
            max-height: 100%;
            display: flex;
          }
          
          /* Hide SandpackPreview refresh and open sandbox buttons */
          .sp-preview-actions,
          .sp-button[title="Refresh Sandbox"],
          .sp-button[title="Open Sandbox"],
          .sp-button[title="Open in CodeSandbox"],
          .sp-preview .sp-button-group,
          .sp-preview-container .sp-button-group {
            display: none !important;
          }
        `}</style>
      <SandpackProvider
        key={`sandbox-${sandpackKey}-${Object.keys(files).length}`} // Include file count in key for extra safety
        template="react-ts"
        options={{
          autorun: true,
          recompileMode: "delayed",
          recompileDelay: 300,
          initMode: "lazy",
          activeFile: files["/App.tsx"]
            ? "/App.tsx"
            : files["/App.jsx"]
              ? "/App.jsx"
              : "/index.tsx",
          externalResources: [],
          bundlerURL: undefined, // Use default bundler to avoid CORS issues
        }}
        files={{
          ...files,
          // Ensure we have all required files for Sandpack react-ts template
          ...(!files["/index.tsx"] && !files["/index.jsx"]
            ? {
              "/index.tsx": `import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';

const rootElement = document.getElementById('root')!;
const root = ReactDOM.createRoot(rootElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,
            }
            : {}),
          ...(!files["/App.tsx"] && !files["/App.jsx"]
            ? {
              "/App.tsx": `export default function App() {
  return (
    <div className="App">
      <h1>AgentBackend Workspace</h1>
      <p>Check the file explorer to see your workspace files.</p>
    </div>
  );
}`,
            }
            : {}),
          ...(!files["/styles.css"]
            ? {
              "/styles.css": `body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  margin: 0;
  padding: 20px;
}

.App {
  text-align: center;
}`,
            }
            : {}),
          ...(!files["/public/index.html"]
            ? {
              "/public/index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>React App</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`,
            }
            : {}),
        }}
        customSetup={{
          dependencies: {
            // Filter out problematic dependencies that can cause resolution issues
            ...Object.fromEntries(
              Object.entries(packageJsonDeps).filter(([key, value]) => {
                // Remove null/undefined values
                if (!value || value === "null" || value === "undefined")
                  return false;
                // Remove local file dependencies that can't be resolved
                if (
                  typeof value === "string" &&
                  (value.startsWith("file:") || value.startsWith("link:"))
                )
                  return false;
                // Remove AgentBackend and other problematic packages
                if (key === "agent-backend" || key === "ssh2") return false;
                return true;
              }),
            ),
            // Ensure React dependencies are included with specific versions
            react: "^18.2.0",
            "react-dom": "^18.2.0",
            "@types/react": "^18.2.0",
            "@types/react-dom": "^18.2.0",
          },
        }}
        theme="dark"
      >
        <SandpackErrorBoundary>
          <SandpackLayout style={{ height: "100%" }}>
            {showTabs && (
              <SandpackStack style={{ height: "100%" }}>
                <SandpackFileExplorer style={{ height: "30%" }} />
                <SandpackCodeEditor
                  showTabs
                  closableTabs
                  style={{ height: "70%" }}
                />
              </SandpackStack>
            )}
            <SandpackPreview style={{ height: "100%", minWidth: "75%" }} />
          </SandpackLayout>
        </SandpackErrorBoundary>
      </SandpackProvider>
    </Box>
  );
}
