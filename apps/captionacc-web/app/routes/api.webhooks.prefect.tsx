/**
 * Webhook endpoint for Prefect Automation notifications.
 *
 * This endpoint receives notifications from Prefect Automations when flow states change.
 * Prefect automatically calls this webhook via the configured automation.
 *
 * Payload format (from Prefect Automation):
 * {
 *   "event": "prefect.flow-run.Completed",
 *   "flowRunId": "prefect.flow-run.xxx",
 *   "flowName": "upload-and-process-video",
 *   "state": "Completed",
 *   "timestamp": "2024-01-01T00:00:00Z",
 *   "tags": ["upload", "processing"],
 *   "parameters": [...]
 * }
 */

import { type ActionFunctionArgs } from 'react-router'

import { sseBroadcaster } from '~/services/sse-broadcaster'
import { errorResponse, jsonResponse } from '~/utils/api-responses'

interface PrefectAutomationPayload {
  event: string
  flowRunId: string
  flowName: string
  state: string
  timestamp: string
  tags?: string[]
  parameters?: Array<Record<string, unknown>>
}

function extractVideoId(parameters: Array<Record<string, unknown>> | undefined): string | null {
  if (!parameters || parameters.length === 0) return null

  // Look for video_id in parameters
  for (const param of parameters) {
    if (param['video_id']) return param['video_id'] as string
    if (param['videoId']) return param['videoId'] as string
  }
  return null
}

function mapStateToStatus(state: string): 'started' | 'complete' | 'error' {
  const lowerState = state.toLowerCase()
  if (lowerState === 'running') return 'started'
  if (lowerState === 'completed') return 'complete'
  if (lowerState === 'failed' || lowerState === 'crashed') return 'error'
  return 'complete' // default
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const payload = (await request.json()) as PrefectAutomationPayload

    // Validate payload
    if (!payload.flowName || !payload.state) {
      return errorResponse('Missing required fields from Prefect automation', 400)
    }

    // Extract video ID from parameters
    const videoId = extractVideoId(payload.parameters)
    if (!videoId) {
      console.log(`[PrefectWebhook] No video ID found in flow "${payload.flowName}"`)
      // Some flows may not have video IDs, that's OK
      return jsonResponse({
        success: true,
        message: 'Webhook received but no video ID found',
      })
    }

    // Map Prefect state to our status
    const status = mapStateToStatus(payload.state)

    // Log the notification
    console.log(
      `[PrefectWebhook] Flow "${payload.flowName}" ${status} for video: ${videoId}`,
      payload.state !== 'Completed' && payload.state !== 'Running' ? `State: ${payload.state}` : ''
    )

    // Broadcast to all connected SSE clients
    sseBroadcaster.broadcast('video-stats-updated', {
      videoId,
      flowName: payload.flowName,
      status,
      timestamp: payload.timestamp || new Date().toISOString(),
    })

    return jsonResponse({
      success: true,
      message: `Webhook received for ${videoId}`,
      clients: sseBroadcaster.getClientCount(),
    })
  } catch (error) {
    console.error('[PrefectWebhook] Error processing webhook:', error)
    return errorResponse((error as Error).message, 500)
  }
}
