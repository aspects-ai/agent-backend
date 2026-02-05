#!/usr/bin/env node

/**
 * agent-backend CLI
 *
 * Commands:
 * 1. Start MCP servers for different backend types (default command)
 * 2. start-docker: Start Docker-based agentbe-daemon service
 * 3. stop-docker: Stop Docker-based agentbe-daemon service
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { execSync, spawn } from 'child_process'
import express from 'express'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { LocalFilesystemBackend } from '../dist/index.js'
import { AgentBackendMCPServer } from '../dist/server/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PACKAGE_ROOT = join(__dirname, '..')
const DEPLOY_DIR = join(PACKAGE_ROOT, 'deploy')

// ─────────────────────────────────────────────────────────────────
// Main Dispatcher
// ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  // Check for subcommands
  if (command === 'daemon') {
    await handleDaemon(args.slice(1))
    return
  }

  if (command === 'start-docker') {
    await handleStartDocker(args.slice(1))
    return
  }

  if (command === 'stop-docker') {
    await handleStopDocker()
    return
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  // Error: unknown command
  console.error(`❌ Unknown command: ${command || '(none)'}`)
  console.error('   Run "agent-backend help" for usage')
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────────
// Daemon Command (MCP + SSH)
// ─────────────────────────────────────────────────────────────────

async function handleDaemon(args) {
  // Parse daemon-specific args
  const config = parseDaemonArgs(args)

  // Local-only mode (stdio MCP, no SSH, no HTTP)
  if (config.localOnly) {
    console.error('🌟 Starting agentbe-daemon (local stdio mode)...')
    console.error(`📁 Workspace: ${config.rootDir}`)
    if (config.scopePath) {
      console.error(`📂 Scope: ${config.scopePath}`)
    }
    console.error('')

    try {
      // Create base backend
      let backend = new LocalFilesystemBackend({
        rootDir: config.rootDir,
        isolation: config.isolation,
        shell: config.shell
      })

      // Apply static scoping if configured
      if (config.scopePath) {
        backend = backend.scope(config.scopePath)
      }

      // Create MCP server
      const mcpServer = new AgentBackendMCPServer(backend)

      // Use stdio transport for local development
      const transport = new StdioServerTransport()
      await mcpServer.getServer().connect(transport)

      // Server runs until stdin closes or process is killed
      console.error('✅ MCP server running on stdio')
      console.error('   (Use StdioClientTransport to connect)')
      console.error('')

    } catch (error) {
      console.error(`❌ Failed to start MCP server: ${error.message}`)
      if (error.stack) {
        console.error(error.stack)
      }
      process.exit(1)
    }
    return
  }

  // Full daemon mode (MCP + SSH) - requires Linux
  if (process.platform !== 'linux') {
    console.error('❌ Error: Full daemon mode (with SSH) requires Linux')
    console.error('   Options:')
    console.error('   1. Use --local-only flag for local stdio mode')
    console.error('   2. Use Docker: agent-backend start-docker')
    process.exit(1)
  }

  // Check running as root for user creation
  if (process.getuid() !== 0) {
    console.error('⚠️  Warning: daemon mode requires root privileges for SSH user management')
    console.error('   Run with sudo or as root user')
  }

  // Validate sshd is installed
  const sshdPath = '/usr/sbin/sshd'
  try {
    execSync(`test -f ${sshdPath}`, { stdio: 'ignore' })
  } catch {
    console.error('❌ Error: SSH daemon not found at /usr/sbin/sshd')
    console.error('   Install openssh-server: apt-get install openssh-server')
    console.error('   Or use --local-only flag for local stdio mode')
    process.exit(1)
  }

  console.error('🌟 Starting agentbe-daemon (MCP + SSH)...')
  console.error(`📁 Workspace: ${config.rootDir}`)
  console.error(`🔌 MCP Port: ${config.mcpPort}`)
  console.error(`👥 SSH Users: ${config.sshUsers.map(u => u.username).join(', ')}`)

  try {
    // Set up SSH users
    await setupSshUsers(config)

    // Start HTTP MCP server
    const httpServer = await startDaemonHttpServer(config)

    // Start SSH daemon
    const sshdProcess = startSshDaemon(config)

    // Set up signal handlers for graceful shutdown
    const shutdown = async () => {
      console.error('')
      console.error('🛑 Shutting down agentbe-daemon...')

      // Close HTTP server
      await new Promise(resolve => httpServer.close(resolve))
      console.error('   ✓ MCP server stopped')

      // Stop sshd
      sshdProcess.kill('SIGTERM')
      await new Promise(resolve => sshdProcess.on('exit', resolve))
      console.error('   ✓ SSH daemon stopped')

      process.exit(0)
    }

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)

    // Monitor sshd and exit if it crashes
    sshdProcess.on('exit', (code, signal) => {
      console.error(`❌ SSH daemon exited unexpectedly (code: ${code}, signal: ${signal})`)
      console.error('   agentbe-daemon shutting down...')
      httpServer.close(() => process.exit(1))
    })

    console.error('')
    console.error('✅ agentbe-daemon is running')
    console.error(`   SSH Port: 22`)
    console.error(`   MCP Port: ${config.mcpPort}`)
    console.error(`   MCP Health: http://localhost:${config.mcpPort}/health`)
    console.error('')

  } catch (error) {
    console.error(`❌ Failed to start agentbe-daemon: ${error.message}`)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

function parseDaemonArgs(args) {
  const config = {
    mcpPort: 3001,
    localOnly: false,
    sshUsers: [{ username: 'root', password: 'agents' }],
    sshPublicKey: null,
    sshAuthorizedKeys: null
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]

    switch (arg) {
      case '--rootDir':
        config.rootDir = next
        i++
        break

      case '--scopePath':
        config.scopePath = next
        i++
        break

      case '--isolation':
        config.isolation = next
        i++
        break

      case '--shell':
        config.shell = next
        i++
        break

      case '--mcp-port':
        config.mcpPort = parseInt(next, 10)
        i++
        break

      case '--mcp-auth-token':
        config.mcpAuthToken = next
        i++
        break

      case '--local-only':
        config.localOnly = true
        break

      case '--ssh-users':
        // Parse user:pass,user:pass format
        config.sshUsers = next.split(',').map(pair => {
          const [username, password] = pair.split(':')
          if (!username || !password) {
            throw new Error(`Invalid --ssh-users format: ${pair}. Expected user:pass`)
          }
          return { username: username.trim(), password: password.trim() }
        })
        i++
        break

      case '--ssh-public-key':
        config.sshPublicKey = next
        i++
        break

      case '--ssh-authorized-keys':
        config.sshAuthorizedKeys = next
        i++
        break

      default:
        if (arg.startsWith('--')) {
          console.error(`❌ Error: unrecognized option: ${arg}`)
          console.error('   Run "agent-backend help" to see available options')
          process.exit(1)
        }
    }
  }

  // Validation
  if (!config.rootDir) {
    console.error('❌ Error: --rootDir is required')
    console.error('   Run "agent-backend help" for usage')
    process.exit(1)
  }

  if (config.mcpPort < 1024 || config.mcpPort > 65535) {
    console.error('❌ Error: --mcp-port must be between 1024-65535')
    process.exit(1)
  }

  if (config.isolation && !['auto', 'bwrap', 'software', 'none'].includes(config.isolation)) {
    console.error(`❌ Error: Invalid isolation mode "${config.isolation}"`)
    console.error('   Valid modes: auto, bwrap, software, none')
    process.exit(1)
  }

  if (config.shell && !['bash', 'sh', 'auto'].includes(config.shell)) {
    console.error(`❌ Error: Invalid shell "${config.shell}"`)
    console.error('   Valid shells: bash, sh, auto')
    process.exit(1)
  }

  return config
}

async function setupSshUsers(config) {
  console.error('👤 Setting up SSH users...')

  for (const user of config.sshUsers) {
    const { username, password } = user

    // Create user with home directory
    try {
      execSync(`useradd -m -s /bin/bash ${username}`, { stdio: 'pipe' })
      console.error(`   ✓ Created user: ${username}`)
    } catch (error) {
      // User might already exist
      console.error(`   - User ${username} already exists`)
    }

    // Set password
    try {
      execSync(`echo "${username}:${password}" | chpasswd`, { stdio: 'pipe' })
      console.error(`   ✓ Set password for ${username}`)
    } catch (error) {
      console.error(`   ✗ Failed to set password for ${username}: ${error.message}`)
    }

    // Set up .ssh directory
    const sshDir = username === 'root' ? '/root/.ssh' : `/home/${username}/.ssh`
    try {
      execSync(`mkdir -p "${sshDir}"`, { stdio: 'pipe' })
      execSync(`touch "${sshDir}/authorized_keys"`, { stdio: 'pipe' })
      execSync(`chown -R ${username}:${username} "${sshDir}"`, { stdio: 'pipe' })
      execSync(`chmod 700 "${sshDir}"`, { stdio: 'pipe' })
      execSync(`chmod 600 "${sshDir}/authorized_keys"`, { stdio: 'pipe' })
    } catch (error) {
      console.error(`   ✗ Failed to set up .ssh directory: ${error.message}`)
    }
  }

  // Add SSH public key if provided (to first user)
  if (config.sshPublicKey) {
    const firstUser = config.sshUsers[0].username
    const sshDir = firstUser === 'root' ? '/root/.ssh' : `/home/${firstUser}/.ssh`
    try {
      execSync(`echo "${config.sshPublicKey}" >> "${sshDir}/authorized_keys"`, { stdio: 'pipe' })
      console.error(`   ✓ Added SSH public key for ${firstUser}`)
    } catch (error) {
      console.error(`   ✗ Failed to add SSH public key: ${error.message}`)
    }
  }

  // Copy authorized_keys file if provided
  if (config.sshAuthorizedKeys) {
    const firstUser = config.sshUsers[0].username
    const sshDir = firstUser === 'root' ? '/root/.ssh' : `/home/${firstUser}/.ssh`
    try {
      execSync(`cat "${config.sshAuthorizedKeys}" >> "${sshDir}/authorized_keys"`, { stdio: 'pipe' })
      console.error(`   ✓ Copied authorized_keys for ${firstUser}`)
    } catch (error) {
      console.error(`   ✗ Failed to copy authorized_keys: ${error.message}`)
    }
  }

  // Ensure password authentication is enabled
  try {
    execSync('mkdir -p /etc/ssh/sshd_config.d', { stdio: 'pipe' })
    execSync('echo "PasswordAuthentication yes" > /etc/ssh/sshd_config.d/agentbe-password.conf', { stdio: 'pipe' })
    console.error('   ✓ Enabled password authentication')
  } catch (error) {
    console.error(`   ✗ Failed to configure SSH: ${error.message}`)
  }
}

async function startDaemonHttpServer(config) {
  const app = express()

  // Create base backend
  const baseBackend = new LocalFilesystemBackend({
    rootDir: config.rootDir,
    isolation: config.isolation,
    shell: config.shell,
    preventDangerous: true
  })

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      rootDir: config.rootDir
    })
  })

  // MCP endpoint - creates scoped backend per request
  app.post('/mcp', async (req, res) => {
    // Validate auth token if configured
    if (config.mcpAuthToken) {
      const authHeader = req.headers.authorization
      const expectedAuth = `Bearer ${config.mcpAuthToken}`

      if (!authHeader || authHeader !== expectedAuth) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or missing authentication token'
        })
        return
      }
    }

    // Read scope headers
    const requestedRootDir = req.headers['x-root-dir']
    const dynamicScopePath = req.headers['x-scope-path']

    // Validate X-Root-Dir matches configured rootDir (if provided and not 'undefined')
    if (requestedRootDir && requestedRootDir !== 'undefined' && requestedRootDir !== config.rootDir) {
      console.error(`[MCP] Root dir mismatch: requested=${requestedRootDir}, configured=${config.rootDir}`)
      res.status(403).json({
        error: 'Root directory mismatch',
        message: `Server is configured for ${config.rootDir}, not ${requestedRootDir}`
      })
      return
    }

    // Check for conflicting scope configuration
    if (config.scopePath && dynamicScopePath) {
      console.error(`[MCP] Scope conflict: static=${config.scopePath}, dynamic=${dynamicScopePath}`)
      res.status(400).json({
        error: 'Scope conflict',
        message: `Server was started with static scope '${config.scopePath}', but request also specified scope '${dynamicScopePath}'. Use one or the other, not both.`
      })
      return
    }

    // Determine effective scope (static from CLI or dynamic from header)
    const effectiveScopePath = config.scopePath || dynamicScopePath

    // Validate and create scoped backend if scope requested
    let backend = baseBackend
    if (effectiveScopePath) {
      // Validate scope path doesn't escape root
      const normalizedScope = effectiveScopePath.replace(/^\/+/, '').replace(/\.\.+/g, '')
      if (normalizedScope !== effectiveScopePath.replace(/^\/+/, '') || effectiveScopePath.includes('..')) {
        res.status(400).json({
          error: 'Invalid scope path',
          message: 'Scope path must not contain path traversal sequences'
        })
        return
      }
      backend = baseBackend.scope(normalizedScope)
      console.error(`[MCP] Request scoped to: ${normalizedScope}${config.scopePath ? ' (static)' : ' (dynamic)'}`)
    }

    // Create MCP server and transport for this request
    const mcpServer = new AgentBackendMCPServer(backend)
    const transport = new StreamableHTTPServerTransport()
    await mcpServer.getServer().connect(transport)

    await transport.handleRequest(req, res)
  })

  return await new Promise((resolve) => {
    const server = app.listen(config.mcpPort, () => {
      console.error('🔌 MCP server started')
      console.error(`   Port: ${config.mcpPort}`)
      console.error(`   Auth: ${config.mcpAuthToken ? 'enabled (token required)' : 'disabled (open access)'}`)
      if (config.scopePath) {
        console.error(`   Scope: ${config.scopePath} (static)`)
      }
      resolve(server)
    })
  })
}

function startSshDaemon(config) {
  console.error('🚀 Starting SSH daemon...')

  const sshdProcess = spawn('/usr/sbin/sshd', ['-D', '-e'], {
    stdio: ['ignore', 'inherit', 'inherit']
  })

  sshdProcess.on('spawn', () => {
    console.error('   ✓ SSH daemon started')
  })

  sshdProcess.on('error', (error) => {
    console.error(`   ✗ Failed to start SSH daemon: ${error.message}`)
    process.exit(1)
  })

  return sshdProcess
}

// ─────────────────────────────────────────────────────────────────
// MCP Server (default command)
// ─────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const config = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]

    switch (arg) {
      // Daemon options
      case '--rootDir':
        config.rootDir = next
        i++
        break

      case '--scopePath':
        config.scopePath = next
        i++
        break

      case '--isolation':
        config.isolation = next
        i++
        break

      case '--shell':
        config.shell = next
        i++
        break

      // MCP server options
      case '--mcp-port':
        config.mcpPort = parseInt(next, 10)
        i++
        break

      case '--mcp-auth-token':
        config.mcpAuthToken = next
        i++
        break

      case '--help':
      case '-h':
        printHelp()
        process.exit(0)

      default:
        if (arg.startsWith('--')) {
          console.error(`❌ Error: unrecognized option: ${arg}`)
          console.error('   Run with --help to see available options')
          process.exit(1)
        }
    }
  }

  // Validation
  if (!config.rootDir) {
    console.error('❌ Error: --rootDir is required')
    printHelp()
    process.exit(1)
  }

  // Validate isolation mode
  if (config.isolation && !['auto', 'bwrap', 'software', 'none'].includes(config.isolation)) {
    console.error(`❌ Error: Invalid isolation mode "${config.isolation}"`)
    console.error('   Valid modes: auto, bwrap, software, none')
    process.exit(1)
  }

  // Validate shell
  if (config.shell && !['bash', 'sh', 'auto'].includes(config.shell)) {
    console.error(`❌ Error: Invalid shell "${config.shell}"`)
    console.error('   Valid shells: bash, sh, auto')
    process.exit(1)
  }

  // MCP port validation
  if (config.mcpPort !== undefined) {
    if (config.mcpPort < 1024 || config.mcpPort > 65535) {
      console.error('❌ Error: --mcp-port must be between 1024-65535')
      process.exit(1)
    }
  }

  return config
}

async function startMCPServer(args) {
  const config = parseArgs(args)

  console.error(`🚀 Starting agentbe-daemon (agent backend daemon)...`)
  console.error(`📁 Root directory: ${config.rootDir}`)
  if (config.scopePath) {
    console.error(`📂 Scope: ${config.scopePath}`)
  }
  console.error(`🔒 Isolation: ${config.isolation || 'auto'}`)

  try {
    // Create base backend for the MCP server
    const baseBackend = new LocalFilesystemBackend({
      rootDir: config.rootDir,
      isolation: config.isolation,
      shell: config.shell,
      preventDangerous: true
    })

    // Choose transport mode based on config
    if (config.mcpPort) {
      // HTTP mode: pass unscoped backend, scoping is handled per-request
      await startHttpServer(baseBackend, config)
    } else {
      // Stdio mode: apply static scoping here (no per-request scoping possible)
      let backend = baseBackend
      if (config.scopePath) {
        backend = baseBackend.scope(config.scopePath)
      }

      // Create MCP server for stdio mode
      const mcpServer = new AgentBackendMCPServer(backend)
      // Connect stdio transport
      const transport = new StdioServerTransport()
      await mcpServer.getServer().connect(transport)

      console.error(`✅ agentbe-daemon running on stdio`)
      console.error(`   Ready to receive MCP requests`)
    }

  } catch (error) {
    console.error(`❌ Failed to start agentbe-daemon: ${error.message}`)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

/**
 * Start HTTP server for MCP
 */
