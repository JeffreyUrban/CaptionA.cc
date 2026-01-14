/**
 * Navigation service for annotation workflow.
 *
 * Provides navigation between annotations and progress tracking functionality.
 * This is a low-complexity service focused on annotation navigation operations.
 */

import { getAnnotationDatabase, getWritableDatabase } from '~/utils/database'

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
 * Result of a navigation operation.
 */
export interface NavigationResult {
  /** The annotation navigated to, or null if no annotation exists in that direction */
  annotation: Annotation | null
}

/**
 * Progress statistics for a video's annotations.
 */
export interface ProgressStats {
  /** Total number of annotations */
  total: number
  /** Number of confirmed annotations */
  confirmed: number
  /** Number of pending annotations */
  pending: number
  /** Number of gap annotations */
  gaps: number
  /** Completion percentage (0-100) */
  completionPercentage: number
}

/**
 * Direction for navigation.
 */
export type NavigationDirection = 'prev' | 'next'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Transform a database annotation row to a domain Annotation object.
 *
 * @param row - Database row with snake_case fields
 * @returns Domain object with camelCase fields
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

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Navigate to the previous or next annotation.
 *
 * Navigation is based on boundary_updated_at timestamp, allowing users to review
 * annotations in the order they were last modified. Only non-gap annotations
 * (predicted or confirmed) are included in navigation.
 *
 * @param videoId - Video identifier
 * @param currentId - ID of the current annotation
 * @param direction - Navigation direction ('prev' or 'next')
 * @returns Navigation result with the target annotation or null
 * @throws Error if database or current annotation is not found
 */
export async function navigateAnnotation(
  videoId: string,
  currentId: number,
  direction: NavigationDirection
): Promise<NavigationResult> {
  const result = await getAnnotationDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Get current annotation with full details (including gaps)
    const current = db.prepare('SELECT * FROM captions WHERE id = ?').get(currentId) as
      | AnnotationRow
      | undefined

    if (!current) {
      console.error(`[navigateAnnotation] Current annotation ${currentId} not found in database`)
      throw new Error('Current annotation not found')
    }

    console.log(`[navigateAnnotation] Current annotation:`, {
      id: current.id,
      start_frame_index: current.start_frame_index,
      end_frame_index: current.end_frame_index,
      boundary_updated_at: current.boundary_updated_at,
      boundary_state: current.boundary_state,
    })

    // Get nearby annotations for context (include all states for debugging)
    const nearby = db
      .prepare(
        `
        SELECT id, start_frame_index, end_frame_index, boundary_updated_at, boundary_state
        FROM captions
        ORDER BY boundary_updated_at DESC
        LIMIT 15
      `
      )
      .all() as Array<{
      id: number
      start_frame_index: number
      end_frame_index: number
      boundary_updated_at: string
      boundary_state: string
    }>

    console.log(
      `[navigateAnnotation] Recent annotations (ordered by boundary_updated_at DESC):`,
      nearby
    )

    let annotation: AnnotationRow | undefined

    if (direction === 'prev') {
      if (current.boundary_state === 'gap') {
        // For gaps, use current time as reference to find most recently-completed annotation
        // This supports the standard workflow: load gap → Prev → most recent completed work
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
        annotation = db
          .prepare(
            `
            SELECT * FROM captions
            WHERE boundary_updated_at < ?
            AND boundary_state IN ('predicted', 'confirmed')
            ORDER BY boundary_updated_at DESC, id DESC
            LIMIT 1
          `
          )
          .get(now) as AnnotationRow | undefined
      } else {
        // For confirmed/predicted annotations, navigate by timestamp (review order)
        annotation = db
          .prepare(
            `
            SELECT * FROM captions
            WHERE (boundary_updated_at < ? OR (boundary_updated_at = ? AND id < ?))
            AND boundary_state IN ('predicted', 'confirmed')
            ORDER BY boundary_updated_at DESC, id DESC
            LIMIT 1
          `
          )
          .get(current.boundary_updated_at, current.boundary_updated_at, currentId) as
          | AnnotationRow
          | undefined
      }

      console.log(
        `[navigateAnnotation] Prev query selected:`,
        annotation
          ? {
              id: annotation.id,
              start_frame_index: annotation.start_frame_index,
              end_frame_index: annotation.end_frame_index,
              boundary_updated_at: annotation.boundary_updated_at,
            }
          : null
      )
    } else {
      // Get next annotation (later boundary_updated_at, or same with higher id)
      // For gaps, use current time; for confirmed, use actual timestamp
      const referenceTimestamp =
        current.boundary_state === 'gap'
          ? new Date().toISOString().replace('T', ' ').slice(0, 19)
          : current.boundary_updated_at

      // First try confirmed/predicted annotations with later timestamps
      annotation = db
        .prepare(
          `
          SELECT * FROM captions
          WHERE (boundary_updated_at > ? OR (boundary_updated_at = ? AND id > ?))
          AND boundary_state IN ('predicted', 'confirmed')
          ORDER BY boundary_updated_at ASC, id ASC
          LIMIT 1
        `
        )
        .get(referenceTimestamp, referenceTimestamp, currentId) as AnnotationRow | undefined

      // If no confirmed/predicted annotation found, look for gaps with higher IDs
      // This allows navigating back to gaps the user was working on
      annotation ??= db
        .prepare(
          `
            SELECT * FROM captions
            WHERE id > ?
            AND boundary_state = 'gap'
            ORDER BY id ASC
            LIMIT 1
          `
        )
        .get(currentId) as AnnotationRow | undefined

      console.log(
        `[navigateAnnotation] Next query selected:`,
        annotation
          ? {
              id: annotation.id,
              start_frame_index: annotation.start_frame_index,
              end_frame_index: annotation.end_frame_index,
              boundary_updated_at: annotation.boundary_updated_at,
              boundary_state: annotation.boundary_state,
            }
          : null
      )
    }

    return {
      annotation: annotation ? transformAnnotation(annotation) : null,
    }
  } finally {
    db.close()
  }
}

