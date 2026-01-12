/**
 * Layout configuration API endpoint.
 *
 * PUT: Update layout configuration (crop region, selection crop region, selection mode, layout params)
 */

import { type ActionFunctionArgs } from 'react-router'

import {
  updateLayoutConfig,
  type UpdateLayoutConfigInput,
} from '~/services/layout-analysis-service'
import {
  extractVideoId,
  jsonResponse,
  errorResponse,
  notFoundResponse,
} from '~/utils/api-responses'

/**
 * PUT - Update layout configuration.
 *
 * Request body:
 * - cropRegion?: { left, top, right, bottom } - Crop region in pixels
 * - selectionRegion?: { left, top, right, bottom } - Selection region in pixels
 * - selectionMode?: 'hard' | 'soft' | 'disabled' - Selection mode
 * - layoutParams?: { verticalPosition, verticalStd, boxHeight, boxHeightStd, anchorType, anchorPosition }
 *
 * Response:
 * - success: boolean
 * - cropRegionChanged: boolean - Whether crop region actually changed
 * - framesInvalidated: number - Number of frames invalidated (if crop region changed)
 * - layoutParamsChanged: boolean - Whether layout parameters changed
 */
export async function action({ params, request }: ActionFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value

  try {
    const body = (await request.json()) as UpdateLayoutConfigInput

    const result = await updateLayoutConfig(videoId, body)
    return jsonResponse(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (message === 'Database not found') {
      return notFoundResponse('Video not found')
    }

    if (message === 'Layout config not found') {
      return notFoundResponse('Layout config not found')
    }

    console.error('Error updating layout config:', error)
    return errorResponse(message, 500)
  }
}
