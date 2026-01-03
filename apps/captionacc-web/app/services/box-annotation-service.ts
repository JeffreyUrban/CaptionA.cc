/**
 * Box annotation service for OCR box classification.
 *
 * Provides functionality for annotating OCR boxes as captions or noise,
 * including individual box annotation, bulk annotation, and prediction calculation.
 */

import type Database from 'better-sqlite3'

import type { BoxLabel, LabelSource, TextAnchor } from '~/types/enums'
import { triggerModelTraining } from '~/services/model-training'
import { predictBoxLabel, trainModel, initializeSeedModel } from '~/utils/box-prediction'
import {
  pixelToCroppedDisplay,
  boundsIntersect,
  type PixelBounds,
  type FractionalBounds,
  type CropBounds,
} from '~/utils/coordinate-utils'
import { getAnnotationDatabase, getWritableDatabase } from '~/utils/database'
import {
  shouldTriggerFullRetrain,
  getRetrainState,
  formatRetrainTriggerLog,
} from '~/utils/smart-retrain-triggers'

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
 * OCR box data from database.
 */
interface OcrBoxRow {
  box_index: number
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
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
  /** Whether auto-retraining was triggered */
  retrainingTriggered: boolean
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

/**
 * Result of calculating predictions.
 */
export interface CalculatePredictionsResult {
  success: boolean
  updatedCount: number
  modelVersion: string | null
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * OCR box record with computed pixel bounds.
 * Used internally for processing boxes with pre-computed coordinates.
 */
interface OcrBoxRecord {
  boxIndex: number
  text: string
  bounds: PixelBounds
}

/**
 * Result of processing boxes in a single frame.
 */
interface ProcessFrameResult {
  annotatedCount: number
  newlyAnnotatedCount: number
  boxIndices: number[]
}

// =============================================================================
// Bulk Annotation Helper Functions
// =============================================================================

/**
 * Filter OCR boxes that intersect with a rectangle.
 *
 * @param boxes - Array of OCR box records with bounds
 * @param rectangle - Rectangle bounds in pixel coordinates
 * @returns Array of box records that intersect with the rectangle
 */
function filterBoxesInRectangle(boxes: OcrBoxRecord[], rectangle: PixelBounds): OcrBoxRecord[] {
  return boxes.filter(box => boundsIntersect(box.bounds, rectangle))
}

/**
 * Apply annotation action to a single box.
 *
 * Handles 'mark_out' (insert/update) and 'clear' (delete) actions.
 *
 * @param db - Database connection
 * @param frameIndex - Frame index
 * @param box - OCR box record
 * @param action - Action to apply
 * @param prediction - Prediction data for the box (for mark_out)
 * @param modelVersion - Model version string (for mark_out)
 * @returns true if the box was newly annotated (didn't have a label before)
 */
function applyAnnotationAction(
  db: Database.Database,
  frameIndex: number,
  box: OcrBoxRecord,
  action: 'mark_out' | 'clear',
  prediction: { label: 'in' | 'out'; confidence: number } | null,
  modelVersion: string | null
): boolean {
  if (action === 'clear') {
    db.prepare(`DELETE FROM full_frame_box_labels WHERE frame_index = ? AND box_index = ?`).run(
      frameIndex,
      box.boxIndex
    )
    return false // Clear doesn't count as "newly annotated"
  }

  // action === 'mark_out'
  // Check if box already has a label
  const existing = db
    .prepare(`SELECT 1 FROM full_frame_box_labels WHERE frame_index = ? AND box_index = ?`)
    .get(frameIndex, box.boxIndex)

  const isNewlyAnnotated = !existing

  db.prepare(
    `
    INSERT INTO full_frame_box_labels (
      annotation_source, frame_index, box_index, box_text,
      box_left, box_top, box_right, box_bottom,
      label, label_source, predicted_label, predicted_confidence, model_version, labeled_at
    ) VALUES ('full_frame', ?, ?, ?, ?, ?, ?, ?, 'out', 'user', ?, ?, ?, datetime('now'))
    ON CONFLICT(annotation_source, frame_index, box_index)
    DO UPDATE SET label = 'out', label_source = 'user', labeled_at = datetime('now')
  `
  ).run(
    frameIndex,
    box.boxIndex,
    box.text,
    box.bounds.left,
    box.bounds.top,
    box.bounds.right,
    box.bounds.bottom,
    prediction?.label ?? 'out',
    prediction?.confidence ?? 0.5,
    modelVersion
  )

  return isNewlyAnnotated
}

/**
 * Process all boxes in a frame that intersect with a rectangle.
 *
 * @param db - Database connection
 * @param frameIndex - Frame index
 * @param boxes - All OCR box records for the frame
 * @param rectangle - Rectangle bounds in pixel coordinates
 * @param action - Action to apply
 * @param layoutConfig - Layout config for predictions
 * @param modelVersion - Model version string
 * @returns Result with counts and affected box indices
 */
function processFrameBoxes(
  db: Database.Database,
  frameIndex: number,
  boxes: OcrBoxRecord[],
  rectangle: PixelBounds,
  action: 'mark_out' | 'clear',
  layoutConfig: VideoLayoutConfigRow,
  modelVersion: string | null
): ProcessFrameResult {
  const matchingBoxes = filterBoxesInRectangle(boxes, rectangle)

  if (matchingBoxes.length === 0) {
    return { annotatedCount: 0, newlyAnnotatedCount: 0, boxIndices: [] }
  }

  // Pre-compute all bounds for prediction feature extraction
  const allBounds = boxes.map(b => b.bounds)
  let newlyAnnotatedCount = 0
  const boxIndices: number[] = []

  for (const box of matchingBoxes) {
    // Get prediction for mark_out action
    const prediction =
      action === 'mark_out'
        ? predictBoxLabel(box.bounds, layoutConfig, allBounds, frameIndex, box.boxIndex, db)
        : null

    const isNew = applyAnnotationAction(db, frameIndex, box, action, prediction, modelVersion)
    if (isNew) newlyAnnotatedCount++
    boxIndices.push(box.boxIndex)
  }

  return {
    annotatedCount: matchingBoxes.length,
    newlyAnnotatedCount,
    boxIndices,
  }
}

// =============================================================================
// Color Code Helper
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

/**
 * Check if smart retrain triggers have been reached for auto-retraining.
 *
 * Uses multi-condition logic that adapts to user annotation pace:
 * - Standard: 100 new annotations + 20s elapsed
 * - High-rate: 20+ annotations/minute with 30+ new annotations
 * - Time-based: 5 minutes elapsed with any new annotations
 *
 * @param db - Database connection
 * @returns Whether retraining should be triggered
 */
function shouldTriggerRetraining(db: Database.Database): boolean {
  const retrainState = getRetrainState(db)
  const triggerResult = shouldTriggerFullRetrain(retrainState)

  console.log(formatRetrainTriggerLog(triggerResult))

  return triggerResult.shouldRetrain
}

// TODO: Implement streaming prediction updates
// This will replace batch recalculation with intelligent scope detection:
// - Load covariance_inverse from model
// - Identify affected boxes using Mahalanobis distance and prediction uncertainty
// - Run adaptive recalculation with reversal rate stopping
// For now, full retrain triggers the standard calculatePredictions()

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Get all boxes for a frame with predictions and annotations.
 *
 * @param videoId - Video identifier
 * @param frameIndex - Frame index to retrieve
 * @returns Frame boxes result
 * @throws Error if database, config, or frame is not found
 */
export function getFrameBoxes(videoId: string, frameIndex: number): FrameBoxesResult {
  const result = getAnnotationDatabase(videoId)
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

    // Load frame OCR from full_frame_ocr table
    const ocrBoxes = db
      .prepare(
        `
        SELECT box_index, text, confidence, x, y, width, height
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

    // Convert all boxes to bounds for feature extraction
    const allBoxBounds: PixelBounds[] = ocrBoxes.map(box =>
      ocrToPixelBounds(box, layoutConfig.frame_width, layoutConfig.frame_height)
    )

    const cropBounds: CropBounds = {
      left: layoutConfig.crop_left,
      top: layoutConfig.crop_top,
      right: layoutConfig.crop_right,
      bottom: layoutConfig.crop_bottom,
    }

    // Process boxes
    const boxes: BoxData[] = ocrBoxes.map((ocrBox, boxIndex) => {
      const originalBounds = ocrToPixelBounds(
        ocrBox,
        layoutConfig.frame_width,
        layoutConfig.frame_height
      )

      // Predict label using Bayesian model
      const prediction = predictBoxLabel(
        originalBounds,
        layoutConfig,
        allBoxBounds,
        frameIndex,
        boxIndex,
        db
      )

      // Get user annotation if exists
      const userLabel = userAnnotationMap.get(boxIndex) ?? null

      // Calculate display bounds (fractional in cropped space)
      const displayBounds = pixelToCroppedDisplay(originalBounds, cropBounds)

      // Determine color code
      const colorCode = getBoxColorCode(prediction.label, prediction.confidence, userLabel)

      return {
        boxIndex,
        text: ocrBox.text,
        originalBounds,
        displayBounds,
        predictedLabel: prediction.label,
        predictedConfidence: prediction.confidence,
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
 * @param videoId - Video identifier
 * @param frameIndex - Frame index
 * @param annotations - Array of box annotations to save
 * @returns Save result with annotation count
 * @throws Error if database or frame is not found
 */
export function saveBoxAnnotations(
  videoId: string,
  frameIndex: number,
  annotations: BoxAnnotationInput[]
): SaveAnnotationsResult {
  const result = getWritableDatabase(videoId)
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
        `
        SELECT box_index, text, x, y, width, height
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `
      )
      .all(frameIndex) as OcrBoxRow[]

    if (ocrBoxes.length === 0) {
      throw new Error(`Frame ${frameIndex} not found in OCR data`)
    }

    // Get full layout config for predictions
    const fullLayoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfigRow
      | undefined

    // Get model version if available
    const modelInfo = db
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as { model_version: string } | undefined
    const modelVersion = modelInfo?.model_version ?? null

    // Convert all boxes to bounds for feature extraction
    const allBoxBounds: PixelBounds[] = ocrBoxes.map(box =>
      ocrToPixelBounds(box, layoutConfig.frame_width, layoutConfig.frame_height)
    )

    // Prepare upsert statement
    const upsert = db.prepare(`
      INSERT INTO full_frame_box_labels (
        annotation_source, frame_index, box_index, box_text, box_left, box_top, box_right, box_bottom,
        label, label_source, predicted_label, predicted_confidence, model_version, labeled_at
      ) VALUES ('full_frame', ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, datetime('now'))
      ON CONFLICT(annotation_source, frame_index, box_index) DO UPDATE SET
        label = excluded.label,
        labeled_at = datetime('now')
    `)

    // Save each annotation
    for (const annotation of annotations) {
      const { boxIndex, label } = annotation

      if (boxIndex >= ocrBoxes.length) {
        console.warn(`Box index ${boxIndex} out of range for frame ${frameIndex}`)
        continue
      }

      const ocrBox = ocrBoxes[boxIndex]
      if (!ocrBox) continue

      const originalBounds = ocrToPixelBounds(
        ocrBox,
        layoutConfig.frame_width,
        layoutConfig.frame_height
      )

      // Get prediction for this box
      let predictedLabel: 'in' | 'out' = 'out'
      let predictedConfidence = 0.5

      if (fullLayoutConfig) {
        const prediction = predictBoxLabel(
          originalBounds,
          fullLayoutConfig,
          allBoxBounds,
          frameIndex,
          boxIndex,
          db
        )
        predictedLabel = prediction.label
        predictedConfidence = prediction.confidence
      }

      upsert.run(
        frameIndex,
        boxIndex,
        ocrBox.text,
        originalBounds.left,
        originalBounds.top,
        originalBounds.right,
        originalBounds.bottom,
        label,
        predictedLabel,
        predictedConfidence,
        modelVersion
      )
    }

    // Check if retraining should be triggered
    const retrainingTriggered = shouldTriggerRetraining(db)
    if (retrainingTriggered) {
      console.log('[saveBoxAnnotations] Triggering model training')
      triggerModelTraining(videoId)
    }

    return {
      success: true,
      annotatedCount: annotations.length,
      retrainingTriggered,
    }
  } finally {
    db.close()
  }
}

/**
 * Bulk annotate all boxes within a rectangular region for a specific frame.
 *
 * The rectangle is specified in pixel coordinates (full frame space).
 * Supports mark_in, mark_out, and clear actions.
 *
 * @param videoId - Video identifier
 * @param frameIndex - Frame index to annotate
 * @param input - Bulk annotation input with rectangle (in pixels) and action
 * @returns Bulk annotation result with action, count, and affected box indices
 * @throws Error if database or layout config is not found
 */
export function bulkAnnotateRectangle(
  videoId: string,
  frameIndex: number,
  input: BulkAnnotateRectangleInput
): BulkAnnotateResult {
  const result = getWritableDatabase(videoId)
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
        SELECT box_index, text, confidence, x, y, width, height
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `
      )
      .all(frameIndex) as OcrBoxRow[]

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

      // Check if box intersects with rectangle (using < and > for proper intersection)
      const intersects = !(
        bounds.right < input.rectangle.left ||
        bounds.left > input.rectangle.right ||
        bounds.bottom < input.rectangle.top ||
        bounds.top > input.rectangle.bottom
      )

      if (intersects) {
        boxesInRectangle.push(box.box_index)
      }
    }

