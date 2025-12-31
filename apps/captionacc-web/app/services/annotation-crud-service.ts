/**
 * Annotation CRUD service for caption boundary management.
 *
 * Provides create, read, update, delete operations for caption annotations,
 * including complex overlap resolution and gap management.
 */

import type Database from 'better-sqlite3'

import {
  getAnnotationDatabase,
  getWritableDatabase,
  getOrCreateAnnotationDatabase,
} from '~/utils/database'
import { deleteCombinedImage, getOrGenerateCombinedImage } from '~/utils/image-processing'

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
  boundary_state: 'predicted' | 'confirmed' | 'gap'
  boundary_pending: number
  boundary_updated_at: string
  text: string | null
  text_pending: number
  text_status: string | null
  text_notes: string | null
  text_ocr_combined: string | null
  text_updated_at: string
  created_at: string
}

/**
 * Domain representation of an annotation (camelCase for API).
 */
export interface Annotation {
  id: number
  startFrameIndex: number
  endFrameIndex: number
  boundaryState: 'predicted' | 'confirmed' | 'gap'
  boundaryPending: boolean
  boundaryUpdatedAt: string
  text: string | null
  textPending: boolean
  textStatus: string | null
  textNotes: string | null
  textOcrCombined: string | null
  textUpdatedAt: string
  createdAt: string
}

/**
 * Input for creating a new annotation.
 */
export interface CreateAnnotationInput {
  startFrameIndex: number
  endFrameIndex: number
  boundaryState?: 'predicted' | 'confirmed' | 'gap'
  boundaryPending?: boolean
  text?: string | null
}

/**
 * Input for updating an annotation with overlap resolution.
 */
export interface UpdateAnnotationInput {
  id: number
  startFrameIndex: number
  endFrameIndex: number
  boundaryState?: 'predicted' | 'confirmed' | 'gap'
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
    boundaryState: row.boundary_state,
    boundaryPending: row.boundary_pending === 1,
    boundaryUpdatedAt: row.boundary_updated_at,
    text: row.text,
    textPending: row.text_pending === 1,
    textStatus: row.text_status,
    textNotes: row.text_notes,
    textOcrCombined: row.text_ocr_combined,
    textUpdatedAt: row.text_updated_at,
    createdAt: row.created_at,
  }
}

/**
 * Regenerate combined image when annotation boundaries change.
 * Deletes old image, generates new one, and clears OCR cache.
 */