/**
 * Get the next pending annotation for review.
 *
 * Returns the next annotation that needs user attention (boundary_pending = 1),
 * ordered by frame position. Optionally starts searching after a specific annotation.
 *
 * @param videoId - Video identifier
 * @param afterId - Optional ID to start searching after
 * @returns The next pending annotation, or null if none found
 * @throws Error if database is not found
 */
export async function getNextPendingAnnotation(
  videoId: string,
  afterId?: number
): Promise<Annotation | null> {
  const result = await getAnnotationDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    let annotation: AnnotationRow | undefined

    if (afterId !== undefined) {
      // Get the start_frame_index of the current annotation
      const current = db
        .prepare('SELECT start_frame_index FROM captions WHERE id = ?')
        .get(afterId) as { start_frame_index: number } | undefined

      if (current) {
        // Get next pending annotation after the current one's position
        annotation = db
          .prepare(
            `
            SELECT * FROM captions
            WHERE boundary_pending = 1
            AND boundary_state IN ('predicted', 'confirmed')
            AND (start_frame_index > ? OR (start_frame_index = ? AND id > ?))
            ORDER BY start_frame_index ASC, id ASC
            LIMIT 1
          `
          )
          .get(current.start_frame_index, current.start_frame_index, afterId) as
          | AnnotationRow
          | undefined

        // If no pending annotation found after current, wrap around to beginning
        annotation ??= db
          .prepare(
            `
            SELECT * FROM captions
            WHERE boundary_pending = 1
            AND boundary_state IN ('predicted', 'confirmed')
            ORDER BY start_frame_index ASC, id ASC
            LIMIT 1
          `
          )
          .get() as AnnotationRow | undefined
      }
    } else {
      // Get first pending annotation
      annotation = db
        .prepare(
          `
          SELECT * FROM captions
          WHERE boundary_pending = 1
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

/**
 * Get progress statistics for a video's annotations.
 *
 * Calculates the total count, confirmed count, pending count, and gap count
 * of annotations, along with an overall completion percentage.
 *
 * @param videoId - Video identifier
 * @returns Progress statistics for the video
 * @throws Error if database is not found
 */
export async function getProgressStats(videoId: string): Promise<ProgressStats> {
  const result = await getAnnotationDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    const stats = db
      .prepare(
        `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN boundary_state = 'confirmed' AND boundary_pending = 0 THEN 1 ELSE 0 END) as confirmed,
          SUM(CASE WHEN boundary_pending = 1 THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN boundary_state = 'gap' THEN 1 ELSE 0 END) as gaps
        FROM captions
      `
      )
      .get() as {
      total: number
      confirmed: number
      pending: number
      gaps: number
    }

    // Calculate completion percentage (exclude gaps from calculation)
    const nonGapTotal = stats.total - stats.gaps
    const completionPercentage =
      nonGapTotal > 0 ? Math.round((stats.confirmed / nonGapTotal) * 100) : 100

    return {
      total: stats.total,
      confirmed: stats.confirmed,
      pending: stats.pending,
      gaps: stats.gaps,
      completionPercentage,
    }
  } finally {
    db.close()
  }
}

/**
 * Mark an annotation as no longer pending (reviewed by user).
 *
 * This is used when a user has reviewed an annotation but made no changes.
 * The annotation is marked as not pending without changing its boundary state.
 *
 * @param videoId - Video identifier
 * @param annotationId - ID of the annotation to mark as reviewed
 * @returns The updated annotation
 * @throws Error if database or annotation is not found
 */
export async function markAnnotationReviewed(
  videoId: string,
  annotationId: number
): Promise<Annotation> {
  const result = await getWritableDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    db.prepare(
      `
      UPDATE captions
      SET boundary_pending = 0
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
 * Get annotation by ID.
 *
 * @param videoId - Video identifier
 * @param annotationId - ID of the annotation to retrieve
 * @returns The annotation, or null if not found
 * @throws Error if database is not found
 */
export async function getAnnotationById(
  videoId: string,
  annotationId: number
): Promise<Annotation | null> {
  const result = await getAnnotationDatabase(videoId)
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
