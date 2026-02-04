import { NextResponse } from 'next/server'
import { getBackendConfig, COOKIE_NAME } from '@/lib/backend-config'
import { backendManager } from '@/lib/backend'
import { clearMCPClients } from '@/lib/mcp-client'

export async function GET() {
  const config = await getBackendConfig()
  console.log('[backend-config] GET config:', config.type)
  return NextResponse.json(config)
}

export async function POST(req: Request) {
  try {
    const config = await req.json()
    console.log('[backend-config] POST switching to:', config.type)

    // Clear MCP client cache (they hold references to old backend)
    await clearMCPClients()

    // Disconnect current backend before switching
    await backendManager.disconnect()

    // Force backend reinitialization on next request
    await backendManager.switchBackend(config.type)

    console.log('[backend-config] Switch complete, new type:', config.type)

    // Create response and set cookie
    const response = NextResponse.json({ success: true })
    response.cookies.set(COOKIE_NAME, JSON.stringify(config), {
      httpOnly: true,
      secure: false,  // Allow HTTP for local dev
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,  // 1 year
    })

    return response
  } catch (error) {
    console.error('Failed to update backend config:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update config',
      },
      { status: 500 }
    )
  }
}