async function regenerateCombinedImageForAnnotation(
  videoId: string,
  annotationId: number,
  startFrame: number,
  endFrame: number,
  db: Database.Database
): Promise<void> {
  // Delete old combined image
  deleteCombinedImage(videoId, annotationId)

  // Generate new combined image immediately (for ML training)
  await getOrGenerateCombinedImage(videoId, annotationId, startFrame, endFrame)

  // Clear OCR cache and mark text as pending
  db.prepare(
    `
    UPDATE captions
    SET text_ocr_combined = NULL,
        text_pending = 1
    WHERE id = ?
  `
  ).run(annotationId)
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
      WHERE boundary_state = 'gap'
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
      INSERT INTO captions (start_frame_index, end_frame_index, boundary_state, boundary_pending)
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
export function listAnnotations(
  videoId: string,
  startFrame: number,
  endFrame: number
): Annotation[] {
  const result = getOrCreateAnnotationDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Query annotations that overlap with the requested range
    const annotations = db
      .prepare(
        `
        SELECT * FROM captions
        WHERE end_frame_index >= ? AND start_frame_index <= ?
        ORDER BY start_frame_index
      `
      )
      .all(startFrame, endFrame) as AnnotationRow[]

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
export function getAnnotation(videoId: string, annotationId: number): Annotation | null {
  const result = getAnnotationDatabase(videoId)
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
 * @param videoId - Video identifier
 * @param input - Annotation creation input
 * @returns The created annotation
 * @throws Error if database is not found
 */
export async function createAnnotation(
  videoId: string,
  input: CreateAnnotationInput
): Promise<Annotation> {
  const result = getOrCreateAnnotationDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    const insertResult = db
      .prepare(
        `
        INSERT INTO captions (start_frame_index, end_frame_index, boundary_state, boundary_pending, text)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run(
        input.startFrameIndex,
        input.endFrameIndex,
        input.boundaryState ?? 'predicted',
        input.boundaryPending ? 1 : 0,
        input.text ?? null
      )

    const annotationId = insertResult.lastInsertRowid as number

    // Generate combined image for non-gap, non-pending annotations
    const isPending = input.boundaryPending ?? false
    const isGap = input.boundaryState === 'gap'
    if (!isGap && !isPending) {
      await getOrGenerateCombinedImage(
        videoId,
        annotationId,
        input.startFrameIndex,
        input.endFrameIndex
      )
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
 * When updating boundaries, this function:
 * 1. Deletes annotations completely contained within the new range
 * 2. Trims or splits overlapping annotations
 * 3. Creates gap annotations for uncovered ranges when shrinking
 * 4. Regenerates combined images as needed
 *
 * @param videoId - Video identifier
 * @param input - Update input with new boundaries
 * @returns Overlap resolution result with all affected annotations
 * @throws Error if database or annotation is not found
 */
export async function updateAnnotationWithOverlapResolution(
  videoId: string,
  input: UpdateAnnotationInput
): Promise<OverlapResolutionResult> {
  const result = getWritableDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    const { id, startFrameIndex, endFrameIndex, boundaryState } = input

    // Get the original annotation
    const original = db.prepare('SELECT * FROM captions WHERE id = ?').get(id) as
      | AnnotationRow
      | undefined

    if (!original) {
      throw new Error('Annotation not found')
    }

    // Find overlapping annotations (excluding the one being updated)
    const overlapping = db
      .prepare(
        `
        SELECT * FROM captions
        WHERE id != ?
        AND NOT (end_frame_index < ? OR start_frame_index > ?)
      `
      )
      .all(id, startFrameIndex, endFrameIndex) as AnnotationRow[]

    // Track results
    const deletedAnnotations: number[] = []
    const modifiedAnnotations: Array<{ id: number; startFrame: number; endFrame: number }> = []
    const createdGaps: AnnotationRow[] = []

    // Resolve overlaps
    for (const overlap of overlapping) {
      if (
        overlap.start_frame_index >= startFrameIndex &&
        overlap.end_frame_index <= endFrameIndex
      ) {
        // Completely contained - delete it and its combined image
        deleteCombinedImage(videoId, overlap.id)
        db.prepare('DELETE FROM captions WHERE id = ?').run(overlap.id)
        deletedAnnotations.push(overlap.id)
      } else if (
        overlap.start_frame_index < startFrameIndex &&
        overlap.end_frame_index > endFrameIndex
      ) {
        // New annotation is contained within existing - split the existing
        // Keep the left part, set to pending
        db.prepare(
          `
          UPDATE captions
          SET end_frame_index = ?, boundary_pending = 1
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
            INSERT INTO captions (start_frame_index, end_frame_index, boundary_state, boundary_pending, text)
            VALUES (?, ?, ?, 1, ?)
          `
          )
          .run(endFrameIndex + 1, overlap.end_frame_index, overlap.boundary_state, overlap.text)
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
          SET end_frame_index = ?, boundary_pending = 1
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
          SET start_frame_index = ?, boundary_pending = 1
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

    // Regenerate combined images for all modified overlapping annotations
    for (const modified of modifiedAnnotations) {
      await regenerateCombinedImageForAnnotation(
        videoId,
        modified.id,
        modified.startFrame,
        modified.endFrame,
        db
      )
    }

    // Create gap annotations for uncovered ranges when annotation is reduced
    if (startFrameIndex > original.start_frame_index) {
      const gap = createOrMergeGap(db, original.start_frame_index, startFrameIndex - 1)
      if (gap) createdGaps.push(gap)
    }

    if (endFrameIndex < original.end_frame_index) {
      const gap = createOrMergeGap(db, endFrameIndex + 1, original.end_frame_index)
      if (gap) createdGaps.push(gap)
    }

    // Update the annotation and mark as confirmed
    db.prepare(
      `
      UPDATE captions
      SET start_frame_index = ?,
          end_frame_index = ?,
          boundary_state = ?,
          boundary_pending = 0
      WHERE id = ?
    `
    ).run(startFrameIndex, endFrameIndex, boundaryState ?? 'confirmed', id)

    // Regenerate combined image if boundaries changed
    if (
      startFrameIndex !== original.start_frame_index ||
      endFrameIndex !== original.end_frame_index
    ) {
      await regenerateCombinedImageForAnnotation(videoId, id, startFrameIndex, endFrameIndex, db)
    }

    // Get updated annotation
    const updatedAnnotation = db.prepare('SELECT * FROM captions WHERE id = ?').get(id) as
      | AnnotationRow
      | undefined

    if (!updatedAnnotation) {
      throw new Error('Failed to retrieve updated annotation')
    }

    // Get all modified annotations for return
    const modifiedResults: Annotation[] = []
    for (const modified of modifiedAnnotations) {
      const ann = db.prepare('SELECT * FROM captions WHERE id = ?').get(modified.id) as
        | AnnotationRow
        | undefined
      if (ann) {
        modifiedResults.push(transformAnnotation(ann))
      }
    }

    return {
      annotation: transformAnnotation(updatedAnnotation),
      deletedAnnotations,
      modifiedAnnotations: modifiedResults,
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
export function deleteAnnotation(videoId: string, annotationId: number): boolean {
  const result = getWritableDatabase(videoId)
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
export function clearAllAnnotations(videoId: string): number {
  const result = getWritableDatabase(videoId)
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
export function getAnnotationFrames(
  videoId: string,
  annotationId: number
): AnnotationFrameRange | null {
  const result = getAnnotationDatabase(videoId)
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
export function updateAnnotationText(
  videoId: string,
  annotationId: number,
  input: UpdateTextInput
): Annotation {
  const result = getWritableDatabase(videoId)
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
export function markTextPending(videoId: string, annotationId: number): Annotation {
  const result = getWritableDatabase(videoId)
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
export function getNextTextPendingAnnotation(videoId: string, afterId?: number): Annotation | null {
  const result = getAnnotationDatabase(videoId)
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
            AND boundary_state IN ('predicted', 'confirmed')
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
            AND boundary_state IN ('predicted', 'confirmed')
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
          AND boundary_state IN ('predicted', 'confirmed')
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
