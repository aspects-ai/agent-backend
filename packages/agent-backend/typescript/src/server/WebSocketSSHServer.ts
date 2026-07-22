/**
 * WebSocket SSH Server
 *
 * Provides SSH protocol over WebSocket connections. This enables single-port
 * deployments where both MCP (HTTP) and SSH (WebSocket) share the same port.
 *
 * Benefits:
 * - Single port for all daemon functionality
 * - Works through HTTP load balancers and proxies
 * - Unified authentication (same token for MCP and SSH)
 * - Simpler firewall and NetworkPolicy configuration
 */

import { spawn } from 'child_process'
import { generateKeyPairSync } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { Server as HTTPServer, IncomingMessage } from 'http'
import type { Socket } from 'net'
import { dirname } from 'path'
import type { AuthContext, Connection, ExecInfo, PseudoTtyInfo, ServerChannel, Session } from 'ssh2'
import { Duplex } from 'stream'
import { WebSocket, WebSocketServer } from 'ws'
import { SSH2Server } from '../utils/ssh2.js'
import { createSFTPHandler } from './SFTPHandler.js'

export interface WebSocketSSHServerOptions {
  /** Root directory for all operations */
  rootDir: string
  /** Optional bearer token for authentication (reuses MCP auth) */
  authToken?: string
  /** Path to SSH host key file. Auto-generated if not found. */
  hostKeyPath?: string
  /** Shell to use for exec/shell sessions */
  shell?: 'bash' | 'sh' | 'auto'
}

export interface WebSocketSSHServerInstance {
  /** The underlying WebSocket server */
  wss: WebSocketServer
  /** Close the server and all connections */
  close: () => Promise<void>
}

/**
 * Creates a WebSocket server that speaks SSH protocol.
 * Clients connect via WebSocket, then use standard SSH client libraries.
 *
 * @param httpServer - The HTTP server to attach WebSocket upgrade handling to
 * @param options - Configuration options
 * @returns WebSocket SSH server instance
 */
export function createWebSocketSSHServer(
  httpServer: HTTPServer,
  options: WebSocketSSHServerOptions
): WebSocketSSHServerInstance {
  const hostKey = loadOrGenerateHostKey(options.hostKeyPath)
  const shell = resolveShell(options.shell)

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ssh'
  })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Authenticate via query param or Authorization header
    if (!authenticateConnection(req, options.authToken)) {
      ws.close(4001, 'Unauthorized')
      return
    }

    handleSSHOverWebSocket(ws, {
      hostKey,
      rootDir: options.rootDir,
      shell
    })
  })

  wss.on('error', (err) => {
    console.error('[SSH-WS] WebSocket server error:', err.message)
  })

  return {
    wss,
    close: async () => {
      return new Promise((resolve) => {
        // Close all active connections
        for (const client of wss.clients) {
          client.close(1000, 'Server shutting down')
        }
        wss.close(() => resolve())
      })
    }
  }
}

/**
 * Validate authentication token from WebSocket connection
 */
function authenticateConnection(req: IncomingMessage, expectedToken?: string): boolean {
  if (!expectedToken) return true // No auth configured

  // Check query parameter: /ssh?token=xxx
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const queryToken = url.searchParams.get('token')
  if (queryToken === expectedToken) return true

  // Check Authorization header: Bearer xxx
  const authHeader = req.headers['authorization']
  if (authHeader?.startsWith('Bearer ')) {
    const headerToken = authHeader.slice(7)
    if (headerToken === expectedToken) return true
  }

  return false
}

interface SSHSessionContext {
  hostKey: Buffer
  rootDir: string
  shell: string
}

/**
 * Handle an SSH connection over a WebSocket
 */
