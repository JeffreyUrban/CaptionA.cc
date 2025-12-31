/**
 * API route for box annotations on individual frames.
 *
 * GET: Fetch all boxes for a frame with predictions and user annotations
 * POST/PUT: Save box annotations for a frame
 */

import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'

import { getFrameBoxes, saveBoxAnnotations } from '~/services/box-annotation-service'
import type { BoxAnnotationInput } from '~/services/box-annotation-service'
import {
  jsonResponse,
  errorResponse,
  badRequestResponse,
  notFoundResponse,
  extractVideoId,
  parseIntParam,
} from '~/utils/api-responses'

// =============================================================================
// GET - Fetch boxes for a frame with predictions and annotations
// =============================================================================

export async function loader({ params }: LoaderFunctionArgs) {
  // Extract and validate videoId
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  // Extract and validate frameIndex
  const frameIndexResult = parseIntParam(params['frameIndex'], 'frameIndex')
  if (!frameIndexResult.success) return frameIndexResult.response

  try {
    const result = getFrameBoxes(videoIdResult.value, frameIndexResult.value)
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
    const result = saveBoxAnnotations(videoIdResult.value, frameIndexResult.value, annotations)
    return jsonResponse({
      success: result.success,
      annotatedCount: result.annotatedCount,
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
