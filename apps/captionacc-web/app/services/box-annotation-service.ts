/**
 * Box annotation service for OCR box classification.
 *
 * Provides functionality for annotating OCR boxes as captions or noise.
 * Predictions are calculated server-side via the Python ocr_box_model package.
 */

import type Database from 'better-sqlite3'

import { triggerModelTraining } from '~/services/model-training'
import { startFullRetrain } from '~/services/processing-status-tracker'
import type { TextAnchor } from '~/types/enums'
import {
  pixelToCroppedDisplay,
  boundsIntersect,
  type PixelBounds,
  type FractionalBounds,
  type CropBounds,
} from '~/utils/coordinate-utils'
import { getAnnotationDatabase, getWritableDatabase } from '~/utils/database'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Database layout configuration row.
 */
interface VideoLayoutConfigRow {
  frame_width: number
  frame_height: number
  crop_left: number
  crop_top: number
  crop_right: number
  crop_bottom: number
  vertical_position: number | null
  vertical_std: number | null
  box_height: number | null
  box_height_std: number | null
  anchor_type: TextAnchor | null
  anchor_position: number | null
}

/**
 * OCR box data from database (includes predictions from server).
 */
interface OcrBoxRow {
  box_index: number
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
  predicted_label: 'in' | 'out' | null
  predicted_confidence: number | null
}

/**
 * Box data for frontend display.
 */
export interface BoxData {
  boxIndex: number
  text: string
  /** Original pixel coordinates in full frame space */
  originalBounds: PixelBounds
  /** Display bounds as fractional coordinates (0-1) in cropped space */
  displayBounds: FractionalBounds
  predictedLabel: 'in' | 'out'
  predictedConfidence: number
  userLabel: 'in' | 'out' | null
  /**
   * Color code for visual differentiation.
   * Values: 'annotated_in', 'annotated_out', 'predicted_in_high',
   *         'predicted_in_medium', 'predicted_in_low', 'predicted_out_high',
   *         'predicted_out_medium', 'predicted_out_low'
   */
  colorCode: string
}

/**
 * Result of getting frame boxes.
 */
export interface FrameBoxesResult {
  frameIndex: number
  imageUrl: string
  cropBounds: CropBounds
  frameWidth: number
  frameHeight: number
  boxes: BoxData[]
}

/**
 * Input for saving box annotations.
 */
export interface BoxAnnotationInput {
  boxIndex: number
  label: 'in' | 'out'
}

/**
 * Result of saving box annotations.
 */
export interface SaveAnnotationsResult {
  success: boolean
  annotatedCount: number
  /** Whether server-side prediction recalculation was triggered */
  recalculationTriggered: boolean
}

/**
 * Input for bulk annotation of a rectangular region.
 */
export interface BulkAnnotateRectangleInput {
  /** Rectangle bounds in pixel coordinates (full frame space) */
  rectangle: PixelBounds
  /** Action to apply to all boxes in the rectangle */
  action: 'mark_in' | 'mark_out' | 'clear'
}

/**
 * Result of bulk annotation.
 */
export interface BulkAnnotateResult {
  success: boolean
  /** The action that was performed */
  action: 'mark_in' | 'mark_out' | 'clear'
  /** Number of boxes annotated */
  annotatedCount: number
  /** Indices of boxes that were affected */
  boxIndices: number[]
}

/**
 * Action for bulk annotating all boxes.
 */
export type BulkAnnotateAllAction = 'accept_predictions' | 'clear_annotations'

/**
 * Result of bulk annotating all boxes.
 */
export interface BulkAnnotateAllResult {
  success: boolean
  /** Number of boxes annotated */
  annotatedCount: number
  /** Frame indices that were affected */
  affectedFrames: number[]
}

/**
 * Action for bulk annotating boxes in rectangle across all frames.
 */
export type BulkAnnotateRectangleAllAction = 'mark_out' | 'clear'

/**
 * Result of bulk annotating boxes in rectangle across all frames.
 */
