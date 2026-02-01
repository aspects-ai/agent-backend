import { NextRequest, NextResponse } from 'next/server'
import { createFileSystem, initAgentBackend } from '../../../lib/backends-init'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const sessionId = formData.get('sessionId') as string

    if (!file || !sessionId) {
      return NextResponse.json({ error: 'File and sessionId are required' }, { status: 400 })
    }

    console.log('Upload API: sessionId =', JSON.stringify(sessionId))

    // Initialize AgentBackend configuration
    initAgentBackend()

    // Create FileSystem instance
    const fs = createFileSystem(sessionId)

    // Read file content
    const arrayBuffer = await file.arrayBuffer()
    const content = Buffer.from(arrayBuffer).toString('utf8')

    // Get workspace and write file
    const workspace = await fs.getWorkspace('default')
    await workspace.write(file.name, content)

    return NextResponse.json({
      success: true,
      message: `File "${file.name}" uploaded successfully`,
      filename: file.name
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Upload failed'
    }, { status: 500 })
  }
}