async function startHttpServer(baseBackend, config) {
  const app = express()

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      rootDir: config.rootDir
    })
  })

  // MCP endpoint - creates scoped backend per request
  app.post('/mcp', async (req, res) => {
    // Validate auth token if configured
    if (config.mcpAuthToken) {
      const authHeader = req.headers.authorization
      const expectedAuth = `Bearer ${config.mcpAuthToken}`

      if (!authHeader || authHeader !== expectedAuth) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid or missing authentication token'
        })
        return
      }
    }

    // Read scope headers
    const requestedRootDir = req.headers['x-root-dir']
    const dynamicScopePath = req.headers['x-scope-path']

    // Validate X-Root-Dir matches configured rootDir (if provided and not 'undefined')
    if (requestedRootDir && requestedRootDir !== 'undefined' && requestedRootDir !== config.rootDir) {
      console.error(`[MCP] Root dir mismatch: requested=${requestedRootDir}, configured=${config.rootDir}`)
      res.status(403).json({
        error: 'Root directory mismatch',
        message: `Server is configured for ${config.rootDir}, not ${requestedRootDir}`
      })
      return
    }

    // Check for conflicting scope configuration
    if (config.scopePath && dynamicScopePath) {
      console.error(`[MCP] Scope conflict: static=${config.scopePath}, dynamic=${dynamicScopePath}`)
      res.status(400).json({
        error: 'Scope conflict',
        message: `Server was started with static scope '${config.scopePath}', but request also specified scope '${dynamicScopePath}'. Use one or the other, not both.`
      })
      return
    }

    // Determine effective scope (static from CLI or dynamic from header)
    const effectiveScopePath = config.scopePath || dynamicScopePath

    // Validate and create scoped backend if scope requested
    let backend = baseBackend
    if (effectiveScopePath) {
      // Validate scope path doesn't escape root
      const normalizedScope = effectiveScopePath.replace(/^\/+/, '').replace(/\.\.+/g, '')
      if (normalizedScope !== effectiveScopePath.replace(/^\/+/, '') || effectiveScopePath.includes('..')) {
        res.status(400).json({
          error: 'Invalid scope path',
          message: 'Scope path must not contain path traversal sequences'
        })
        return
      }
      backend = baseBackend.scope(normalizedScope)
      console.error(`[MCP] Request scoped to: ${normalizedScope}${config.scopePath ? ' (static)' : ' (dynamic)'}`)
    }

    // Create MCP server and transport for this request
    const mcpServer = new AgentBackendMCPServer(backend)
    const transport = new StreamableHTTPServerTransport()
    await mcpServer.getServer().connect(transport)

    await transport.handleRequest(req, res)
  })

  await new Promise((resolve) => {
    app.listen(config.mcpPort, () => {
      console.error(`✅ agentbe-daemon running on HTTP`)
      console.error(`   Port: ${config.mcpPort}`)
      console.error(`   Auth: ${config.mcpAuthToken ? 'enabled (token required)' : 'disabled (open access)'}`)
      if (config.scopePath) {
        console.error(`   Scope: ${config.scopePath} (static)`)
      }
      console.error(`   Health: http://localhost:${config.mcpPort}/health`)
      console.error(`   Endpoint: http://localhost:${config.mcpPort}/mcp`)
      resolve()
    })
  })
}

