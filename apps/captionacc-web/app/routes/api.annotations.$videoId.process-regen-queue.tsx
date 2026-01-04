/**
 * API endpoint to trigger async image regeneration queue processing
 *
 * POST /api/annotations/:videoId/process-regen-queue
 *
 * Processes pending image regenerations for a video in the background.
 * This can be called manually or by a cron job.
 */

import { type ActionFunctionArgs } from 'react-router'

import {
  processPendingRegenerations,
  getPendingRegenerationCount,
} from '~/services/image-regen-queue'
import { jsonResponse, errorResponse, extractVideoId } from '~/utils/api-responses'

/**
 * POST /api/annotations/:videoId/process-regen-queue
 *
 * Process pending image regenerations for a video
 */
export async function action({ params, request }: ActionFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value

  try {
    const url = new URL(request.url)
    const maxBatch = parseInt(url.searchParams.get('maxBatch') ?? '10')

    const beforeCount = getPendingRegenerationCount(videoId)
    console.log(
      `[ProcessRegenQueue] Processing ${beforeCount} pending regenerations for ${videoId}`
    )

    const processed = await processPendingRegenerations(videoId, maxBatch)
    const afterCount = getPendingRegenerationCount(videoId)

    return jsonResponse({
      success: true,
      processed,
      remaining: afterCount,
      total: beforeCount,
    })
  } catch (error) {
    return errorResponse((error as Error).message, 500)
  }
}
