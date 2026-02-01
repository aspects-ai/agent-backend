import { NextRequest, NextResponse } from 'next/server'
import { createFileSystem, initAgentBackend } from '../../../lib/backends-init'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const filePath = searchParams.get('filePath')

    if (!sessionId || !filePath) {
      return new NextResponse('Missing required parameters', { status: 400 })
    }

    console.log('Sandbox-render API: sessionId =', JSON.stringify(sessionId))

    // Initialize AgentBackend configuration
    initAgentBackend()

    // Create FileSystem instance
    const fs = createFileSystem(sessionId)

    try {
      const workspace = await fs.getWorkspace('default')
      const componentCode = await workspace.readFile(filePath, 'utf-8') as string
      const html = generateEnhancedSandboxHTML(componentCode, filePath)

      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'SAMEORIGIN'
        }
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return new NextResponse(`
        <!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body style="font-family: sans-serif; padding: 20px;">
          <h2 style="color: #c00;">Failed to load component</h2>
          <p>${errorMessage}</p>
        </body>
        </html>
      `, {
        status: 404,
        headers: { 'Content-Type': 'text/html' }
      })
    }
  } catch (error) {
    console.error('Sandbox render error:', error)
    return new NextResponse('Internal server error', { status: 500 })
  }
}

function generateEnhancedSandboxHTML(componentCode: string, filePath: string): string {
  const transformedCode = transformComponentCodeEnhanced(componentCode)

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${filePath}</title>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <link href="https://unpkg.com/tailwindcss@2/dist/tailwind.min.css" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    #root {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.1);
      padding: 40px;
      min-width: 300px;
      max-width: 1200px;
      width: 100%;
      animation: fadeIn 0.5s ease-in;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .error-container {
      background: linear-gradient(135deg, #ff6b6b, #ff8e53);
      color: white;
      border-radius: 8px;
      padding: 30px;
      text-align: center;
    }
    .error-container h2 {
      margin-bottom: 15px;
      font-size: 24px;
    }
    .error-container pre {
      background: rgba(0,0,0,0.2);
      padding: 15px;
      border-radius: 4px;
      margin-top: 15px;
      text-align: left;
      overflow-x: auto;
    }
    .loading {
      text-align: center;
      color: #666;
    }
    .loading::after {
      content: '...';
      animation: dots 1.4s infinite;
    }
    @keyframes dots {
      0%, 20% { content: '.'; }
      40% { content: '..'; }
      60%, 100% { content: '...'; }
    }
  </style>
</head>
<body>
  <div id="root"><div class="loading">Loading component</div></div>
  <script type="text/babel">
    // React hooks and utilities available globally
    const { useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer } = React;
    
    ${transformedCode}
    
    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
      }
      
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      
      componentDidCatch(error, errorInfo) {
        console.error('Component error:', error, errorInfo);
        this.setState({ errorInfo });
      }
      
      render() {
        if (this.state.hasError) {
          return (
            <div className="error-container">
              <h2>⚠️ Component Error</h2>
              <p>Something went wrong while rendering this component.</p>
              <pre>{this.state.error?.toString()}</pre>
              {this.state.errorInfo && (
                <pre>{this.state.errorInfo.componentStack}</pre>
              )}
            </div>
          );
        }
        
        return this.props.children;
      }
    }
    
    // Render the component
    setTimeout(() => {
      try {
        const rootElement = document.getElementById('root');
        const root = ReactDOM.createRoot(rootElement);
        
        // Try to find the component to render
        let ComponentToRender = null;
        
        // Check for various common component names
        const possibleNames = ['App', 'Component', 'Default', 'Main', 'Index'];
        for (const name of possibleNames) {
          if (typeof window[name] !== 'undefined') {
            ComponentToRender = window[name];
            break;
          }
        }
        
        // If no component found, try to find any function that looks like a component
        if (!ComponentToRender) {
          const componentRegex = /function\s+([A-Z][\w]*)|const\s+([A-Z][\w]*)\s*=/g;
          let match;
          while ((match = componentRegex.exec('${componentCode.replace(/'/g, "\\'").replace(/\n/g, "\\n")}')) !== null) {
            const componentName = match[1] || match[2];
            if (typeof window[componentName] !== 'undefined') {
              ComponentToRender = window[componentName];
              break;
            }
          }
        }
        
        if (ComponentToRender) {
          root.render(
            <ErrorBoundary>
              <ComponentToRender />
            </ErrorBoundary>
          );
        } else {
          rootElement.innerHTML = 
            '<div class="error-container">' +
            '<h2>📦 No Component Found</h2>' +
            '<p>Could not find a React component to render.</p>' +
            '<p>Make sure your component is exported or named with a capital letter (e.g., App, Component, Main).</p>' +
            '</div>';
        }
      } catch (error) {
        console.error('Failed to render:', error);
        document.getElementById('root').innerHTML = 
          '<div class="error-container">' +
          '<h2>💥 Render Error</h2>' +
          '<pre>' + error.toString() + '</pre>' +
          '</div>';
      }
    }, 100);
  </script>
</body>
</html>
  `
}

function transformComponentCodeEnhanced(code: string): string {
  // Remove imports
  let transformed = code.replace(/^import\s+.*?from\s+['"].*?['"];?$/gm, '')

  // Remove exports but keep the declarations
  transformed = transformed
    .replace(/^export\s+default\s+function/gm, 'function')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+function/gm, 'function')
    .replace(/^export\s+const/gm, 'const')
    .replace(/^export\s+/gm, '')

  // Basic TypeScript removal (more comprehensive)
  transformed = transformed
    // Remove type annotations
    .replace(/:\s*[\w\[\]<>,\s|&{}()=>]+(?=[,;)\]}\s])/g, '')
    // Remove interface declarations
    .replace(/^\s*interface\s+\w+\s*{[^}]*}\s*$/gm, '')
    // Remove type declarations
    .replace(/^\s*type\s+\w+\s*=.*?;\s*$/gm, '')
    // Remove generic type parameters
    .replace(/<[A-Z][\w,\s<>]*>(?=\s*\()/g, '')
    // Remove 'as' type assertions
    .replace(/\s+as\s+[\w<>\[\]]+/g, '')
    // Remove readonly modifier
    .replace(/\breadonly\s+/g, '')
    // Remove public/private/protected modifiers
    .replace(/\b(public|private|protected)\s+/g, '')

  return transformed
}