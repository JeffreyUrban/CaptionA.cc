/**
 * API route for navigating between annotations by update time.
 *
 * GET /api/annotations/:videoId/navigate?direction=prev|next&currentId=123
 *
 * Navigates to the previous or next annotation based on caption_frame_extents_updated_at,
 * allowing users to review annotations in the order they were last modified.
 */

import { type LoaderFunctionArgs } from 'react-router'

import { navigateAnnotation, type NavigationDirection } from '~/services/navigation-service'
import {
  extractVideoId,
  parseIntParam,
  badRequestResponse,
  jsonResponse,
  errorResponse,
  notFoundResponse,
} from '~/utils/api-responses'

/**
 * GET handler for annotation navigation.
 *
 * Query parameters:
 * - direction: 'prev' or 'next' (required)
 * - currentId: ID of the current annotation (required)
 *
 * Returns the annotation in the specified direction, or null if none exists.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  // Extract and validate videoId
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  // Parse query parameters
  const url = new URL(request.url)
  const direction = url.searchParams.get('direction')
  const currentIdResult = parseIntParam(url.searchParams.get('currentId') ?? undefined, 'currentId')
  if (!currentIdResult.success) return currentIdResult.response

  // Validate direction
  if (!direction || !['prev', 'next'].includes(direction)) {
    return badRequestResponse('Invalid direction: must be "prev" or "next"')
  }

  try {
    const result = await navigateAnnotation(
      videoIdResult.value,
      currentIdResult.value,
      direction as NavigationDirection
    )
    return jsonResponse({ annotation: result.annotation })
  } catch (error) {
    const message = (error as Error).message
    if (message === 'Database not found') {
      return notFoundResponse('Video not found')
    }
    if (message === 'Current annotation not found') {
      return notFoundResponse('Current annotation not found')
    }
    return errorResponse(message)
  }
}