    console.log(`Found ${boxesInRectangle.length} boxes in rectangle for frame ${frameIndex}`)

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
        annotation_source,
        frame_index,
        box_index,
        box_text,
        box_left,
        box_top,
        box_right,
        box_bottom,
        label,
        label_source,
        labeled_at
      ) VALUES ('full_frame', ?, ?, ?, ?, ?, ?, ?, ?, 'user', datetime('now'))
      ON CONFLICT(annotation_source, frame_index, box_index)
      DO UPDATE SET
        label = excluded.label,
        label_source = 'user',
        labeled_at = datetime('now')
    `)

    for (const boxIndex of boxesInRectangle) {
      // Find the box data
      const box = ocrBoxes.find(b => b.box_index === boxIndex)
      if (!box) continue

      // Convert to pixel bounds for storage
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
 * Load OCR boxes for a frame and convert to OcrBoxRecord format.
 *
 * @param db - Database connection
 * @param frameIndex - Frame index to load
 * @param layoutConfig - Layout config with frame dimensions
 * @returns Array of OCR box records with computed bounds
 */
function loadFrameOcrBoxes(
  db: Database.Database,
  frameIndex: number,
  layoutConfig: VideoLayoutConfigRow
): OcrBoxRecord[] {
  const ocrBoxes = db
    .prepare(
      `SELECT box_index, text, x, y, width, height
       FROM full_frame_ocr WHERE frame_index = ? ORDER BY box_index`
    )
    .all(frameIndex) as OcrBoxRow[]

  return ocrBoxes.map(box => ({
    boxIndex: box.box_index,
    text: box.text,
    bounds: ocrToPixelBounds(box, layoutConfig.frame_width, layoutConfig.frame_height),
  }))
}

/**
 * Bulk annotate all boxes within a rectangular region across ALL frames.
 *
 * This iterates through all analysis frames (0.1Hz) and applies the action
 * to any boxes that intersect with the given rectangle.
 *
 * @param videoId - Video identifier
 * @param rectangle - Rectangle bounds in pixel coordinates (full frame space)
 * @param action - Action to apply ('mark_out' or 'clear')
 * @returns Result with counts of affected boxes and frames
 * @throws Error if database or layout config is not found
 */
export function bulkAnnotateRectangleAllFrames(
  videoId: string,
  rectangle: PixelBounds,
  action: BulkAnnotateRectangleAllAction
): BulkAnnotateRectangleAllResult {
  const result = getWritableDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Validate inputs and get configuration
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfigRow
      | undefined
    if (!layoutConfig) {
      throw new Error('Layout config not found')
    }

    const modelInfo = db
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as { model_version: string } | undefined
    const modelVersion = modelInfo?.model_version ?? null

    // Get all frame indices
    const frames = db
      .prepare('SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index')
      .all() as Array<{ frame_index: number }>

    // Process each frame and aggregate results
    let totalAnnotatedBoxes = 0
    let newlyAnnotatedBoxes = 0
    const affectedFrameIndices: number[] = []

    for (const { frame_index: frameIndex } of frames) {
      const boxes = loadFrameOcrBoxes(db, frameIndex, layoutConfig)
      const frameResult = processFrameBoxes(
        db,
        frameIndex,
        boxes,
        rectangle,
        action,
        layoutConfig,
        modelVersion
      )

      if (frameResult.annotatedCount > 0) {
        totalAnnotatedBoxes += frameResult.annotatedCount
        newlyAnnotatedBoxes += frameResult.newlyAnnotatedCount
        affectedFrameIndices.push(frameIndex)
      }
    }

    console.log(
      `Bulk annotated ${totalAnnotatedBoxes} boxes (${newlyAnnotatedBoxes} new) across ${affectedFrameIndices.length} frames`
    )

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
export function bulkAnnotateAll(
  videoId: string,
  action: BulkAnnotateAllAction
): BulkAnnotateAllResult {
  const result = getWritableDatabase(videoId)
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

      // Get model version
      const modelInfo = db
        .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
        .get() as { model_version: string } | undefined
      const modelVersion = modelInfo?.model_version ?? null

      // Prepare insert statement
      const insert = db.prepare(`
        INSERT INTO full_frame_box_labels (
          annotation_source, frame_index, box_index, box_text, box_left, box_top, box_right, box_bottom,
          label, label_source, predicted_label, predicted_confidence, model_version, labeled_at
        ) VALUES ('full_frame', ?, ?, ?, ?, ?, ?, ?, ?, 'model', ?, ?, ?, datetime('now'))
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
          box.predicted_label,
          box.predicted_label,
          box.predicted_confidence,
          modelVersion
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
 * Calculate and cache predictions for all boxes.
 *
 * Trains the model if sufficient annotations exist, then calculates
 * predictions for all boxes and caches them in the database.
 *
 * @param videoId - Video identifier
 * @returns Calculate predictions result
 * @throws Error if database is not found
 */
export function calculatePredictions(videoId: string): CalculatePredictionsResult {
  const result = getWritableDatabase(videoId)
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

    // Initialize seed model if not exists
    initializeSeedModel(db)

    // Train model with current annotations
    trainModel(db, layoutConfig)

    // Get model version
    const modelInfo = db
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as { model_version: string } | undefined

    // Get all frames
    const frames = db
      .prepare('SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index')
      .all() as Array<{ frame_index: number }>

    let updatedCount = 0

    // Prepare update statement
    const updatePrediction = db.prepare(`
      UPDATE full_frame_ocr
      SET predicted_label = ?, predicted_confidence = ?
      WHERE frame_index = ? AND box_index = ?
    `)

    for (const { frame_index: frameIndex } of frames) {
      // Get all boxes for this frame
      const ocrBoxes = db
        .prepare(
          `
          SELECT box_index, x, y, width, height
          FROM full_frame_ocr
          WHERE frame_index = ?
          ORDER BY box_index
        `
        )
        .all(frameIndex) as Array<{
        box_index: number
        x: number
        y: number
        width: number
        height: number
      }>

      // Convert to bounds for prediction
      const allBoxBounds: PixelBounds[] = ocrBoxes.map(box =>
        ocrToPixelBounds(box, layoutConfig.frame_width, layoutConfig.frame_height)
      )

      for (const ocrBox of ocrBoxes) {
        const bounds = ocrToPixelBounds(ocrBox, layoutConfig.frame_width, layoutConfig.frame_height)

        const prediction = predictBoxLabel(
          bounds,
          layoutConfig,
          allBoxBounds,
          frameIndex,
          ocrBox.box_index,
          db
        )

        updatePrediction.run(prediction.label, prediction.confidence, frameIndex, ocrBox.box_index)

        updatedCount++
      }
    }

    return {
      success: true,
      updatedCount,
      modelVersion: modelInfo?.model_version ?? null,
    }
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