function handleSSHOverWebSocket(ws: WebSocket, ctx: SSHSessionContext): void {
  // Create a bidirectional stream from the WebSocket
  const wsStream = createDuplexFromWebSocket(ws)

  // Create SSH server for this connection
  const sshServer = new SSH2Server({ hostKeys: [ctx.hostKey] })

  sshServer.on('connection', (client: Connection) => {
    let isAuthenticated = false

    client.on('authentication', (authCtx: AuthContext) => {
      // We've already authenticated via WebSocket token
      // Accept any SSH auth method (password, publickey, none)
      isAuthenticated = true
      authCtx.accept()
    })

    client.on('ready', () => {
      client.on('session', (accept, reject) => {
        if (!isAuthenticated) {
          reject?.()
          return
        }

        const session = accept()
        handleSession(session, ctx)
      })
    })

    client.on('error', (err) => {
      console.error('[SSH-WS] Client error:', err.message)
    })

    client.on('end', () => {
      // Client disconnected
    })
  })

  sshServer.on('error', (err: Error) => {
    console.error('[SSH-WS] SSH server error:', err.message)
  })

  // Pipe WebSocket ↔ SSH server using injectSocket
  // The ssh2 Server's injectSocket method accepts a Duplex stream
  // that it will use for the SSH protocol communication
  try {
    sshServer.injectSocket(wsStream as unknown as Socket)
  } catch (err) {
    console.error('[SSH-WS] Failed to inject socket:', err)
    ws.close(1011, 'SSH initialization failed')
  }
}

/**
 * Handle an SSH session (shell, exec, subsystem requests)
 */
function handleSession(session: Session, ctx: SSHSessionContext): void {
  let ptyInfo: PseudoTtyInfo | null = null

  session.on('pty', (accept, _reject, info: PseudoTtyInfo) => {
    ptyInfo = info
    accept?.()
  })

  session.on('shell', (accept, _reject) => {
    const channel = accept?.()
    if (channel) {
      spawnShell(channel, ctx, ptyInfo)
    }
  })

  session.on('exec', (accept, _reject, info: ExecInfo) => {
    const channel = accept?.()
    if (channel) {
      executeCommand(info.command, channel, ctx)
    }
  })

  session.on('sftp', (accept, _reject) => {
    const sftpStream = accept?.()
    if (sftpStream) {
      createSFTPHandler(sftpStream, ctx.rootDir)
    }
  })

  session.on('window-change', (accept, _reject, _info) => {
    // Window resize - would need to track active PTY to resize
    accept?.()
  })
}

/**
 * Execute a command and stream output to the SSH channel
 */
