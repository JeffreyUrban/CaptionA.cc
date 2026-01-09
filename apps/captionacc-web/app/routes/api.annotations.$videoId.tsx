/**
 * Annotation API route handler for caption boundary management.
 *
 * This is a thin route handler that delegates to the annotation-crud-service
 * for all business logic. It handles:
 * - GET: List annotations in a frame range (requires view permission)
 * - POST: Create a new annotation (requires annotate permission)
 * - PUT: Update an annotation with overlap resolution (requires annotate permission)
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
import { requireAnnotatePermission } from '~/utils/video-permissions'

// =============================================================================
// Loader - GET annotations
// =============================================================================

/**
 * GET /api/annotations/:videoId?start=N&end=M
 *
 * Fetch annotations that overlap with the specified frame range.
 * Note: Read-only access - checking annotation permission allows viewing for demo videos too.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value

  // Note: For GET requests, we check annotation permission which allows view access
  // This handles demo videos (read-only) and owned videos (read-write)
  await requireAnnotatePermission(request, videoId)

  const url = new URL(request.url)
  const startFrame = parseInt(url.searchParams.get('start') ?? '0')
  const endFrame = parseInt(url.searchParams.get('end') ?? '1000')
  const workableOnly = url.searchParams.get('workable') === 'true'
  const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : undefined

  try {
    const annotations = await listAnnotations(videoId, startFrame, endFrame, workableOnly, limit)
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
 *
 * Requires annotation permission (blocks demo videos and trial tier limits).
 */
export async function action({ params, request }: ActionFunctionArgs) {
  const videoIdResult = extractVideoId(params)
  if (!videoIdResult.success) return videoIdResult.response

  const videoId = videoIdResult.value

  // Require annotation permission for write operations
  await requireAnnotatePermission(request, videoId)

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

      const result = await updateAnnotationWithOverlapResolution(videoId, input)

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

      const annotation = await createAnnotation(videoId, input)

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
    median_ocr_status: annotation.medianOcrStatus,
    median_ocr_error: annotation.medianOcrError,
    median_ocr_processed_at: annotation.medianOcrProcessedAt,
    created_at: annotation.createdAt,
  }
}
