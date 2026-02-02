import { NextRequest, NextResponse } from 'next/server'
import { createFileSystem, initAgentBackend } from '../../../lib/backends-init'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')
    const filePath = searchParams.get('file')

    if (!sessionId || !filePath) {
      return NextResponse.json({ error: 'SessionId and file path are required' }, { status: 400 })
    }

    console.log('Download API: sessionId =', JSON.stringify(sessionId))

    // Initialize AgentBackend configuration
    initAgentBackend()

    // Create FileSystem instance
    const fs = createFileSystem(sessionId)

    // Get workspace and read file content
    const workspace = await fs.getWorkspace('default')
    const content = await workspace.readFile(filePath, 'utf-8') as string

    // Get filename from path
    const filename = filePath.split('/').pop() || 'download.txt'

    // Return file as download
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })

  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Download failed'
    }, { status: 500 })
  }
}