function executeCommand(
  command: string,
  channel: ServerChannel,
  ctx: SSHSessionContext
): void {
  const proc = spawn(ctx.shell, ['-c', command], {
    cwd: ctx.rootDir,
    env: {
      ...process.env,
      HOME: ctx.rootDir,
      PWD: ctx.rootDir,
      TERM: 'xterm-256color'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  // Stream output to channel
  proc.stdout.on('data', (data: Buffer) => {
    channel.write(data)
  })

  proc.stderr.on('data', (data: Buffer) => {
    channel.stderr.write(data)
  })

  // Stream input from channel
  channel.on('data', (data: Buffer) => {
    if (proc.stdin.writable) {
      proc.stdin.write(data)
    }
  })

  channel.on('end', () => {
    proc.stdin.end()
  })

  proc.on('close', (code, signal) => {
    const exitCode = code ?? (signal ? 128 : 0)
    channel.exit(exitCode)
    channel.end()
  })

  proc.on('error', (err) => {
    channel.stderr.write(`Error: ${err.message}\n`)
    channel.exit(1)
    channel.end()
  })
}

/**
 * Spawn an interactive shell session
 */
function spawnShell(
  channel: ServerChannel,
  ctx: SSHSessionContext,
  ptyInfo: PseudoTtyInfo | null
): void {
  // For interactive shells, we ideally want a PTY
  // Try to use node-pty if available, otherwise fall back to regular spawn
  trySpawnWithPty(channel, ctx, ptyInfo).catch(() => {
    // Fallback: spawn shell without PTY
    executeCommand(ctx.shell, channel, ctx)
  })
}

/**
 * Try to spawn a shell with PTY support using node-pty
 */
async function trySpawnWithPty(
  channel: ServerChannel,
  ctx: SSHSessionContext,
  ptyInfo: PseudoTtyInfo | null
): Promise<void> {
  // Dynamically require node-pty (optional dependency)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodePty: any
  try {
    // node-pty is optional - only required for interactive shell with PTY
    // Use dynamic require to avoid TypeScript module resolution
    const moduleName = 'node-pty'
     
    nodePty = require(moduleName)
  } catch {
    throw new Error('node-pty not available')
  }

  // Extract term type safely - ssh2's PseudoTtyInfo has term as optional property
  const ptyInfoAny = ptyInfo as unknown as { term?: string; cols?: number; rows?: number } | null
  const termType = ptyInfoAny?.term ?? 'xterm-256color'

  const pty = nodePty.spawn(ctx.shell, [], {
    name: termType,
    cols: ptyInfoAny?.cols ?? 80,
    rows: ptyInfoAny?.rows ?? 24,
    cwd: ctx.rootDir,
    env: {
      ...process.env,
      HOME: ctx.rootDir,
      PWD: ctx.rootDir,
      TERM: termType
    } as Record<string, string>
  })

  // PTY output -> SSH channel
  pty.onData((data: string) => {
    channel.write(data)
  })

  // SSH channel -> PTY input
  channel.on('data', (data: Buffer) => {
    pty.write(data.toString())
  })

  channel.on('end', () => {
    pty.kill()
  })

  pty.onExit(({ exitCode }: { exitCode: number }) => {
    channel.exit(exitCode)
    channel.end()
  })
}

/**
 * Create a Duplex stream from a WebSocket connection
 */
function createDuplexFromWebSocket(ws: WebSocket): Duplex {
  let destroyed = false

  const stream = new Duplex({
    read() {
      // Data is pushed via ws.on('message')
    },
    write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      if (destroyed || ws.readyState !== WebSocket.OPEN) {
        callback(new Error('WebSocket is not open'))
        return
      }

      ws.send(chunk, (err) => {
        callback(err)
      })
    },
    final(callback: (error?: Error | null) => void) {
      ws.close(1000, 'Stream closed')
      callback()
    },
    destroy(err: Error | null, callback: (error?: Error | null) => void) {
      destroyed = true
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, err?.message || 'Stream destroyed')
      }
      callback(err)
    }
  })

  // WebSocket messages -> Duplex stream
  ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    if (destroyed) return

    let buffer: Buffer
    if (Buffer.isBuffer(data)) {
      buffer = data
    } else if (data instanceof ArrayBuffer) {
      buffer = Buffer.from(data)
    } else {
      buffer = Buffer.concat(data)
    }

    stream.push(buffer)
  })

  ws.on('close', () => {
    if (!destroyed) {
      stream.push(null) // Signal EOF
    }
  })

  ws.on('error', (err) => {
    if (!destroyed) {
      stream.destroy(err)
    }
  })

  return stream
}

/**
 * Load SSH host key from file, or generate a new one
 */
function loadOrGenerateHostKey(hostKeyPath?: string): Buffer {
  const defaultPath = '/var/lib/agentbe/ssh_host_ed25519_key'
  const keyPath = hostKeyPath || defaultPath

  // Try to load existing key
  if (existsSync(keyPath)) {
    try {
      return readFileSync(keyPath)
    } catch (err) {
      console.error(`[SSH-WS] Failed to read host key from ${keyPath}:`, err)
    }
  }

  // Generate new host key
  console.error(`[SSH-WS] Generating SSH host key at ${keyPath}`)

  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
  })

  // Ensure directory exists
  const dir = dirname(keyPath)
  if (dir && !existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // Directory creation failed, key will be ephemeral
      console.error(`[SSH-WS] Could not create directory ${dir}, using ephemeral key`)
      return Buffer.from(privateKey)
    }
  }

  // Save key to file
  try {
    writeFileSync(keyPath, privateKey, { mode: 0o600 })
    console.error(`[SSH-WS] Host key saved to ${keyPath}`)
  } catch {
    console.error(`[SSH-WS] Could not save host key to ${keyPath}, using ephemeral key`)
  }

  return Buffer.from(privateKey)
}

/**
 * Resolve which shell to use
 */
function resolveShell(shell?: 'bash' | 'sh' | 'auto'): string {
  if (shell === 'bash') return '/bin/bash'
  if (shell === 'sh') return '/bin/sh'

  // Auto-detect: prefer bash if available
  if (existsSync('/bin/bash')) return '/bin/bash'
  return '/bin/sh'
}
