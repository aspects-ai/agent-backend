#!/usr/bin/env node

/**
 * agentbe-server CLI
 *
 * Commands:
 * 1. Start MCP servers for different backend types (default command)
 * 2. start-remote: Start Docker-based remote backend service
 * 3. stop-remote: Stop Docker-based remote backend service
 */

import { execSync, spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  LocalFilesystemBackend,
  RemoteFilesystemBackend,
  MemoryBackend
} from 'constellationfs'
import {
  LocalFilesystemMCPServer,
  RemoteFilesystemMCPServer,
  MemoryMCPServer
} from '../dist/index.js'

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
  if (command === 'start-remote') {
    await handleStartRemote(args.slice(1))
    return
  }

  if (command === 'stop-remote') {
    await handleStopRemote()
    return
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  // Default: start MCP server
  await startMCPServer(args)
}

// ─────────────────────────────────────────────────────────────────
// MCP Server (default command)
// ─────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const config = {
    backend: 'local', // default to local
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]

    switch (arg) {
      // Common options
      case '--backend':
        config.backend = next
        i++
        break
      case '--rootDir':
        config.rootDir = next
        i++
        break

      // LocalFilesystemBackend options
      case '--isolation':
        config.isolation = next
        i++
        break
      case '--shell':
        config.shell = next
        i++
        break

      // RemoteFilesystemBackend options
      case '--host':
        config.host = next
        i++
        break
      case '--username':
        config.username = next
        i++
        break
      case '--password':
        config.password = next
        i++
        break
      case '--privateKey':
        config.privateKey = next
        i++
        break
      case '--port':
        config.port = parseInt(next, 10)
        i++
        break

      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  // Validation
  if (!config.rootDir) {
    console.error('❌ Error: --rootDir is required')
    printHelp()
    process.exit(1)
  }

  if (!['local', 'remote', 'memory'].includes(config.backend)) {
    console.error(`❌ Error: Invalid backend type "${config.backend}"`)
    console.error('   Valid types: local, remote, memory')
    process.exit(1)
  }

  // Backend-specific validation
  if (config.backend === 'remote') {
    if (!config.host) {
      console.error('❌ Error: --host is required for remote backend')
      printHelp()
      process.exit(1)
    }
    if (!config.username) {
      console.error('❌ Error: --username is required for remote backend')
      printHelp()
      process.exit(1)
    }
    if (!config.password && !config.privateKey) {
      console.error('❌ Error: Either --password or --privateKey is required for remote backend')
      printHelp()
      process.exit(1)
    }
  }

  return config
}

async function startMCPServer(args) {
  const config = parseArgs(args)

  console.error(`🚀 Starting ${config.backend} MCP server...`)
  console.error(`📁 Root directory: ${config.rootDir}`)

  try {
    let backend
    let mcpServer

    // Create backend and MCP server based on type
    switch (config.backend) {
      case 'local': {
        console.error(`🔒 Isolation: ${config.isolation || 'auto'}`)
        backend = new LocalFilesystemBackend({
          rootDir: config.rootDir,
          isolation: config.isolation,
          shell: config.shell,
        })
        mcpServer = new LocalFilesystemMCPServer(backend)
        break
      }

      case 'remote': {
        console.error(`🌐 SSH Host: ${config.host}`)
        console.error(`👤 Username: ${config.username}`)

        const sshAuth = config.privateKey
          ? {
              type: 'key',
              credentials: {
                username: config.username,
                privateKey: config.privateKey,
              },
            }
          : {
              type: 'password',
              credentials: {
                username: config.username,
                password: config.password,
              },
            }

        backend = new RemoteFilesystemBackend({
          rootDir: config.rootDir,
          host: config.host,
          sshAuth,
          port: config.port,
        })
        mcpServer = new RemoteFilesystemMCPServer(backend)
        break
      }

      case 'memory': {
        console.error(`💾 Memory backend (no exec tool)`)
        backend = new MemoryBackend({
          rootDir: config.rootDir,
        })
        mcpServer = new MemoryMCPServer(backend)
        break
      }
    }

    // Connect stdio transport
    const transport = new StdioServerTransport()
    await mcpServer.getServer().connect(transport)

    console.error(`✅ MCP server running on stdio`)
    console.error(`   Backend: ${config.backend}`)
    console.error(`   Ready to receive MCP requests`)

  } catch (error) {
    console.error(`❌ Failed to start MCP server: ${error.message}`)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

// ─────────────────────────────────────────────────────────────────
// Docker Remote Backend Management
// ─────────────────────────────────────────────────────────────────

async function handleStartRemote(args) {
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
          await runCommand(['docker', 'stop', 'agentbe-remote-backend']).catch(() => {})
          await runCommand(['docker', 'rm', 'agentbe-remote-backend']).catch(() => {})
        } else {
          console.log('✅ Remote backend is already running')
          console.log('   SSH available at: root@localhost:2222')
          console.log('   Default password: constellation')
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
      console.log('   Default password: constellation')
      console.log('')
      console.log('   Connect using RemoteFilesystemBackend:')
      console.log('   agentbe-server --backend remote --rootDir /workspace \\')
      console.log('     --host localhost --port 2222 --username root --password constellation')

    } catch (error) {
      throw new Error(`Failed to start remote backend: ${error.message}`)
    }
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }
}

async function handleStopRemote() {
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
🚀 agentbe-server - MCP Server for Agent Backend

USAGE:
  agentbe-server [COMMAND] [OPTIONS]

COMMANDS:
  (default)              Start an MCP server for the specified backend type
  start-remote [--build] Start Docker-based remote backend service
  stop-remote            Stop Docker-based remote backend service
  help                   Show this help message

MCP SERVER OPTIONS (default command):

  Backend Types:
    --backend <type>       Backend type (required, default: local)
                           Options: local, remote, memory

  Common Options:
    --rootDir <path>       Root directory for backend (required)

  Local Backend Options:
    --isolation <mode>     Isolation mode: auto, bwrap, software, none (default: auto)
    --shell <shell>        Shell to use: bash, sh, auto (default: auto)

  Remote Backend Options:
    --host <host>          SSH host (required for remote)
    --username <user>      SSH username (required for remote)
    --password <pass>      SSH password (use --password OR --privateKey)
    --privateKey <path>    Path to SSH private key file
    --port <port>          SSH port (default: 22)

REMOTE MANAGEMENT OPTIONS:

  start-remote Options:
    --build                Force rebuild the Docker image

EXAMPLES:

  # Start local MCP server with bwrap isolation
  agentbe-server --backend local --rootDir /tmp/workspace --isolation bwrap

  # Start remote MCP server connecting to SSH host
  agentbe-server --backend remote --rootDir /var/workspace \\
    --host server.example.com --username user --password secret

  # Start memory backend (no exec tool)
  agentbe-server --backend memory --rootDir /memory

  # Start Docker remote backend service
  agentbe-server start-remote

  # Stop Docker remote backend service
  agentbe-server stop-remote

  # Rebuild and restart Docker remote backend
  agentbe-server start-remote --build

NOTES:
  - MCP servers use stdio transport by default
  - Only local and remote backends support the 'exec' tool
  - Memory backend provides filesystem-like operations on key/value store
  - Docker remote backend provides an SSH-accessible filesystem service
`)
}

// ─────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
