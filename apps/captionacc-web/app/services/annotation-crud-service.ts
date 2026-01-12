/**
 * Annotation CRUD service for caption caption frame extents management.
 *
 * Provides create, read, update, delete operations for caption annotations,
 * including complex overlap resolution and gap management.
 */

import type Database from 'better-sqlite3'

import { getCaptionDb, getWritableCaptionDb, getOrCreateCaptionDb } from '~/utils/database'
import { deleteCombinedImage } from '~/utils/image-processing'
import type { AnnotationState, TextStatus } from '~/types/enums'
import { queueCaptionOcrProcessing } from './prefect'
import { getCaptionsDbPath, getVideoDir } from '~/utils/video-paths'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Database row for an annotation (snake_case from database).
 */
interface AnnotationRow {
  id: number
  start_frame_index: number
  end_frame_index: number
  caption_frame_extents_state: AnnotationState
  caption_frame_extents_pending: number
  caption_frame_extents_updated_at: string
  text: string | null
  text_pending: number
  text_status: string | null
  text_notes: string | null
  caption_ocr: string | null
  text_updated_at: string
  image_needs_regen: number
  caption_ocr_status: string
  caption_ocr_error: string | null
  caption_ocr_processed_at: string | null
  created_at: string
}

/**
 * Domain representation of an annotation (camelCase for API).
 */
export interface Annotation {
  id: number
  startFrameIndex: number
  endFrameIndex: number
  captionFrameExtentsState: AnnotationState
  captionFrameExtentsPending: boolean
  captionFrameExtentsUpdatedAt: string
  text: string | null
  textPending: boolean
  textStatus: string | null
  textNotes: string | null
  captionOcr: string | null
  textUpdatedAt: string
  imageNeedsRegen: boolean
  captionOcrStatus: string
  captionOcrError: string | null
  captionOcrProcessedAt: string | null
  createdAt: string
}

/**
 * Input for creating a new annotation.
 */
export interface CreateAnnotationInput {
  startFrameIndex: number
  endFrameIndex: number
  captionFrameExtentsState?: AnnotationState
  captionFrameExtentsPending?: boolean
  text?: string | null
}

/**
 * Input for updating an annotation with overlap resolution.
 */
export interface UpdateAnnotationInput {
  id: number
  startFrameIndex: number
  endFrameIndex: number
  captionFrameExtentsState?: AnnotationState
}

/**
 * Result of an overlap resolution operation.
 */
export interface OverlapResolutionResult {
  annotation: Annotation
  /** Annotations that were deleted due to being completely contained */
  deletedAnnotations: number[]
  /** Annotations that were modified (trimmed or split) */
  modifiedAnnotations: Annotation[]
  /** Gap annotations that were created */
  createdGaps: Annotation[]
}

/**
 * Input for updating annotation text.
 */
export interface UpdateTextInput {
  text: string
  textStatus?:
    | 'valid_caption'
    | 'ocr_error'
    | 'partial_caption'
    | 'text_unclear'
    | 'other_issue'
    | null
}

/**
 * Frame range for an annotation.
 */
export interface AnnotationFrameRange {
  startFrameIndex: number
  endFrameIndex: number
  frameCount: number
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Transform a database annotation row to a domain Annotation object.
 */
function transformAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    startFrameIndex: row.start_frame_index,
    endFrameIndex: row.end_frame_index,
    captionFrameExtentsState: row.caption_frame_extents_state,
    captionFrameExtentsPending: row.caption_frame_extents_pending === 1,
    captionFrameExtentsUpdatedAt: row.caption_frame_extents_updated_at,
    text: row.text,
    textPending: row.text_pending === 1,
    textStatus: row.text_status,
    textNotes: row.text_notes,
    captionOcr: row.caption_ocr,
    textUpdatedAt: row.text_updated_at,
    imageNeedsRegen: row.image_needs_regen === 1,
    captionOcrStatus: row.caption_ocr_status,
    captionOcrError: row.caption_ocr_error,
    captionOcrProcessedAt: row.caption_ocr_processed_at,
    createdAt: row.created_at,
  }
}

