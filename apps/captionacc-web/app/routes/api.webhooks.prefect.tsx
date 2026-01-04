/**
 * Webhook endpoint for Prefect flow notifications.
 *
 * This endpoint receives notifications from Prefect flows when they complete,
 * allowing us to invalidate the video stats cache instead of polling.
 *
 * Prefect flows should POST to this endpoint with:
 * {
 *   "videoId": "video-uuid-or-display-path",
 *   "flowName": "caption-median-ocr" | "crop-frames" | etc,
 *   "status": "complete" | "error",
 *   "error": "error message" (optional, if status is error)
 * }
 */

import { type ActionFunctionArgs } from 'react-router'

import { sseBroadcaster } from '~/services/sse-broadcaster'
import { errorResponse, jsonResponse } from '~/utils/api-responses'

interface PrefectWebhookPayload {
  videoId: string
  flowName: string
  status: 'started' | 'complete' | 'error'
  error?: string
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const payload = (await request.json()) as PrefectWebhookPayload

    // Validate payload
    if (!payload.videoId || !payload.flowName || !payload.status) {
      return errorResponse('Missing required fields: videoId, flowName, status', 400)
    }

    // Log the notification
    console.log(
      `[PrefectWebhook] Flow "${payload.flowName}" ${payload.status} for video: ${payload.videoId}`,
      payload.error ? `Error: ${payload.error}` : ''
    )

    // Broadcast to all connected SSE clients
    sseBroadcaster.broadcast('video-stats-updated', {
      videoId: payload.videoId,
      flowName: payload.flowName,
      status: payload.status,
      timestamp: new Date().toISOString(),
    })

    return jsonResponse({
      success: true,
      message: `Webhook received for ${payload.videoId}`,
      clients: sseBroadcaster.getClientCount(),
    })
  } catch (error) {
    console.error('[PrefectWebhook] Error processing webhook:', error)
    return errorResponse((error as Error).message, 500)
  }
}
