/**
 * Layout configuration API endpoint.
 *
 * PUT: Update layout configuration (crop bounds, selection bounds, selection mode, layout params)
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
 * - cropBounds?: { left, top, right, bottom } - Crop bounds in pixels
 * - selectionBounds?: { left, top, right, bottom } - Selection bounds in pixels
 * - selectionMode?: 'hard' | 'soft' | 'disabled' - Selection mode
 * - layoutParams?: { verticalPosition, verticalStd, boxHeight, boxHeightStd, anchorType, anchorPosition }
 *
 * Response:
 * - success: boolean
 * - boundsChanged: boolean - Whether crop bounds actually changed
 * - framesInvalidated: number - Number of frames invalidated (if bounds changed)
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
