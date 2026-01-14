/**
 * API route for checking background processing status.
 *
 * GET: Check if streaming updates or full retrain is in progress
 */

import { type LoaderFunctionArgs } from 'react-router'

import { getProcessingStatus } from '~/services/processing-status-tracker'
import { jsonResponse, extractVideoId } from '~/utils/api-responses'

/**
 * GET - Check processing status for a video.
 *
 * Returns:
 * - isProcessing: boolean - Whether any processing is in progress
 * - type: 'streaming_update' | 'full_retrain' | null
 * - startedAt: ISO timestamp
 * - estimatedCompletionAt: ISO timestamp
 * - progress: Optional progress information
 */
export async function loader({ params }: LoaderFunctionArgs) {
  // Extract and validate videoId
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value
  const status = getProcessingStatus(videoId)

  if (!status) {
    return jsonResponse({
      isProcessing: false,
      type: null,
      startedAt: null,
      estimatedCompletionAt: null,
      progress: null,
    })
  }

  return jsonResponse({
    isProcessing: true,
    type: status.type,
    startedAt: status.startedAt.toISOString(),
    estimatedCompletionAt: status.estimatedCompletionAt.toISOString(),
    progress: status.progress ?? null,
  })
}
