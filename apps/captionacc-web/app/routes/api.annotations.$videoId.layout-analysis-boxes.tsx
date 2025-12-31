/**
 * API route for fetching layout analysis boxes.
 *
 * GET /api/annotations/:videoId/layout-analysis-boxes
 *
 * Returns all OCR boxes with predictions and color codes for visualization
 * in the layout editor. Supports optional frameIndex query parameter for
 * filtering to a specific frame.
 */

import { type LoaderFunctionArgs } from 'react-router'

import { getLayoutAnalysisBoxes } from '~/services/layout-analysis-service'
import {
  extractVideoId,
  jsonResponse,
  errorResponse,
  notFoundResponse,
} from '~/utils/api-responses'

/**
 * GET - Fetch all OCR boxes for analysis view.
 *
 * Query parameters:
 * - frameIndex (optional): Filter to specific frame index
 *
 * Response:
 * - boxes: Array of box data with predictions and color codes
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  // Extract and validate videoId
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) {
    return videoIdResult.response
  }
  const videoId = videoIdResult.value

  // Parse optional frameIndex query parameter
  const url = new URL(request.url)
  const frameIndexParam = url.searchParams.get('frameIndex')
  const frameIndex = frameIndexParam ? parseInt(frameIndexParam, 10) : undefined

  // Validate frameIndex if provided
  if (frameIndex !== undefined && (isNaN(frameIndex) || frameIndex < 0)) {
    return errorResponse('Invalid frameIndex parameter', 400)
  }

  try {
    const boxes = getLayoutAnalysisBoxes(videoId, frameIndex)
    return jsonResponse({ boxes })
  } catch (error) {
    console.error('Error fetching layout analysis boxes:', error)

    const message = error instanceof Error ? error.message : 'Unknown error'

    // Return 404 for "not found" errors, 500 for others
    if (message.includes('not found')) {
      return notFoundResponse(message)
    }

    return errorResponse(message)
  }
}
