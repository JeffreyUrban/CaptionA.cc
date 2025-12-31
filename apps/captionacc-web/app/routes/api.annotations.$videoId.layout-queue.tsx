/**
 * API route for getting the layout annotation queue.
 *
 * GET /api/annotations/:videoId/layout-queue
 *
 * Returns a prioritized list of frames for layout annotation, ordered by
 * the minimum prediction confidence of their unannotated boxes. Frames
 * with lower confidence predictions appear first.
 */

import { type LoaderFunctionArgs } from 'react-router'

import { getLayoutQueue } from '~/services/layout-queue-service'
import {
  extractVideoId,
  jsonResponse,
  errorResponse,
  notFoundResponse,
} from '~/utils/api-responses'

/**
 * Error with processing status metadata.
 * Thrown by the service layer when video is still processing.
 */
interface ProcessingError extends Error {
  status?: number
  processingStatus?: string
}

/**
 * GET handler - Fetch layout annotation queue.
 *
 * @returns JSON response with prioritized frames and layout config
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value

  // Parse optional limit parameter
  const url = new URL(request.url)
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? parseInt(limitParam, 10) : 11

  try {
    const result = getLayoutQueue(videoId, limit)
    return jsonResponse(result)
  } catch (error) {
    const err = error as ProcessingError
    const message = err.message || 'Unknown error'

    console.error('Error in layout queue API:', error)

    // Handle processing-in-progress status (425 Too Early)
    if (err.status === 425) {
      return new Response(
        JSON.stringify({
          error: message,
          processingStatus: err.processingStatus,
        }),
        {
          status: 425,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Handle specific error cases
    if (message === 'Database not found') {
      return notFoundResponse('Video not found')
    }
    if (message === 'Processing status not found') {
      return notFoundResponse('Processing status not found')
    }
    if (message.includes('processing failed')) {
      return notFoundResponse(message)
    }
    if (message.includes('Layout config not found')) {
      return notFoundResponse(message)
    }
    if (message.includes('No OCR data found')) {
      return notFoundResponse(message)
    }

    return errorResponse(message, 500)
  }
}
