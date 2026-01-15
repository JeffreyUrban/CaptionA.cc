/**
 * API route for resetting crop bounds by re-analyzing OCR data.
 *
 * POST /api/annotations/:videoId/reset-crop-bounds
 *
 * Re-analyzes OCR boxes to determine optimal crop bounds and layout parameters.
 * Uses caption boxes (predicted + user overrides) when available, falling back
 * to all boxes if no caption boxes are labeled.
 */

import { type ActionFunctionArgs } from 'react-router'

import { resetCropBounds } from '~/services/layout-analysis-service'
import {
  extractVideoId,
  jsonResponse,
  errorResponse,
  notFoundResponse,
} from '~/utils/api-responses'

/**
 * POST handler - Reset crop bounds by re-analyzing OCR data.
 *
 * @returns JSON response with new crop bounds and analysis statistics
 */
export async function action({ params }: ActionFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value

  try {
    const result = await resetCropBounds(videoId)

    return jsonResponse({
      success: true,
      newCropBounds: result.newCropBounds,
      analysisData: result.analysisData,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error resetting crop bounds:', error)

    // Handle specific error cases
    if (message === 'Database not found') {
      return notFoundResponse('Video not found')
    }
    if (message === 'Layout config not found') {
      return notFoundResponse('Layout config not found')
    }
    if (message === 'No OCR data found') {
      return notFoundResponse('No OCR data found')
    }

    return errorResponse(message, 500)
  }
}
