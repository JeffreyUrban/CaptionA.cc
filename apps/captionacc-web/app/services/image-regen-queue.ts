/**
 * Async image regeneration queue service
 *
 * Handles background regeneration of combined images for annotations
 * marked with image_needs_regen flag.
 *
 * Design:
 * - Processes annotations one at a time to avoid overwhelming the system
 * - Can be triggered manually or run periodically
 * - Prioritizes annotations by frame index (earliest first)
 */

import { listAnnotations } from '~/services/annotation-crud-service'
import { getWritableCaptionDb } from '~/utils/database'
import { getOrGenerateCombinedImage } from '~/utils/image-processing'

/**
 * Process a single annotation's image regeneration.
 *
 * @param videoId - Video identifier
 * @param annotationId - Annotation ID to regenerate
 * @returns True if successful, false otherwise
 */
export async function regenerateAnnotationImage(
  videoId: string,
  annotationId: number
): Promise<boolean> {
  const result = await getWritableCaptionDb(videoId)
  if (!result.success) {
    console.error(`[ImageRegenQueue] Database not found for video: ${videoId}`)
    return false
  }

  const db = result.db

  try {
    // Get annotation details
    const annotation = db
      .prepare(
        'SELECT start_frame_index, end_frame_index, image_needs_regen FROM captions WHERE id = ?'
      )
      .get(annotationId) as
      | { start_frame_index: number; end_frame_index: number; image_needs_regen: number }
      | undefined

    if (!annotation) {
      console.error(`[ImageRegenQueue] Annotation ${annotationId} not found`)
      return false
    }

    if (annotation.image_needs_regen === 0) {
      console.log(`[ImageRegenQueue] Annotation ${annotationId} does not need regeneration`)
      return true // Already processed
    }

    console.log(
      `[ImageRegenQueue] Regenerating image for annotation ${annotationId} (frames ${annotation.start_frame_index}-${annotation.end_frame_index})`
    )

    // Generate combined image
    await getOrGenerateCombinedImage(
      videoId,
      annotationId,
      annotation.start_frame_index,
      annotation.end_frame_index
    )

    // Mark as regenerated
    db.prepare('UPDATE captions SET image_needs_regen = 0 WHERE id = ?').run(annotationId)

    console.log(`[ImageRegenQueue] Successfully regenerated image for annotation ${annotationId}`)
    return true
  } catch (error) {
    console.error(`[ImageRegenQueue] Failed to regenerate annotation ${annotationId}:`, error)
    return false
  } finally {
    db.close()
  }
}

/**
 * Process all pending image regenerations for a video.
 *
 * @param videoId - Video identifier
 * @param maxBatch - Maximum number of annotations to process (default: 10)
 * @returns Number of images successfully regenerated
 */
export async function processPendingRegenerations(
  videoId: string,
  maxBatch: number = 10
): Promise<number> {
  try {
    // Get all annotations needing regeneration
    const annotations = await listAnnotations(videoId, 0, 999999, false, undefined)

    const needingRegen = annotations
      .filter(ann => ann.imageNeedsRegen)
      .sort((a, b) => a.startFrameIndex - b.startFrameIndex) // Process earliest frames first
      .slice(0, maxBatch)

    if (needingRegen.length === 0) {
      console.log(`[ImageRegenQueue] No pending regenerations for video ${videoId}`)
      return 0
    }

    console.log(
      `[ImageRegenQueue] Processing ${needingRegen.length} pending regenerations for video ${videoId}`
    )

    let successCount = 0
    for (const annotation of needingRegen) {
      const success = await regenerateAnnotationImage(videoId, annotation.id)
      if (success) {
        successCount++
      }
    }

    console.log(
      `[ImageRegenQueue] Completed ${successCount}/${needingRegen.length} regenerations for video ${videoId}`
    )
    return successCount
  } catch (error) {
    console.error(`[ImageRegenQueue] Error processing pending regenerations:`, error)
    return 0
  }
}

/**
 * Get count of pending regenerations for a video.
 *
 * @param videoId - Video identifier
 * @returns Number of annotations needing regeneration
 */
export async function getPendingRegenerationCount(videoId: string): Promise<number> {
  const result = await getWritableCaptionDb(videoId)
  if (!result.success) {
    return 0
  }

  const db = result.db

  try {
    const row = db
      .prepare('SELECT COUNT(*) as count FROM captions WHERE image_needs_regen = 1')
      .get() as { count: number } | undefined

    return row?.count ?? 0
  } finally {
    db.close()
  }
}