/**
 * Mark annotation's combined image as needing regeneration.
 * Deletes old image immediately, marks for async regeneration, and queues Prefect flow.
 */
async function markImageForRegeneration(
  videoId: string,
  annotationId: number,
  db: Database.Database
): Promise<void> {
  // Delete old combined image immediately
  deleteCombinedImage(videoId, annotationId)

  // Mark for async regeneration, clear OCR cache, and queue via Prefect
  db.prepare(
    `
    UPDATE captions
    SET image_needs_regen = 1,
        caption_ocr = NULL,
        text_pending = 1,
        caption_ocr_status = 'queued'
    WHERE id = ?
  `
  ).run(annotationId)

  // Queue median frame OCR processing via Prefect (async)
  const dbPath = await getCaptionsDbPath(videoId)
  const videoDir = await getVideoDir(videoId)

  if (dbPath && videoDir) {
    try {
      await queueCaptionOcrProcessing({
        videoId,
        dbPath,
        videoDir,
        captionIds: [annotationId],
      })
      console.log(`[markImageForRegeneration] Queued median OCR for annotation ${annotationId}`)
    } catch (error) {
      console.error(
        `[markImageForRegeneration] Failed to queue median OCR for annotation ${annotationId}:`,
        error
      )
      // Update status to error
      db.prepare(
        `
        UPDATE captions
        SET caption_ocr_status = 'error',
            caption_ocr_error = ?
        WHERE id = ?
      `
      ).run(error instanceof Error ? error.message : String(error), annotationId)
    }
  }
}

/**
 * Represents a modified annotation with its new frame range.
 */
interface ModifiedAnnotationInfo {
  id: number
  startFrame: number
  endFrame: number
}

/**
 * Result of splitting overlapping annotations.
 */
interface SplitResult {
  deletedIds: number[]
  modifiedAnnotations: ModifiedAnnotationInfo[]
}

/**
 * Detect annotations that overlap with a given frame range.
 *
 * @param db - Database connection
 * @param startFrameIndex - Start frame of the range to check
 * @param endFrameIndex - End frame of the range to check
 * @param excludeId - Optional annotation ID to exclude from results
 * @returns Array of overlapping annotation rows
 */
function detectOverlaps(
  db: Database.Database,
  startFrameIndex: number,
  endFrameIndex: number,
  excludeId?: number
): AnnotationRow[] {
  if (excludeId !== undefined) {
    return db
      .prepare(
        `
        SELECT * FROM captions
        WHERE id != ?
        AND NOT (end_frame_index < ? OR start_frame_index > ?)
      `
      )
      .all(excludeId, startFrameIndex, endFrameIndex) as AnnotationRow[]
  }

  return db
    .prepare(
      `
      SELECT * FROM captions
      WHERE NOT (end_frame_index < ? OR start_frame_index > ?)
    `
    )
    .all(startFrameIndex, endFrameIndex) as AnnotationRow[]
}

/**
 * Split overlapping annotations at the caption frame extents of a new annotation.
 *
 * Handles three cases:
 * - Completely contained: delete the overlapping annotation
 * - New annotation contained within existing: split into left and right parts
 * - Partial overlap: trim the overlapping annotation
 *
 * @param db - Database connection
 * @param videoId - Video identifier for image cleanup
 * @param overlaps - Array of overlapping annotations to resolve
 * @param startFrameIndex - Start frame of the new annotation
 * @param endFrameIndex - End frame of the new annotation
 * @returns IDs of deleted annotations and info about modified annotations
 */
