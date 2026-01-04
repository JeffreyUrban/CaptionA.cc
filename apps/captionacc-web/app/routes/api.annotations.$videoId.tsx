/**
 * Annotation API route handler for caption boundary management.
 *
 * This is a thin route handler that delegates to the annotation-crud-service
 * for all business logic. It handles:
 * - GET: List annotations in a frame range
 * - POST: Create a new annotation (no overlap resolution)
 * - PUT: Update an annotation with overlap resolution
 *
 * All database operations and overlap resolution logic are in the service layer.
 */

import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'

import {
  listAnnotations,
  createAnnotation,
  updateAnnotationWithOverlapResolution,
  type Annotation,
  type CreateAnnotationInput,
  type UpdateAnnotationInput,
} from '~/services/annotation-crud-service'
import { jsonResponse, errorResponse, extractVideoId } from '~/utils/api-responses'

// =============================================================================
// Loader - GET annotations
// =============================================================================

/**
 * GET /api/annotations/:videoId?start=N&end=M
 *
 * Fetch annotations that overlap with the specified frame range.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value
  const url = new URL(request.url)
  const startFrame = parseInt(url.searchParams.get('start') ?? '0')
  const endFrame = parseInt(url.searchParams.get('end') ?? '1000')
  const workableOnly = url.searchParams.get('workable') === 'true'
  const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : undefined

  try {
    const annotations = listAnnotations(videoId, startFrame, endFrame, workableOnly, limit)
    // Convert to snake_case for API compatibility
    return jsonResponse({ annotations: annotations.map(toSnakeCase) })
  } catch (error) {
    return errorResponse((error as Error).message, 500)
  }
}

// =============================================================================
// Action - POST/PUT annotations
// =============================================================================

/**
 * POST/PUT /api/annotations/:videoId
 *
 * POST: Create a new annotation without overlap resolution
 * PUT: Update an existing annotation with automatic overlap resolution
 */
export async function action({ params, request }: ActionFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value
  const body = await request.json()

  try {
    if (request.method === 'PUT') {
      // Update existing annotation with overlap resolution
      const input: UpdateAnnotationInput = {
        id: body.id,
        startFrameIndex: body.start_frame_index,
        endFrameIndex: body.end_frame_index,
        boundaryState: body.boundary_state,
      }

      const result = updateAnnotationWithOverlapResolution(videoId, input)

      // Return in snake_case format for API compatibility
      return jsonResponse({
        annotation: toSnakeCase(result.annotation),
        deletedAnnotations: result.deletedAnnotations,
        modifiedAnnotations: result.modifiedAnnotations.map(toSnakeCase),
        createdGaps: result.createdGaps.map(toSnakeCase),
      })
    } else {
      // Create new annotation
      const input: CreateAnnotationInput = {
        startFrameIndex: body.start_frame_index,
        endFrameIndex: body.end_frame_index,
        boundaryState: body.boundary_state,
        boundaryPending: body.boundary_pending,
        text: body.text,
      }

      const annotation = createAnnotation(videoId, input)

      // Return in snake_case format for API compatibility
      return jsonResponse({ annotation: toSnakeCase(annotation) })
    }
  } catch (error) {
    return errorResponse((error as Error).message, 500)
  }
}

// =============================================================================
// Response Transformation
// =============================================================================

/**
 * Convert a camelCase annotation to snake_case for API response.
 *
 * The service layer uses camelCase internally, but the API contract
 * uses snake_case for backwards compatibility.
 */
function toSnakeCase(annotation: Annotation) {
  return {
    id: annotation.id,
    start_frame_index: annotation.startFrameIndex,
    end_frame_index: annotation.endFrameIndex,
    state: annotation.boundaryState, // Frontend expects 'state', not 'boundary_state'
    pending: annotation.boundaryPending, // Frontend expects 'pending' as boolean
    boundary_updated_at: annotation.boundaryUpdatedAt,
    text: annotation.text,
    text_pending: annotation.textPending ? 1 : 0,
    text_status: annotation.textStatus,
    text_notes: annotation.textNotes,
    text_ocr_combined: annotation.textOcrCombined,
    text_updated_at: annotation.textUpdatedAt,
    image_needs_regen: annotation.imageNeedsRegen ? 1 : 0,
    created_at: annotation.createdAt,
  }
}
