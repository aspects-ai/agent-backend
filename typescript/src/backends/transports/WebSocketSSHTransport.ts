/**
 * WebSocket SSH Transport
 *
 * Client-side transport that connects to an SSH-over-WebSocket server.
 * Used by RemoteFilesystemBackend as the default transport (replacing direct sshd).
 *
 * Benefits:
 * - Single port connection (same port as MCP HTTP)
 * - Works through HTTP proxies and load balancers
 * - Unified authentication (same token as MCP)
 */

import WebSocket from 'ws'
import { Client as SSHClient, SFTPWrapper } from 'ssh2'
import type { ClientChannel } from 'ssh2'
import { Duplex } from 'stream'
import { EventEmitter } from 'events'

export interface WebSocketSSHTransportConfig {
  /** Remote host */
  host: string
  /** Port for WebSocket connection (same as MCP port) */
  port: number
  /** WebSocket path (default: /ssh) */
  path?: string
  /** Bearer token for authentication */
  authToken?: string
  /** Connection timeout in ms (default: 30000) */
  timeout?: number
  /** Keep-alive interval in ms (default: 30000) */
  keepaliveInterval?: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

/**
 * SSH transport over WebSocket
 *
 * Establishes an SSH connection over a WebSocket, allowing SSH operations
 * (exec, SFTP) through a single HTTP port.
 */
export class WebSocketSSHTransport extends EventEmitter {
  private ws: WebSocket | null = null
  private sshClient: SSHClient | null = null
  private sftpSession: SFTPWrapper | null = null
  private sftpSessionPromise: Promise<SFTPWrapper> | null = null
  private _connected = false
  private readonly config: Required<Omit<WebSocketSSHTransportConfig, 'authToken'>> & { authToken?: string }

  constructor(config: WebSocketSSHTransportConfig) {
    super()
    this.config = {
      path: '/ssh',
      timeout: 30000,
      keepaliveInterval: 30000,
      ...config
    }
  }

  get connected(): boolean {
    return this._connected
  }

  /**
   * Connect to the SSH-over-WebSocket server
   */
  async connect(): Promise<void> {
    if (this._connected) return

    return new Promise((resolve, reject) => {
      const protocol = this.config.port === 443 ? 'wss' : 'ws'
      let url = `${protocol}://${this.config.host}:${this.config.port}${this.config.path}`

      // Add auth token as query parameter
      if (this.config.authToken) {
        url += `?token=${encodeURIComponent(this.config.authToken)}`
      }

      // Connection timeout
      const timeoutId = setTimeout(() => {
        if (this.ws) {
          this.ws.close()
          this.ws = null
        }
        reject(new Error(`Connection timeout after ${this.config.timeout}ms`))
      }, this.config.timeout)

      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        // WebSocket connected, now establish SSH session
        this.establishSSH()
          .then(() => {
            clearTimeout(timeoutId)
            this._connected = true
            this.emit('connect')
            resolve()
          })
          .catch((err) => {
            clearTimeout(timeoutId)
            this.cleanup()
            reject(err)
          })
      })

      this.ws.on('error', (err) => {
        clearTimeout(timeoutId)
        this.cleanup()
        reject(err)
      })

      this.ws.on('close', (code, reason) => {
        this._connected = false
        this.cleanup()
        this.emit('close', code, reason.toString())
      })
    })
  }

  /**
   * Establish SSH session over the WebSocket
   */
  private async establishSSH(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not connected'))
        return
      }

      const stream = this.createStreamFromWebSocket(this.ws)
      this.sshClient = new SSHClient()

      this.sshClient.on('ready', () => {
        resolve()
      })

      this.sshClient.on('error', (err) => {
        reject(err)
      })

      this.sshClient.on('close', () => {
        this._connected = false
        this.emit('close')
      })

      // Connect SSH client over WebSocket stream
      // Auth is via WebSocket token, so we use dummy credentials
      this.sshClient.connect({
        sock: stream as any,
        username: 'agent',
        password: 'agent',
        readyTimeout: this.config.timeout,
        keepaliveInterval: this.config.keepaliveInterval,
        keepaliveCountMax: 3
      })
    })
  }

  /**
   * Create a Duplex stream from a WebSocket
   */
  private createStreamFromWebSocket(ws: WebSocket): Duplex {
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
        callback()
      },
      destroy(err: Error | null, callback: (error?: Error | null) => void) {
        destroyed = true
        callback(err)
      }
    })

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
        stream.push(null)
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
   * Execute a command over SSH
   */
  async exec(command: string, options?: { timeout?: number }): Promise<ExecResult> {
    if (!this._connected || !this.sshClient) {
      throw new Error('Not connected')
    }

    return new Promise((resolve, reject) => {
      const timeout = options?.timeout ?? 120000

      const timeoutId = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeout}ms`))
      }, timeout)

      this.sshClient!.exec(command, (err, channel: ClientChannel) => {
        if (err) {
          clearTimeout(timeoutId)
          reject(err)
          return
        }

        let stdout = ''
        let stderr = ''

        channel.on('data', (data: Buffer) => {
          stdout += data.toString()
        })

        channel.stderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })

        channel.on('close', (code: number) => {
          clearTimeout(timeoutId)
          resolve({ stdout, stderr, code: code ?? 0 })
        })

        channel.on('error', (channelErr: Error) => {
          clearTimeout(timeoutId)
          reject(channelErr)
        })
      })
    })
  }

  /**
   * Execute a command and stream output via callback
   */
  async execStream(
    command: string,
    onStdout: (data: Buffer) => void,
    onStderr: (data: Buffer) => void
  ): Promise<number> {
    if (!this._connected || !this.sshClient) {
      throw new Error('Not connected')
    }

    return new Promise((resolve, reject) => {
      this.sshClient!.exec(command, (err, channel: ClientChannel) => {
        if (err) {
          reject(err)
          return
        }

        channel.on('data', (data: Buffer) => {
          onStdout(data)
        })

        channel.stderr.on('data', (data: Buffer) => {
          onStderr(data)
        })

        channel.on('close', (code: number) => {
          resolve(code ?? 0)
        })

        channel.on('error', reject)
      })
    })
  }

  /**
   * Get or create SFTP session
   */
  async getSFTP(): Promise<SFTPWrapper> {
    if (this.sftpSession) {
      return this.sftpSession
    }

    if (this.sftpSessionPromise) {
      return this.sftpSessionPromise
    }

    if (!this._connected || !this.sshClient) {
      throw new Error('Not connected')
    }

    this.sftpSessionPromise = new Promise((resolve, reject) => {
      this.sshClient!.sftp((err, sftp) => {
        if (err) {
          this.sftpSessionPromise = null
          reject(err)
          return
        }

        this.sftpSession = sftp
        this.sftpSessionPromise = null

        // Handle SFTP session close
        sftp.on('close', () => {
          this.sftpSession = null
        })

        resolve(sftp)
      })
    })

    return this.sftpSessionPromise
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    this.cleanup()
  }

  /**
   * Clean up all resources
   */
  private cleanup(): void {
    this._connected = false

    if (this.sftpSession) {
      try {
        this.sftpSession.end()
      } catch {
        // Ignore errors during cleanup
      }
      this.sftpSession = null
      this.sftpSessionPromise = null
    }

    if (this.sshClient) {
      try {
        this.sshClient.end()
      } catch {
        // Ignore errors during cleanup
      }
      this.sshClient = null
    }

    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // Ignore errors during cleanup
      }
      this.ws = null
    }
  }
}