function splitOverlappingAnnotations(
  db: Database.Database,
  videoId: string,
  overlaps: AnnotationRow[],
  startFrameIndex: number,
  endFrameIndex: number
): SplitResult {
  const deletedIds: number[] = []
  const modifiedAnnotations: ModifiedAnnotationInfo[] = []

  for (const overlap of overlaps) {
    if (overlap.start_frame_index >= startFrameIndex && overlap.end_frame_index <= endFrameIndex) {
      // Completely contained - delete it and its combined image
      deleteCombinedImage(videoId, overlap.id)
      db.prepare('DELETE FROM captions WHERE id = ?').run(overlap.id)
      deletedIds.push(overlap.id)
    } else if (
      overlap.start_frame_index < startFrameIndex &&
      overlap.end_frame_index > endFrameIndex
    ) {
      // New annotation is contained within existing - split the existing
      // Keep the left part, set to pending
      db.prepare(
        `
        UPDATE captions
        SET end_frame_index = ?, caption_frame_extents_pending = 1
        WHERE id = ?
      `
      ).run(startFrameIndex - 1, overlap.id)
      modifiedAnnotations.push({
        id: overlap.id,
        startFrame: overlap.start_frame_index,
        endFrame: startFrameIndex - 1,
      })

      // Create right part as pending
      const rightResult = db
        .prepare(
          `
          INSERT INTO captions (start_frame_index, end_frame_index, caption_frame_extents_state, caption_frame_extents_pending, text)
          VALUES (?, ?, ?, 1, ?)
        `
        )
        .run(
          endFrameIndex + 1,
          overlap.end_frame_index,
          overlap.caption_frame_extents_state,
          overlap.text
        )
      modifiedAnnotations.push({
        id: rightResult.lastInsertRowid as number,
        startFrame: endFrameIndex + 1,
        endFrame: overlap.end_frame_index,
      })
    } else if (overlap.start_frame_index < startFrameIndex) {
      // Overlaps on the left - trim it
      db.prepare(
        `
        UPDATE captions
        SET end_frame_index = ?, caption_frame_extents_pending = 1
        WHERE id = ?
      `
      ).run(startFrameIndex - 1, overlap.id)
      modifiedAnnotations.push({
        id: overlap.id,
        startFrame: overlap.start_frame_index,
        endFrame: startFrameIndex - 1,
      })
    } else {
      // Overlaps on the right - trim it
      db.prepare(
        `
        UPDATE captions
        SET start_frame_index = ?, caption_frame_extents_pending = 1
        WHERE id = ?
      `
      ).run(endFrameIndex + 1, overlap.id)
      modifiedAnnotations.push({
        id: overlap.id,
        startFrame: endFrameIndex + 1,
        endFrame: overlap.end_frame_index,
      })
    }
  }

  return { deletedIds, modifiedAnnotations }
}

/**
 * Create gap annotations to fill uncovered ranges when an annotation shrinks.
 *
 * @param db - Database connection
 * @param original - Original annotation before update
 * @param startFrameIndex - New start frame
 * @param endFrameIndex - New end frame
 * @returns Array of created gap annotation rows
 */
function createGapAnnotations(
  db: Database.Database,
  original: AnnotationRow,
  startFrameIndex: number,
  endFrameIndex: number
): AnnotationRow[] {
  const createdGaps: AnnotationRow[] = []

  if (startFrameIndex > original.start_frame_index) {
    const gap = createOrMergeGap(db, original.start_frame_index, startFrameIndex - 1)
    if (gap) createdGaps.push(gap)
  }

  if (endFrameIndex < original.end_frame_index) {
    const gap = createOrMergeGap(db, endFrameIndex + 1, original.end_frame_index)
    if (gap) createdGaps.push(gap)
  }

  return createdGaps
}

/**
 * Mark combined images for async regeneration for a list of annotations.
 * Queues Prefect flows for each annotation.
 *
 * @param videoId - Video identifier
 * @param annotations - Array of annotation info with frame ranges
 * @param db - Database connection
 */
async function markAnnotationImagesForRegeneration(
  videoId: string,
  annotations: ModifiedAnnotationInfo[],
  db: Database.Database
): Promise<void> {
  for (const ann of annotations) {
    await markImageForRegeneration(videoId, ann.id, db)
  }
}

/**
 * Fetch annotations by their IDs and transform to domain objects.
 *
 * @param db - Database connection
 * @param ids - Array of annotation IDs to fetch
 * @returns Array of transformed Annotation objects
 */
