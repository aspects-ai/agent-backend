import { NextResponse } from 'next/server'
import { ConnectionStatus } from 'agent-backend'
import { backendManager } from '@/lib/backend'

export async function GET() {
  try {
    const backend = await backendManager.getBackend()
    const type = backendManager.getCurrentType()

    return NextResponse.json({
      connected: backend.status === ConnectionStatus.CONNECTED,
      status: backend.status,
      type,
      rootDir: 'rootDir' in backend ? backend.rootDir : undefined
    })
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        status: ConnectionStatus.DISCONNECTED,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
