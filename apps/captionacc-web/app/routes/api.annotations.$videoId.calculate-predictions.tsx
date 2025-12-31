/**
 * API route for calculating and caching predictions for all OCR boxes.
 *
 * POST /api/annotations/:videoId/calculate-predictions
 *
 * Trains the model if sufficient annotations exist, then calculates
 * predictions for all boxes and caches them in the database.
 */

import { type ActionFunctionArgs } from 'react-router'

import { calculatePredictions } from '~/services/box-annotation-service'
import {
  extractVideoId,
  jsonResponse,
  errorResponse,
  notFoundResponse,
} from '~/utils/api-responses'

// POST - Calculate and cache predictions for all boxes
export async function action({ params }: ActionFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) {
    return videoIdResult.response
  }
  const videoId = videoIdResult.value

  try {
    const result = calculatePredictions(videoId)
    return jsonResponse(result)
  } catch (error) {
    console.error('Error calculating predictions:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'

    // Return 404 for known "not found" errors
    if (message.includes('not found')) {
      return notFoundResponse(message)
    }

    return errorResponse(message)
  }
}