function fetchAnnotationsByIds(db: Database.Database, ids: Array<{ id: number }>): Annotation[] {
  const results: Annotation[] = []
  for (const item of ids) {
    const ann = db.prepare('SELECT * FROM captions WHERE id = ?').get(item.id) as
      | AnnotationRow
      | undefined
    if (ann) {
      results.push(transformAnnotation(ann))
    }
  }
  return results
}

/**
 * Create or merge a gap annotation.
 *
 * Finds adjacent gap annotations and merges them with the new gap
 * to prevent fragmentation.
 */
function createOrMergeGap(
  db: Database.Database,
  gapStart: number,
  gapEnd: number
): AnnotationRow | null {
  // Find adjacent gap annotations
  const adjacentGaps = db
    .prepare(
      `
      SELECT * FROM captions
      WHERE caption_frame_extents_state = 'gap'
      AND (
        end_frame_index = ? - 1
        OR start_frame_index = ? + 1
      )
      ORDER BY start_frame_index
    `
    )
    .all(gapStart, gapEnd) as AnnotationRow[]

  // Calculate merged gap range
  let mergedStart = gapStart
  let mergedEnd = gapEnd
  const gapIdsToDelete: number[] = []

  for (const gap of adjacentGaps) {
    if (gap.end_frame_index === gapStart - 1) {
      // Gap is immediately before
      mergedStart = gap.start_frame_index
      gapIdsToDelete.push(gap.id)
    } else if (gap.start_frame_index === gapEnd + 1) {
      // Gap is immediately after
      mergedEnd = gap.end_frame_index
      gapIdsToDelete.push(gap.id)
    }
  }

  // Delete adjacent gaps that will be merged
  for (const gapId of gapIdsToDelete) {
    db.prepare('DELETE FROM captions WHERE id = ?').run(gapId)
  }

  // Create merged gap annotation
  const result = db
    .prepare(
      `
      INSERT INTO captions (start_frame_index, end_frame_index, caption_frame_extents_state, caption_frame_extents_pending)
      VALUES (?, ?, 'gap', 0)
    `
    )
    .run(mergedStart, mergedEnd)

  // Return the created gap
  return (
    (db.prepare('SELECT * FROM captions WHERE id = ?').get(result.lastInsertRowid) as
      | AnnotationRow
      | undefined) ?? null
  )
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * List annotations in a frame range.
 *
 * @param videoId - Video identifier
 * @param startFrame - Start frame index
 * @param endFrame - End frame index
 * @returns Array of annotations overlapping the frame range
 * @throws Error if database is not found
 */
export async function listAnnotations(
  videoId: string,
  startFrame: number,
  endFrame: number,
  workableOnly: boolean = false,
  limit?: number
): Promise<Annotation[]> {
  const result = await getOrCreateCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Build query based on workableOnly filter and limit
    const baseQuery = workableOnly
      ? `
        SELECT * FROM captions
        WHERE end_frame_index >= ? AND start_frame_index <= ?
        AND (caption_frame_extents_state = 'gap' OR caption_frame_extents_pending = 1)
        ORDER BY start_frame_index
      `
      : `
        SELECT * FROM captions
        WHERE end_frame_index >= ? AND start_frame_index <= ?
        ORDER BY start_frame_index
      `

    const query = limit ? `${baseQuery} LIMIT ${limit}` : baseQuery

    const annotations = db.prepare(query).all(startFrame, endFrame) as AnnotationRow[]

    return annotations.map(transformAnnotation)
  } finally {
    db.close()
  }
}

/**
 * Get a single annotation by ID.
 *
 * @param videoId - Video identifier
 * @param annotationId - Annotation ID
 * @returns The annotation, or null if not found
 * @throws Error if database is not found
 */
export async function getAnnotation(
  videoId: string,
  annotationId: number
): Promise<Annotation | null> {
  const result = await getCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    const annotation = db.prepare('SELECT * FROM captions WHERE id = ?').get(annotationId) as
      | AnnotationRow
      | undefined

    return annotation ? transformAnnotation(annotation) : null
  } finally {
    db.close()
  }
}