export interface BulkAnnotateRectangleAllResult {
  success: boolean
  /** The action that was performed */
  action: BulkAnnotateRectangleAllAction
  /** Total number of boxes annotated/affected across all frames */
  totalAnnotatedBoxes: number
  /** Number of boxes that were newly annotated (didn't have labels before) */
  newlyAnnotatedBoxes: number
  /** Number of frames that were processed */
  framesProcessed: number
  /** Frame indices that were affected */
  frameIndices: number[]
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Determine color code based on prediction and user annotation.
 */
function getBoxColorCode(
  predictedLabel: 'in' | 'out',
  predictedConfidence: number,
  userLabel: 'in' | 'out' | null
): string {
  // User annotation takes precedence
  if (userLabel !== null) {
    return userLabel === 'in' ? 'annotated_in' : 'annotated_out'
  }

  // Predicted
  if (predictedLabel === 'in') {
    if (predictedConfidence >= 0.75) return 'predicted_in_high'
    if (predictedConfidence >= 0.5) return 'predicted_in_medium'
    return 'predicted_in_low'
  } else {
    if (predictedConfidence >= 0.75) return 'predicted_out_high'
    if (predictedConfidence >= 0.5) return 'predicted_out_medium'
    return 'predicted_out_low'
  }
}

/**
 * Convert OCR fractional coordinates to pixel bounds.
 * Handles the y-axis flip from bottom-referenced to top-referenced coordinates.
 */
function ocrToPixelBounds(
  ocrBox: { x: number; y: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number
): PixelBounds {
  const boxLeft = Math.floor(ocrBox.x * frameWidth)
  // Convert y from bottom-referenced to top-referenced
  const boxBottom = Math.floor((1 - ocrBox.y) * frameHeight)
  const boxTop = boxBottom - Math.floor(ocrBox.height * frameHeight)
  const boxRight = boxLeft + Math.floor(ocrBox.width * frameWidth)

  return { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom }
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Get all boxes for a frame with predictions and annotations.
 *
 * Predictions are read from the database (calculated server-side).
 *
 * @param videoId - Video identifier
 * @param frameIndex - Frame index to retrieve
 * @returns Frame boxes result
 * @throws Error if database, config, or frame is not found
 */
export async function getFrameBoxes(
  videoId: string,
  frameIndex: number
): Promise<FrameBoxesResult> {
  const result = await getAnnotationDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Get layout config
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfigRow
      | undefined

    if (!layoutConfig) {
      throw new Error('Layout config not found')
    }

    // Load frame OCR from full_frame_ocr table (includes server-calculated predictions)
    const ocrBoxes = db
      .prepare(
        `
        SELECT box_index, text, confidence, x, y, width, height,
               predicted_label, predicted_confidence
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `
      )
      .all(frameIndex) as OcrBoxRow[]

    if (ocrBoxes.length === 0) {
      throw new Error(`Frame ${frameIndex} not found in OCR data. Run full_frames analysis first.`)
    }

    // Get user annotations for this frame
    const userAnnotations = db
      .prepare(
        `
        SELECT box_index, label
        FROM full_frame_box_labels
        WHERE frame_index = ? AND label_source = 'user'
      `
      )
      .all(frameIndex) as Array<{ box_index: number; label: 'in' | 'out' }>

    const userAnnotationMap = new Map<number, 'in' | 'out'>()
    userAnnotations.forEach(ann => {
      userAnnotationMap.set(ann.box_index, ann.label)
    })

    const cropBounds: CropBounds = {
      left: layoutConfig.crop_left,
      top: layoutConfig.crop_top,
      right: layoutConfig.crop_right,
      bottom: layoutConfig.crop_bottom,
    }

    // Process boxes - read predictions from database
    const boxes: BoxData[] = ocrBoxes.map(ocrBox => {
      const originalBounds = ocrToPixelBounds(
        ocrBox,
        layoutConfig.frame_width,
        layoutConfig.frame_height
      )

      // Use predictions from database (calculated server-side)
      // Default to 'out' with low confidence if not yet calculated
      const predictedLabel = ocrBox.predicted_label ?? 'out'
      const predictedConfidence = ocrBox.predicted_confidence ?? 0.5

      // Get user annotation if exists
      const userLabel = userAnnotationMap.get(ocrBox.box_index) ?? null

      // Calculate display bounds (fractional in cropped space)
      const displayBounds = pixelToCroppedDisplay(originalBounds, cropBounds)

      // Determine color code
      const colorCode = getBoxColorCode(predictedLabel, predictedConfidence, userLabel)

      return {
        boxIndex: ocrBox.box_index,
        text: ocrBox.text,
        originalBounds,
        displayBounds,
        predictedLabel,
        predictedConfidence,
        userLabel,
        colorCode,
      }
    })

    return {
      frameIndex,
      imageUrl: `/api/full-frames/${encodeURIComponent(videoId)}/${frameIndex}.jpg`,
      cropBounds,
      frameWidth: layoutConfig.frame_width,
      frameHeight: layoutConfig.frame_height,
      boxes,
    }
  } finally {
    db.close()
  }
}

/**
 * Save box annotations for a frame.
 *
 * After saving, optionally triggers server-side prediction recalculation
 * if enough annotations have been added.
 *
 * @param videoId - Video identifier
 * @param frameIndex - Frame index
 * @param annotations - Array of box annotations to save
 * @param triggerRecalculation - Whether to trigger server-side prediction recalculation
 * @returns Save result with annotation count
 * @throws Error if database or frame is not found
 */
export async function saveBoxAnnotations(
  videoId: string,
  frameIndex: number,
  annotations: BoxAnnotationInput[],
  triggerRecalculation: boolean = false
): Promise<SaveAnnotationsResult> {
  const result = await getWritableDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Get layout config for frame dimensions
    const layoutConfig = db
      .prepare('SELECT frame_width, frame_height FROM video_layout_config WHERE id = 1')
      .get() as { frame_width: number; frame_height: number } | undefined

    if (!layoutConfig) {
      throw new Error('Layout config not found')
    }

    // Load frame OCR
    const ocrBoxes = db
      .prepare(
        `SELECT box_index, text, x, y, width, height
         FROM full_frame_ocr WHERE frame_index = ? ORDER BY box_index`
      )
      .all(frameIndex) as Array<{
      box_index: number
      text: string
      x: number
      y: number
      width: number
      height: number
    }>

    if (ocrBoxes.length === 0) {
      throw new Error(`Frame ${frameIndex} not found in OCR data`)
    }

    // Prepare upsert statement
    const upsert = db.prepare(`
      INSERT INTO full_frame_box_labels (
        annotation_source, frame_index, box_index, box_text, box_left, box_top, box_right, box_bottom,
        label, label_source, labeled_at
      ) VALUES ('full_frame', ?, ?, ?, ?, ?, ?, ?, ?, 'user', datetime('now'))
      ON CONFLICT(annotation_source, frame_index, box_index) DO UPDATE SET
        label = excluded.label,
        label_source = 'user',
        labeled_at = datetime('now')
    `)

    let savedCount = 0

    for (const annotation of annotations) {
      const { boxIndex, label } = annotation

      const ocrBox = ocrBoxes.find(b => b.box_index === boxIndex)
      if (!ocrBox) {
        console.warn(`Box index ${boxIndex} not found in frame ${frameIndex}`)
        continue
      }

      const bounds = ocrToPixelBounds(ocrBox, layoutConfig.frame_width, layoutConfig.frame_height)

      upsert.run(
        frameIndex,
        boxIndex,
        ocrBox.text,
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
        label
      )

      savedCount++
    }

    // Trigger server-side recalculation if requested
    let recalculationTriggered = false
    if (triggerRecalculation && savedCount > 0) {
      console.log(`[saveBoxAnnotations] Triggering server-side prediction recalculation`)
      startFullRetrain(videoId)
      triggerModelTraining(videoId)
      recalculationTriggered = true
    }

    return {
      success: true,
      annotatedCount: savedCount,
      recalculationTriggered,
    }
  } finally {
    db.close()
  }
}

/**
 * Bulk annotate all boxes within a rectangular region for a specific frame.
 *
 * @param videoId - Video identifier
 * @param frameIndex - Frame index to annotate
 * @param input - Bulk annotation input with rectangle (in pixels) and action
 * @returns Bulk annotation result
 * @throws Error if database or layout config is not found
 */
export async function bulkAnnotateRectangle(
  videoId: string,
  frameIndex: number,
  input: BulkAnnotateRectangleInput
): Promise<BulkAnnotateResult> {
  const result = await getWritableDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Get layout config for frame dimensions
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfigRow
      | undefined

    if (!layoutConfig) {
      throw new Error('Layout config not found')
    }

    // Load OCR boxes for this frame
    const ocrBoxes = db
      .prepare(
        `
        SELECT box_index, text, x, y, width, height
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `
      )
      .all(frameIndex) as Array<{
      box_index: number
      text: string
      x: number
      y: number
      width: number
      height: number
    }>

    if (ocrBoxes.length === 0) {
      return {
        success: true,
        action: input.action,
        annotatedCount: 0,
        boxIndices: [],
      }
    }

    // Find all boxes that intersect with the rectangle
    const boxesInRectangle: number[] = []

    for (const box of ocrBoxes) {
      const bounds = ocrToPixelBounds(box, layoutConfig.frame_width, layoutConfig.frame_height)

      if (boundsIntersect(bounds, input.rectangle)) {
        boxesInRectangle.push(box.box_index)
      }
    }

    if (boxesInRectangle.length === 0) {
      return {
        success: true,
        action: input.action,
        annotatedCount: 0,
        boxIndices: [],
      }
    }

    // Handle 'clear' action - delete labels for these boxes
    if (input.action === 'clear') {
      const deleteStmt = db.prepare(`
        DELETE FROM full_frame_box_labels
        WHERE frame_index = ? AND box_index = ?
      `)

      for (const boxIndex of boxesInRectangle) {
        deleteStmt.run(frameIndex, boxIndex)
      }

      return {
        success: true,
        action: 'clear',
        annotatedCount: boxesInRectangle.length,
        boxIndices: boxesInRectangle,
      }
    }

    // Handle 'mark_in' or 'mark_out' actions
    const label = input.action === 'mark_in' ? 'in' : 'out'

    const upsertStmt = db.prepare(`
      INSERT INTO full_frame_box_labels (
        annotation_source, frame_index, box_index, box_text,
        box_left, box_top, box_right, box_bottom,
        label, label_source, labeled_at
      ) VALUES ('full_frame', ?, ?, ?, ?, ?, ?, ?, ?, 'user', datetime('now'))
      ON CONFLICT(annotation_source, frame_index, box_index)
      DO UPDATE SET
        label = excluded.label,
        label_source = 'user',
        labeled_at = datetime('now')
    `)

    for (const boxIndex of boxesInRectangle) {
      const box = ocrBoxes.find(b => b.box_index === boxIndex)
      if (!box) continue

      const bounds = ocrToPixelBounds(box, layoutConfig.frame_width, layoutConfig.frame_height)

      upsertStmt.run(
        frameIndex,
        boxIndex,
        box.text,
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
        label
      )
    }

    return {
      success: true,
      action: input.action,
      annotatedCount: boxesInRectangle.length,
      boxIndices: boxesInRectangle,
    }
  } finally {
    db.close()
  }
}

