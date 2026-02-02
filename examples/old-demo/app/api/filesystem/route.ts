import { NextRequest, NextResponse } from 'next/server'
import { createFileSystem, initAgentBackend } from '../../../lib/backends-init'

interface FileItem {
  path: string
  type: 'file' | 'directory'
  name: string
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json({ error: 'SessionId is required' }, { status: 400 })
    }

    console.log('Filesystem API: sessionId =', JSON.stringify(sessionId))

    // Initialize AgentBackend configuration
    initAgentBackend()

    // Create FileSystem instance
    console.log('Initializing FileSystem...')
    const fs = createFileSystem(sessionId)

    // Get workspace
    const workspace = await fs.getWorkspace('default')

    let files: FileItem[]

    // Use exec to list files - works for both local and remote
    try {
      console.log('Executing find command...')
      const output = await workspace.exec('find . -maxdepth 3 -type f -o -type d | head -100')
      if (typeof output !== 'string') {
        throw new Error('Output is not a string')
      }
      console.log('Command executed successfully, output:', output.substring(0, 200))
      files = parseRemoteFileTree(output)
    } catch (error) {
      console.error('File listing failed:', error)
      console.error('Error details:', (error as Error).message, (error as Error).stack)
      return NextResponse.json({
        error: 'File listing failed',
        details: (error as Error).message
      }, { status: 500 })
    }

    return NextResponse.json({ files })
  } catch (error) {
    console.error('Filesystem API Error:', error)
    if (error instanceof Error) {
      return NextResponse.json({
        error: 'Failed to read filesystem',
        details: error.message
      }, { status: 500 })
    }
    return NextResponse.json({ error: 'Failed to read filesystem' }, { status: 500 })
  }
}

function parseRemoteFileTree(output: string): FileItem[] {
  const lines = output.split('\n').filter(line => line.trim())
  const files: FileItem[] = []

  for (const line of lines) {
    const path = line.replace(/^\.\//, '') // Remove leading ./
    if (!path || path === '.') continue

    const name = path.split('/').pop() || path

    // Heuristic: if it has an extension or doesn't end with common directory patterns, treat as file
    const isFile = name.includes('.') && !name.endsWith('/') &&
      !(['bin', 'lib', 'etc', 'usr', 'var', 'tmp', 'opt'].includes(name))

    files.push({
      path,
      type: isFile ? 'file' : 'directory',
      name
    })
  }

  return files
}