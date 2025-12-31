/**
 * Bulk annotate boxes within a rectangle for a specific frame.
 *
 * POST /api/annotations/:videoId/frames/:frameIndex/bulk-annotate
 *
 * Request body:
 * {
 *   rectangle: { left: number, top: number, right: number, bottom: number }  // pixel coordinates
 *   action: 'mark_in' | 'mark_out' | 'clear'
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   action: 'mark_in' | 'mark_out' | 'clear',
 *   annotatedCount: number,
 *   boxIndices: number[]
 * }
 */

import { type ActionFunctionArgs } from 'react-router'

import {
  bulkAnnotateRectangle,
  type BulkAnnotateRectangleInput,
} from '~/services/box-annotation-service'
import {
  extractVideoId,
  parseIntParam,
  jsonResponse,
  badRequestResponse,
  errorResponse,
} from '~/utils/api-responses'

export async function action({ params, request }: ActionFunctionArgs) {
  // Extract and validate videoId
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  // Extract and validate frameIndex
  const frameIndexResult = parseIntParam(params['frameIndex'], 'frameIndex')
  if (!frameIndexResult.success) return frameIndexResult.response

  try {
    const body = (await request.json()) as BulkAnnotateRectangleInput
    const { rectangle, action } = body

    // Validate request body
    if (!rectangle || !action) {
      return badRequestResponse('Missing rectangle or action')
    }

    // Delegate to service layer
    const result = bulkAnnotateRectangle(videoIdResult.value, frameIndexResult.value, {
      rectangle,
      action,
    })

    return jsonResponse(result)
  } catch (error) {
    console.error('Error in bulk annotate:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