/**
 * Bulk annotate all boxes within a rectangular region across ALL frames.
 *
 * @param videoId - Video identifier
 * @param rectangle - Rectangle bounds in pixel coordinates (full frame space)
 * @param action - Action to apply ('mark_out' or 'clear')
 * @returns Result with counts of affected boxes and frames
 * @throws Error if database or layout config is not found
 */
export async function bulkAnnotateRectangleAllFrames(
  videoId: string,
  rectangle: PixelBounds,
  action: BulkAnnotateRectangleAllAction
): Promise<BulkAnnotateRectangleAllResult> {
  const result = await getWritableDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfigRow
      | undefined
    if (!layoutConfig) {
      throw new Error('Layout config not found')
    }

    // Get all frame indices
    const frames = db
      .prepare('SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index')
      .all() as Array<{ frame_index: number }>

    let totalAnnotatedBoxes = 0
    let newlyAnnotatedBoxes = 0
    const affectedFrameIndices: number[] = []

    for (const { frame_index: frameIndex } of frames) {
      // Load OCR boxes for this frame
      const ocrBoxes = db
        .prepare(
          `SELECT box_index, text, x, y, width, height
           FROM full_frame_ocr WHERE frame_index = ? ORDER BY box_index`
        )
        .all(frameIndex) as Array<{
        box_index: number
        text: string
        x: number
        y: number
        width: number
        height: number
      }>

      // Find boxes in rectangle
      const matchingBoxes = ocrBoxes.filter(box => {
        const bounds = ocrToPixelBounds(box, layoutConfig.frame_width, layoutConfig.frame_height)
        return boundsIntersect(bounds, rectangle)
      })

      if (matchingBoxes.length === 0) continue

      let frameNewCount = 0

      for (const box of matchingBoxes) {
        const bounds = ocrToPixelBounds(box, layoutConfig.frame_width, layoutConfig.frame_height)

        if (action === 'clear') {
          db.prepare(
            `DELETE FROM full_frame_box_labels WHERE frame_index = ? AND box_index = ?`
          ).run(frameIndex, box.box_index)
        } else {
          // Check if new
          const existing = db
            .prepare(`SELECT 1 FROM full_frame_box_labels WHERE frame_index = ? AND box_index = ?`)
            .get(frameIndex, box.box_index)

          if (!existing) frameNewCount++

          db.prepare(
            `
            INSERT INTO full_frame_box_labels (
              annotation_source, frame_index, box_index, box_text,
              box_left, box_top, box_right, box_bottom,
              label, label_source, labeled_at
            ) VALUES ('full_frame', ?, ?, ?, ?, ?, ?, ?, 'out', 'user', datetime('now'))
            ON CONFLICT(annotation_source, frame_index, box_index)
            DO UPDATE SET label = 'out', label_source = 'user', labeled_at = datetime('now')
          `
          ).run(
            frameIndex,
            box.box_index,
            box.text,
            bounds.left,
            bounds.top,
            bounds.right,
            bounds.bottom
          )
        }
      }

      totalAnnotatedBoxes += matchingBoxes.length
      newlyAnnotatedBoxes += frameNewCount
      affectedFrameIndices.push(frameIndex)
    }

    return {
      success: true,
      action,
      totalAnnotatedBoxes,
      newlyAnnotatedBoxes,
      framesProcessed: affectedFrameIndices.length,
      frameIndices: affectedFrameIndices,
    }
  } finally {
    db.close()
  }
}

