/**
 * API route for bulk annotating boxes within a rectangle across all frames.
 *
 * POST /api/annotations/:videoId/bulk-annotate-all
 * Body: {
 *   rectangle: { left: number, top: number, right: number, bottom: number }
 *   action: 'mark_out' | 'clear'
 * }
 *
 * Response: {
 *   success: boolean,
 *   action: 'mark_out' | 'clear',
 *   totalAnnotatedBoxes: number,
 *   newlyAnnotatedBoxes: number,
 *   framesProcessed: number,
 *   frameIndices: number[]
 * }
 */

import { type ActionFunctionArgs } from 'react-router'

import {
  bulkAnnotateRectangleAllFrames,
  type BulkAnnotateRectangleAllAction,
} from '~/services/box-annotation-service'
import {
  extractVideoId,
  jsonResponse,
  badRequestResponse,
  errorResponse,
} from '~/utils/api-responses'

interface BulkAnnotateAllRequest {
  rectangle: {
    left: number
    top: number
    right: number
    bottom: number
  }
  action: 'mark_out' | 'clear'
}

const VALID_ACTIONS: BulkAnnotateRectangleAllAction[] = ['mark_out', 'clear']

function isValidAction(action: unknown): action is BulkAnnotateRectangleAllAction {
  return (
    typeof action === 'string' && VALID_ACTIONS.includes(action as BulkAnnotateRectangleAllAction)
  )
}

function isValidRectangle(
  rectangle: unknown
): rectangle is { left: number; top: number; right: number; bottom: number } {
  if (!rectangle || typeof rectangle !== 'object') return false
  const r = rectangle as Record<string, unknown>
  return (
    typeof r['left'] === 'number' &&
    typeof r['top'] === 'number' &&
    typeof r['right'] === 'number' &&
    typeof r['bottom'] === 'number'
  )
}

// POST - Bulk annotate boxes across all 0.1Hz analysis frames
export async function action({ params, request }: ActionFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  try {
    const body = (await request.json()) as BulkAnnotateAllRequest
    const { rectangle, action: requestAction } = body

    if (!isValidRectangle(rectangle)) {
      return badRequestResponse('Missing or invalid rectangle')
    }

    if (!isValidAction(requestAction)) {
      return badRequestResponse('Missing or invalid action. Must be "mark_out" or "clear"')
    }

    const result = bulkAnnotateRectangleAllFrames(videoIdResult.value, rectangle, requestAction)

    return jsonResponse(result)
  } catch (error) {
    console.error('Error in bulk annotate all:', error)
    return errorResponse(error instanceof Error ? error.message : 'Unknown error')
  }
}
