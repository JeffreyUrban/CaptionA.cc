/**
 * API route for box annotations on individual frames.
 *
 * GET: Fetch all boxes for a frame with predictions and user annotations (requires view permission)
 * POST/PUT: Save box annotations for a frame (requires annotate permission)
 */

import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'

import {
  getFrameBoxes,
  saveBoxAnnotations,
  type BoxAnnotationInput,
} from '~/services/box-annotation-service'
import {
  jsonResponse,
  errorResponse,
  badRequestResponse,
  notFoundResponse,
  extractVideoId,
  parseIntParam,
} from '~/utils/api-responses'
import { requireAnnotatePermission } from '~/utils/video-permissions'

// =============================================================================
// GET - Fetch boxes for a frame with predictions and annotations
// =============================================================================

export async function loader({ params, request }: LoaderFunctionArgs) {
  // Extract and validate videoId
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value

  // Check annotation permission (allows viewing for demo videos and owned videos)
  await requireAnnotatePermission(request, videoId)

  // Extract and validate frameIndex
  const frameIndexResult = parseIntParam(params['frameIndex'], 'frameIndex')
  if (!frameIndexResult.success) return frameIndexResult.response

  try {
    const result = getFrameBoxes(videoId, frameIndexResult.value)
    return jsonResponse(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error in frame boxes API:', error)

    // Map specific errors to appropriate HTTP status codes
    if (message.includes('not found') || message.includes('not found in OCR data')) {
      return notFoundResponse(message)
    }
    return errorResponse(message, 500)
  }
}

// =============================================================================
// POST/PUT - Save box annotations
// =============================================================================

export async function action({ params, request }: ActionFunctionArgs) {
  // Extract and validate videoId
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value

  // Require annotation permission for write operations
  await requireAnnotatePermission(request, videoId)

  // Extract and validate frameIndex
  const frameIndexResult = parseIntParam(params['frameIndex'], 'frameIndex')
  if (!frameIndexResult.success) return frameIndexResult.response

  // Parse and validate request body
  let annotations: BoxAnnotationInput[]
  try {
    const body = await request.json()
    annotations = body.annotations

    if (!annotations || !Array.isArray(annotations)) {
      return badRequestResponse('Invalid annotations format')
    }
  } catch {
    return badRequestResponse('Invalid JSON body')
  }

  try {
    const result = await saveBoxAnnotations(videoId, frameIndexResult.value, annotations)
    return jsonResponse({
      success: result.success,
      annotatedCount: result.annotatedCount,
      retrainingTriggered: result.retrainingTriggered,
      streamingUpdatesApplied: result.streamingUpdatesApplied,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error saving box annotations:', error)

    // Map specific errors to appropriate HTTP status codes
    if (message.includes('not found')) {
      return notFoundResponse(message)
    }
    return errorResponse(message, 500)
  }
}