/**
 * Create a new annotation without overlap resolution.
 *
 * Use this when you're certain there are no overlapping annotations,
 * or for creating gap annotations that don't need overlap handling.
 *
 * Queues median OCR processing via Prefect for non-gap, non-pending annotations.
 *
 * @param videoId - Video identifier
 * @param input - Annotation creation input
 * @returns The created annotation
 * @throws Error if database is not found
 */
export async function createAnnotation(
  videoId: string,
  input: CreateAnnotationInput
): Promise<Annotation> {
  const result = await getOrCreateCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // For non-gap, non-pending annotations, mark for image generation
    const isPending = input.captionFrameExtentsPending ?? false
    const isGap = input.captionFrameExtentsState === 'gap'
    const needsImageRegen = !isGap && !isPending ? 1 : 0

    const insertResult = db
      .prepare(
        `
        INSERT INTO captions (start_frame_index, end_frame_index, caption_frame_extents_state, caption_frame_extents_pending, text, image_needs_regen)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        input.startFrameIndex,
        input.endFrameIndex,
        input.captionFrameExtentsState ?? 'predicted',
        input.captionFrameExtentsPending ? 1 : 0,
        input.text ?? null,
        needsImageRegen
      )

    const annotationId = insertResult.lastInsertRowid as number

    // Queue median OCR processing for non-gap, non-pending annotations via Prefect
    // image_needs_regen flag is already set in INSERT above
    if (!isGap && !isPending) {
      // Update caption_ocr_status to queued
      db.prepare(
        `
        UPDATE captions
        SET caption_ocr_status = 'queued'
        WHERE id = ?
      `
      ).run(annotationId)

      // Queue median frame OCR processing via Prefect (async)
      const dbPath = await getCaptionsDbPath(videoId)
      const videoDir = await getVideoDir(videoId)

      if (dbPath && videoDir) {
        try {
          await queueCaptionOcrProcessing({
            videoId,
            dbPath,
            videoDir,
            captionIds: [annotationId],
          })
          console.log(`[createAnnotation] Queued median OCR for annotation ${annotationId}`)
        } catch (error) {
          console.error(
            `[createAnnotation] Failed to queue median OCR for annotation ${annotationId}:`,
            error
          )
          // Update status to error
          db.prepare(
            `
            UPDATE captions
            SET caption_ocr_status = 'error',
                caption_ocr_error = ?
            WHERE id = ?
          `
          ).run(error instanceof Error ? error.message : String(error), annotationId)
        }
      }
    }

    const annotation = db.prepare('SELECT * FROM captions WHERE id = ?').get(annotationId) as
      | AnnotationRow
      | undefined

    if (!annotation) {
      throw new Error('Failed to retrieve created annotation')
    }

    return transformAnnotation(annotation)
  } finally {
    db.close()
  }
}

/**
 * Update an annotation with automatic overlap resolution.
 *
 * When updating caption frame extents, this function:
 * 1. Deletes annotations completely contained within the new range
 * 2. Trims or splits overlapping annotations
 * 3. Creates gap annotations for uncovered ranges when shrinking
 * 4. Marks images for async regeneration and queues Prefect flows
 *
 * @param videoId - Video identifier
 * @param input - Update input with new caption frame extents
 * @returns Overlap resolution result with all affected annotations
 * @throws Error if database or annotation is not found
 */
export async function updateAnnotationWithOverlapResolution(
  videoId: string,
  input: UpdateAnnotationInput
): Promise<OverlapResolutionResult> {
  const result = await getWritableCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    const { id, startFrameIndex, endFrameIndex, captionFrameExtentsState } = input

    // Get the original annotation
    const original = db.prepare('SELECT * FROM captions WHERE id = ?').get(id) as
      | AnnotationRow
      | undefined

    if (!original) {
      throw new Error('Annotation not found')
    }

    // Detect and resolve overlaps
    const overlapping = detectOverlaps(db, startFrameIndex, endFrameIndex, id)
    const { deletedIds, modifiedAnnotations } = splitOverlappingAnnotations(
      db,
      videoId,
      overlapping,
      startFrameIndex,
      endFrameIndex
    )

    // Mark combined images for async regeneration (all modified overlapping annotations)
    await markAnnotationImagesForRegeneration(videoId, modifiedAnnotations, db)

    // Create gap annotations for uncovered ranges when annotation shrinks
    const createdGaps = createGapAnnotations(db, original, startFrameIndex, endFrameIndex)

    // Check if caption frame extents changed
    const captionFrameExtentsChanged =
      startFrameIndex !== original.start_frame_index || endFrameIndex !== original.end_frame_index

    // Update the annotation and mark as confirmed
    db.prepare(
      `
      UPDATE captions
      SET start_frame_index = ?,
          end_frame_index = ?,
          caption_frame_extents_state = ?,
          caption_frame_extents_pending = 0,
          image_needs_regen = ?,
          caption_frame_extents_updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(
      startFrameIndex,
      endFrameIndex,
      captionFrameExtentsState ?? 'confirmed',
      captionFrameExtentsChanged ? 1 : 0,
      id
    )

    // Delete old combined image if caption frame extents changed
    if (captionFrameExtentsChanged) {
      deleteCombinedImage(videoId, id)
    }

    // Get updated annotation
    const updatedAnnotation = db.prepare('SELECT * FROM captions WHERE id = ?').get(id) as
      | AnnotationRow
      | undefined

    if (!updatedAnnotation) {
      throw new Error('Failed to retrieve updated annotation')
    }

    console.log(`[updateAnnotationWithOverlapResolution] Updated annotation ${id}:`, {
      id: updatedAnnotation.id,
      caption_frame_extents_state: updatedAnnotation.caption_frame_extents_state,
      caption_frame_extents_updated_at: updatedAnnotation.caption_frame_extents_updated_at,
      original_state: original.caption_frame_extents_state,
      original_updated_at: original.caption_frame_extents_updated_at,
    })

    return {
      annotation: transformAnnotation(updatedAnnotation),
      deletedAnnotations: deletedIds,
      modifiedAnnotations: fetchAnnotationsByIds(db, modifiedAnnotations),
      createdGaps: createdGaps.map(transformAnnotation),
    }
  } finally {
    db.close()
  }
}