// ─────────────────────────────────────────────────────────────────
// Docker Remote Backend Management
// ─────────────────────────────────────────────────────────────────

async function handleStartDocker(args) {
  const shouldBuild = args.includes('--build')

  console.log('🚀 Starting Agent Backend remote service...')

  // Check if Docker is available
  try {
    execSync('docker --version', { stdio: 'ignore' })
  } catch {
    console.error('❌ Docker is required for the remote backend')
    console.error('   Please install Docker Desktop: https://www.docker.com/products/docker-desktop/')
    process.exit(1)
  }

  try {
    // Build image if requested
    if (shouldBuild) {
      console.log('   Building Docker image...')
      await buildImage()
      console.log('   ✅ Docker image built successfully')
    }

    // Check if service is already running
    try {
      const output = execSync('docker ps --filter "name=agentbe-remote" --format "{{.Names}}"', {
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim()

      if (output.includes('agentbe-remote')) {
        if (shouldBuild) {
          console.log('   Restarting container with new image...')
          // Stop and remove existing container
          await runCommand(['docker', 'stop', 'agentbe-remote-backend']).catch(() => { })
          await runCommand(['docker', 'rm', 'agentbe-remote-backend']).catch(() => { })
        } else {
          console.log('✅ Remote backend is already running')
          console.log('   SSH available at: root@localhost:2222')
          console.log('   Default password: agents')
          return
        }
      }
    } catch {
      // Service not running, continue
    }

    try {
      // Use docker-compose if available
      try {
        await runDockerCompose()
      } catch {
        // Fallback to direct docker run
        await runDockerDirect(shouldBuild)
      }

      // Wait a moment for service to start
      await new Promise(resolve => setTimeout(resolve, 2000))

      console.log('✅ Remote backend started successfully')
      console.log('   SSH available at: root@localhost:2222')
      console.log('   MCP available at: http://localhost:3001')
      console.log('   Default password: agents')
      console.log('')
      console.log('   Connect using RemoteFilesystemBackend from your application')

    } catch (error) {
      throw new Error(`Failed to start remote backend: ${error.message}`)
    }
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }
}

async function handleStopDocker() {
  console.log('🛑 Stopping Agent Backend remote service...')

  try {
    // Try docker-compose down first
    try {
      await runCommand([
        'docker-compose', '-f', join(DEPLOY_DIR, 'docker', 'docker-compose.yml'), 'down'
      ])
    } catch {
      // Fallback to stopping containers directly
      const containers = execSync(
        'docker ps --filter "name=agentbe-remote" --format "{{.Names}}"',
        { encoding: 'utf8', stdio: 'pipe' }
      ).trim().split('\n').filter(name => name.trim())

      for (const container of containers) {
        if (container.trim()) {
          await runCommand(['docker', 'stop', container.trim()])
          await runCommand(['docker', 'rm', container.trim()])
        }
      }
    }

    console.log('✅ Remote backend stopped')

  } catch (error) {
    console.error(`❌ Failed to stop remote backend: ${error.message}`)
    process.exit(1)
  }
}

async function runDockerCompose() {
  console.log('   Using docker-compose...')

  await runCommand([
    'docker-compose',
    '-f', join(DEPLOY_DIR, 'docker', 'docker-compose.yml'),
    'up', '-d'
  ])
}

async function buildImage() {
  await runCommand([
    'docker', 'build',
    '-f', join(DEPLOY_DIR, 'docker', 'Dockerfile.runtime'),
    '-t', 'agentbe/remote-backend:latest',
    PACKAGE_ROOT
  ])
}

async function runDockerDirect(shouldBuild) {
  console.log('   Using direct docker run...')

  // Build image if not already built
  if (!shouldBuild) {
    console.log('   Building Docker image...')
    await buildImage()
  }

  // Run container
  await runCommand([
    'docker', 'run', '-d',
    '--name', 'agentbe-remote-backend',
    '-p', '2222:22',
    'agentbe/remote-backend:latest'
  ])
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const process = spawn(command[0], command.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    process.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    process.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    process.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${stderr || stdout}`))
      }
    })

    process.on('error', reject)
  })
}

// ─────────────────────────────────────────────────────────────────
// Help
// ─────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
🚀 agent-backend - Agent Backend CLI

USAGE:
  agent-backend <command> [options]

COMMANDS:
  daemon                 Start agentbe-daemon (MCP + SSH server)
  start-docker [--build] Start Docker container with agentbe-daemon
  stop-docker            Stop Docker container
  help                   Show this help message

DAEMON COMMAND:
  agent-backend daemon --rootDir <path> [OPTIONS]

  Starts agentbe-daemon with MCP HTTP server (and optionally SSH daemon).

  Two modes:
  1. Local-only mode (--local-only): Stdio MCP server for local dev, works on any platform
  2. Full mode: MCP + SSH, requires Linux and root privileges

  Required Options:
    --rootDir <path>       Root directory to serve

  Optional - Mode:
    --local-only           Run MCP server via stdio (no SSH, no HTTP). Works on any platform.
                           Perfect for local development with LocalFilesystemBackend.

  Optional - Scoping:
    --scopePath <path>     Static scope path within rootDir. All operations are restricted
                           to this subdirectory. For stdio mode, this is the only way to scope.
                           For HTTP mode, this conflicts with dynamic X-Scope-Path header.

  Optional - MCP Server:
    --mcp-port <port>      HTTP server port (default: 3001)
    --mcp-auth-token <tok> Bearer token for MCP endpoint authentication
    --isolation <mode>     Command isolation: auto|bwrap|software|none (default: auto)
    --shell <shell>        Shell to use: bash|sh|auto (default: auto)

  Optional - SSH (full mode only):
    --ssh-users <users>    Comma-separated user:password pairs (default: root:agents)
                           Example: alice:pass123,bob:pass456
    --ssh-public-key <key> SSH public key to add to authorized_keys
    --ssh-authorized-keys <path>  Path to authorized_keys file to copy

DOCKER MANAGEMENT:
  agent-backend start-docker [--build]

  Starts Docker container with agentbe-daemon + SSH.
  Options:
    --build                Force rebuild the Docker image

  agent-backend stop-docker

  Stops Docker container.

EXAMPLES:
  # Local-only mode (stdio, works on any platform, no SSH)
  agent-backend daemon --rootDir /tmp/workspace --local-only

  # Note: --local-only uses stdio, so auth tokens don't apply
  # For HTTP with auth, omit --local-only:
  agent-backend daemon --rootDir /tmp/workspace \\
    --mcp-auth-token secret123

  # Full daemon with defaults (Linux only: root:agents, port 3001)
  agent-backend daemon --rootDir /var/workspace

  # Full daemon with custom users (Linux only)
  agent-backend daemon --rootDir /var/workspace \\
    --ssh-users "alice:secret,bob:password"

  # Full daemon with pubkey auth (Linux only)
  agent-backend daemon --rootDir /var/workspace \\
    --ssh-public-key "ssh-rsa AAAAB3... user@host"

  # Start Docker container (includes full daemon with SSH)
  agent-backend start-docker --build

NOTES:
  - Use --local-only for local development (stdio mode, works on any platform)
  - Full daemon (with SSH) requires Linux and root privileges
  - Default SSH user is root:agents (full mode only)
  - MCP server runs on port 3001 by default
  - Use --mcp-auth-token to secure MCP endpoints (recommended for production)
  - LocalFilesystemBackend uses --local-only mode (stdio)
  - RemoteFilesystemBackend uses full daemon mode (with SSH)
`)
}

// ─────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
