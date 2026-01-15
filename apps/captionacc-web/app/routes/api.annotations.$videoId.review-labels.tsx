/**
 * API route for reviewing potential mislabels in annotation data.
 *
 * GET /api/annotations/:videoId/review-labels
 *
 * Returns boxes where the model disagrees with user labels or where
 * box positions are unusually far from the caption cluster average.
 */
import { type LoaderFunctionArgs } from 'react-router'

import { findPotentialMislabels } from '~/services/layout-queue-service'
import { errorResponse, extractVideoId, jsonResponse } from '~/utils/api-responses'

/**
 * GET handler - Find potential mislabeled boxes for review.
 *
 * Query parameters:
 * - limit: Maximum number of results (default: 100)
 *
 * Returns:
 * - potentialMislabels: Array of boxes that may be mislabeled
 * - clusterStats: Average top/bottom positions of caption cluster
 * - summary: Counts of different mislabel types
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) {
    return videoIdResult.response
  }

  const url = new URL(request.url)
  const limit = parseInt(url.searchParams.get('limit') ?? '100', 10)

  try {
    const result = findPotentialMislabels(videoIdResult.value, limit)
    return jsonResponse(result)
  } catch (error) {
    console.error('Error finding potential mislabels:', error)
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500)
  }
}