/**
 * Delete an annotation.
 *
 * @param videoId - Video identifier
 * @param annotationId - Annotation ID to delete
 * @returns True if deleted, false if not found
 * @throws Error if database is not found
 */
export async function deleteAnnotation(videoId: string, annotationId: number): Promise<boolean> {
  const result = await getWritableCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Delete combined image first
    deleteCombinedImage(videoId, annotationId)

    const deleteResult = db.prepare('DELETE FROM captions WHERE id = ?').run(annotationId)

    return deleteResult.changes > 0
  } finally {
    db.close()
  }
}

/**
 * Clear all annotations for a video.
 *
 * @param videoId - Video identifier
 * @returns Number of annotations deleted
 * @throws Error if database is not found
 */
export async function clearAllAnnotations(videoId: string): Promise<number> {
  const result = await getWritableCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Get all annotation IDs first to delete their combined images
    const annotations = db.prepare('SELECT id FROM captions').all() as Array<{ id: number }>

    for (const ann of annotations) {
      deleteCombinedImage(videoId, ann.id)
    }

    const deleteResult = db.prepare('DELETE FROM captions').run()

    return deleteResult.changes
  } finally {
    db.close()
  }
}

/**
 * Get the frame range for an annotation.
 *
 * @param videoId - Video identifier
 * @param annotationId - Annotation ID
 * @returns Frame range information, or null if not found
 * @throws Error if database is not found
 */