/**
 * Bulk annotate all boxes in the video.
 *
 * @param videoId - Video identifier
 * @param action - Action to perform ('accept_predictions' or 'clear_annotations')
 * @returns Bulk annotation result
 * @throws Error if database is not found
 */
export async function bulkAnnotateAll(
  videoId: string,
  action: BulkAnnotateAllAction
): Promise<BulkAnnotateAllResult> {
  const result = await getWritableDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    if (action === 'clear_annotations') {
      // Delete all user annotations
      const deleteResult = db
        .prepare("DELETE FROM full_frame_box_labels WHERE label_source = 'user'")
        .run()

      return {
        success: true,
        annotatedCount: deleteResult.changes,
        affectedFrames: [],
      }
    }

    if (action === 'accept_predictions') {
      // Get all unannotated boxes with predictions
      const unannotatedBoxes = db
        .prepare(
          `
          SELECT o.frame_index, o.box_index, o.text, o.x, o.y, o.width, o.height,
                 o.predicted_label, o.predicted_confidence
          FROM full_frame_ocr o
          LEFT JOIN full_frame_box_labels l
            ON o.frame_index = l.frame_index
            AND o.box_index = l.box_index
            AND l.annotation_source = 'full_frame'
          WHERE l.label IS NULL
            AND o.predicted_label IS NOT NULL
        `
        )
        .all() as Array<{
        frame_index: number
        box_index: number
        text: string
        x: number
        y: number
        width: number
        height: number
        predicted_label: 'in' | 'out'
        predicted_confidence: number
      }>

      if (unannotatedBoxes.length === 0) {
        return {
          success: true,
          annotatedCount: 0,
          affectedFrames: [],
        }
      }

      // Get layout config
      const layoutConfig = db
        .prepare('SELECT frame_width, frame_height FROM video_layout_config WHERE id = 1')
        .get() as { frame_width: number; frame_height: number }

      // Prepare insert statement
      const insert = db.prepare(`
        INSERT INTO full_frame_box_labels (
          annotation_source, frame_index, box_index, box_text, box_left, box_top, box_right, box_bottom,
          label, label_source, labeled_at
        ) VALUES ('full_frame', ?, ?, ?, ?, ?, ?, ?, ?, 'model', datetime('now'))
      `)

      const affectedFrames = new Set<number>()

      for (const box of unannotatedBoxes) {
        const bounds = ocrToPixelBounds(box, layoutConfig.frame_width, layoutConfig.frame_height)

        insert.run(
          box.frame_index,
          box.box_index,
          box.text,
          bounds.left,
          bounds.top,
          bounds.right,
          bounds.bottom,
          box.predicted_label
        )

        affectedFrames.add(box.frame_index)
      }

      return {
        success: true,
        annotatedCount: unannotatedBoxes.length,
        affectedFrames: Array.from(affectedFrames).sort((a, b) => a - b),
      }
    }

    throw new Error(`Unknown action: ${action}`)
  } finally {
    db.close()
  }
}

/**
 * Get box color code for a given prediction and user label.
 *
 * Exported for use in other services or routes.
 */
export { getBoxColorCode }
