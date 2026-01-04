/**
 * Server-Sent Events (SSE) endpoint for real-time video stats updates.
 *
 * Clients connect to this endpoint to receive real-time notifications when:
 * - Prefect flows complete
 * - Video processing status changes
 * - Stats are updated
 *
 * This replaces polling with push-based updates.
 */

import { type LoaderFunctionArgs } from 'react-router'

import { sseBroadcaster } from '~/services/sse-broadcaster'

export async function loader({ request }: LoaderFunctionArgs) {
  // Create a ReadableStream for SSE
  const stream = new ReadableStream({
    start(controller) {
      // Register this client with the broadcaster
      const client = sseBroadcaster.addClient(controller)

      // Send keep-alive comments every 30 seconds to prevent timeout
      const keepAliveInterval = setInterval(() => {
        try {
          client.send(': keepalive\n\n')
        } catch {
          // Connection closed, clear interval
          clearInterval(keepAliveInterval)
        }
      }, 30000)

      // Clean up when connection closes
      request.signal.addEventListener('abort', () => {
        console.log(`[SSE] Client aborted: ${client.id}`)
        clearInterval(keepAliveInterval)
        client.close()
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },
    cancel() {
      console.log('[SSE] Stream cancelled by client')
    },
  })

  // Return SSE response with proper headers
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}