export async function getAnnotationFrames(
  videoId: string,
  annotationId: number
): Promise<AnnotationFrameRange | null> {
  const result = await getCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    const annotation = db
      .prepare('SELECT start_frame_index, end_frame_index FROM captions WHERE id = ?')
      .get(annotationId) as { start_frame_index: number; end_frame_index: number } | undefined

    if (!annotation) {
      return null
    }

    return {
      startFrameIndex: annotation.start_frame_index,
      endFrameIndex: annotation.end_frame_index,
      frameCount: annotation.end_frame_index - annotation.start_frame_index + 1,
    }
  } finally {
    db.close()
  }
}

/**
 * Update annotation text and status.
 *
 * @param videoId - Video identifier
 * @param annotationId - Annotation ID
 * @param input - Text update input
 * @returns The updated annotation
 * @throws Error if database or annotation is not found
 */
export async function updateAnnotationText(
  videoId: string,
  annotationId: number,
  input: UpdateTextInput
): Promise<Annotation> {
  const result = await getWritableCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Update text and status
    db.prepare(
      `
      UPDATE captions
      SET text = ?,
          text_status = ?,
          text_pending = 0,
          text_updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(input.text, input.textStatus ?? null, annotationId)

    const annotation = db.prepare('SELECT * FROM captions WHERE id = ?').get(annotationId) as
      | AnnotationRow
      | undefined

    if (!annotation) {
      throw new Error('Annotation not found after update')
    }

    return transformAnnotation(annotation)
  } finally {
    db.close()
  }
}

/**
 * Mark an annotation's text as pending review.
 *
 * @param videoId - Video identifier
 * @param annotationId - Annotation ID
 * @returns The updated annotation
 * @throws Error if database or annotation is not found
 */
export async function markTextPending(videoId: string, annotationId: number): Promise<Annotation> {
  const result = await getWritableCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    db.prepare(
      `
      UPDATE captions
      SET text_pending = 1
      WHERE id = ?
    `
    ).run(annotationId)

    const annotation = db.prepare('SELECT * FROM captions WHERE id = ?').get(annotationId) as
      | AnnotationRow
      | undefined

    if (!annotation) {
      throw new Error('Annotation not found after update')
    }

    return transformAnnotation(annotation)
  } finally {
    db.close()
  }
}

/**
 * Get the next annotation that needs text review.
 *
 * @param videoId - Video identifier
 * @param afterId - Optional ID to start searching after
 * @returns The next text-pending annotation, or null if none found
 * @throws Error if database is not found
 */
export async function getNextTextPendingAnnotation(
  videoId: string,
  afterId?: number
): Promise<Annotation | null> {
  const result = await getCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    let annotation: AnnotationRow | undefined

    if (afterId !== undefined) {
      const current = db
        .prepare('SELECT start_frame_index FROM captions WHERE id = ?')
        .get(afterId) as { start_frame_index: number } | undefined

      if (current) {
        annotation = db
          .prepare(
            `
            SELECT * FROM captions
            WHERE text_pending = 1
            AND caption_frame_extents_state IN ('predicted', 'confirmed')
            AND (start_frame_index > ? OR (start_frame_index = ? AND id > ?))
            ORDER BY start_frame_index ASC, id ASC
            LIMIT 1
          `
          )
          .get(current.start_frame_index, current.start_frame_index, afterId) as
          | AnnotationRow
          | undefined

        // Wrap around if not found
        annotation ??= db
          .prepare(
            `
            SELECT * FROM captions
            WHERE text_pending = 1
            AND caption_frame_extents_state IN ('predicted', 'confirmed')
            ORDER BY start_frame_index ASC, id ASC
            LIMIT 1
          `
          )
          .get() as AnnotationRow | undefined
      }
    } else {
      annotation = db
        .prepare(
          `
          SELECT * FROM captions
          WHERE text_pending = 1
          AND caption_frame_extents_state IN ('predicted', 'confirmed')
          ORDER BY start_frame_index ASC, id ASC
          LIMIT 1
        `
        )
        .get() as AnnotationRow | undefined
    }

    return annotation ? transformAnnotation(annotation) : null
  } finally {
    db.close()
  }
}
