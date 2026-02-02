import { NextRequest } from 'next/server'
import { activeStreams } from '../../../lib/streams'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId')

  if (!sessionId) {
    return new Response('SessionId is required', { status: 400 })
  }

  // Create Server-Sent Events stream
  const stream = new ReadableStream({
    start(controller) {
      // Store the controller so the message handler can write to it
      activeStreams.set(sessionId, { streamId: sessionId, controller })

      // Send initial connection message
      const connectedMessage = `data: ${JSON.stringify({ type: 'connected' })}\n\n`
      controller.enqueue(connectedMessage)

      // Set up cleanup on close
      let isCleanedUp = false
      const cleanup = () => {
        if (isCleanedUp) return // Prevent double cleanup
        
        isCleanedUp = true
        activeStreams.delete(sessionId)
        
        try {
          // Check if controller is still open before closing
          if (controller.desiredSize !== null) {
            controller.close()
          }
        } catch (error) {
          // pass
        }
      }

      // Clean up after 5 minutes of inactivity
      const timeout = setTimeout(cleanup, 5 * 60 * 1000)

      // Store cleanup function
      ;(controller as any).cleanup = () => {
        clearTimeout(timeout)
        cleanup()
      }
    },
    
    cancel() {
      // Clean up when client disconnects
      const stream = activeStreams.get(sessionId)
      if (stream?.controller && (stream.controller as any).cleanup) {
        ;(stream.controller as any).cleanup()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

