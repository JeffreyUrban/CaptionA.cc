/**
 * Database Queries - Type-safe query builders for layout.db
 *
 * Provides typed interfaces and query functions for the layout database.
 * These queries are executed locally via CR-SQLite and synced via WebSocket.
 *
 * Layout database schema:
 * - layout_analysis_boxes: OCR box detections with labels
 * - crop_region: Frame crop region configuration
 * - layout_analysis_parameters: Layout analysis configuration
 */

import type { CRSQLiteDatabase } from './crsqlite-client'
import type { BoxLabel, TextAnchor } from '~/types/enums'

// =============================================================================
// Database Row Types
// =============================================================================

/**
 * Raw row from layout_analysis_boxes table.
 */
export interface LayoutAnalysisBoxRow {
  id: number
  frame_index: number
  box_index: number
  bbox_left: number
  bbox_top: number
  bbox_right: number
  bbox_bottom: number
  text: string
  label: BoxLabel | 'clear' | null
  label_updated_at: string | null
  predicted_label: BoxLabel | null
  predicted_confidence: number | null
}

/**
 * Raw row from crop_region table.
 */
export interface CropRegionRow {
  id: number
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Raw row from layout_analysis_parameters table.
 */
export interface LayoutAnalysisParametersRow {
  id: number
  frame_width: number | null
  frame_height: number | null
  crop_left: number | null
  crop_top: number | null
  crop_right: number | null
  crop_bottom: number | null
  selection_left: number | null
  selection_top: number | null
  selection_right: number | null
  selection_bottom: number | null
  vertical_position: number | null
  vertical_std: number | null
  box_height: number | null
  box_height_std: number | null
  anchor_type: TextAnchor | null
  anchor_position: number | null
  top_edge_std: number | null
  bottom_edge_std: number | null
  horizontal_std_slope: number | null
  horizontal_std_intercept: number | null
  crop_region_version: number | null
  layout_approved: number | null
}

/**
 * Frame summary for queue display.
 */
export interface FrameSummaryRow {
  frame_index: number
  total_box_count: number
  caption_box_count: number
  min_confidence: number
  has_annotations: number
}

// =============================================================================
// Query Result Types (Mapped for UI)
// =============================================================================

/**
 * Box data formatted for UI display.
 */
export interface BoxDataResult {
  boxIndex: number
  text: string
  originalBounds: {
    left: number
    top: number
    right: number
    bottom: number
  }
  displayBounds: {
    left: number
    top: number
    right: number
    bottom: number
  }
  predictedLabel: BoxLabel | null
  predictedConfidence: number
  userLabel: BoxLabel | null
  colorCode: string
}

/**
 * Frame boxes data for frame view.
 */
export interface FrameBoxesResult {
  frameIndex: number
  imageUrl: string
  cropRegion: {
    left: number
    top: number
    right: number
    bottom: number
  }
  frameWidth: number
  frameHeight: number
  boxes: BoxDataResult[]
}

/**
 * Layout configuration for UI.
 */
export interface LayoutConfigResult {
  frameWidth: number
  frameHeight: number
  cropLeft: number
  cropTop: number
  cropRight: number
  cropBottom: number
  selectionLeft: number | null
  selectionTop: number | null
  selectionRight: number | null
  selectionBottom: number | null
  verticalPosition: number | null
  verticalStd: number | null
  boxHeight: number | null
  boxHeightStd: number | null
  anchorType: TextAnchor | null
  anchorPosition: number | null
  topEdgeStd: number | null
  bottomEdgeStd: number | null
  horizontalStdSlope: number | null
  horizontalStdIntercept: number | null
  cropRegionVersion: number
}

/**
 * Frame info for thumbnail grid.
 */
export interface FrameInfoResult {
  frameIndex: number
  totalBoxCount: number
  captionBoxCount: number
  minConfidence: number
  hasAnnotations: boolean
  imageUrl: string
}

/**
 * Layout queue response.
 */
export interface LayoutQueueResult {
  frames: FrameInfoResult[]
  layoutConfig: LayoutConfigResult | null
  layoutApproved: boolean
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Determine color code based on box state.
 */
function getColorCode(
  userLabel: BoxLabel | 'clear' | null,
  predictedLabel: BoxLabel | null,
  predictedConfidence: number | null
): string {
  // User annotation takes precedence
  if (userLabel === 'in') {
    return 'annotated_in'
  }
  if (userLabel === 'out') {
    return 'annotated_out'
  }

  // Use prediction
  const confidence = predictedConfidence ?? 0.5
  const label = predictedLabel ?? 'in'

  if (label === 'in') {
    if (confidence >= 0.8) return 'predicted_in_high'
    if (confidence >= 0.5) return 'predicted_in_medium'
    return 'predicted_in_low'
  } else {
    if (confidence >= 0.8) return 'predicted_out_high'
    if (confidence >= 0.5) return 'predicted_out_medium'
    return 'predicted_out_low'
  }
}

/**
 * Build image URL for a frame.
 */
function buildFrameImageUrl(videoId: string, frameIndex: number): string {
  // Returns the relative path - the component will handle actual URL construction
  return `/api/images/${encodeURIComponent(videoId)}/full_frames/frame_${String(frameIndex).padStart(6, '0')}.jpg`
}

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Get all boxes for a specific frame.
 */
export async function getFrameBoxes(
  db: CRSQLiteDatabase,
  videoId: string,
  frameIndex: number,
  layoutConfig: LayoutConfigResult | null
): Promise<FrameBoxesResult> {
  const result = await db.query<LayoutAnalysisBoxRow>(
    `SELECT * FROM layout_analysis_boxes
     WHERE frame_index = ?
     ORDER BY box_index`,
    [frameIndex]
  )

  const cropRegion = layoutConfig
    ? {
        left: layoutConfig.cropLeft,
        top: layoutConfig.cropTop,
        right: layoutConfig.cropRight,
        bottom: layoutConfig.cropBottom,
      }
    : { left: 0, top: 0, right: 1, bottom: 1 }

  const boxes: BoxDataResult[] = result.rows.map(row => ({
    boxIndex: row.box_index,
    text: row.text,
    originalBounds: {
      left: row.bbox_left,
      top: row.bbox_top,
      right: row.bbox_right,
      bottom: row.bbox_bottom,
    },
    displayBounds: {
      left: row.bbox_left,
      top: row.bbox_top,
      right: row.bbox_right,
      bottom: row.bbox_bottom,
    },
    predictedLabel: row.predicted_label,
    predictedConfidence: row.predicted_confidence ?? 0.5,
    userLabel: row.label === 'clear' ? null : row.label,
    colorCode: getColorCode(row.label, row.predicted_label, row.predicted_confidence),
  }))

  return {
    frameIndex,
    imageUrl: buildFrameImageUrl(videoId, frameIndex),
    cropRegion,
    frameWidth: layoutConfig?.frameWidth ?? 1920,
    frameHeight: layoutConfig?.frameHeight ?? 1080,
    boxes,
  }
}

/**
 * Get all analysis boxes across all frames.
 */
export async function getAllAnalysisBoxes(db: CRSQLiteDatabase): Promise<BoxDataResult[]> {
  const result = await db.query<LayoutAnalysisBoxRow>(
    `SELECT * FROM layout_analysis_boxes ORDER BY frame_index, box_index`
  )

  return result.rows.map(row => ({
    boxIndex: row.box_index,
    text: row.text,
    originalBounds: {
      left: row.bbox_left,
      top: row.bbox_top,
      right: row.bbox_right,
      bottom: row.bbox_bottom,
    },
    displayBounds: {
      left: row.bbox_left,
      top: row.bbox_top,
      right: row.bbox_right,
      bottom: row.bbox_bottom,
    },
    predictedLabel: row.predicted_label,
    predictedConfidence: row.predicted_confidence ?? 0.5,
    userLabel: row.label === 'clear' ? null : row.label,
    colorCode: getColorCode(row.label, row.predicted_label, row.predicted_confidence),
  }))
}

/**
 * Get layout configuration.
 */
export async function getLayoutConfig(db: CRSQLiteDatabase): Promise<LayoutConfigResult | null> {
  const result = await db.query<LayoutAnalysisParametersRow>(
    `SELECT * FROM layout_analysis_parameters LIMIT 1`
  )

  const row = result.rows[0]
  if (!row) {
    return null
  }

  return {
    frameWidth: row.frame_width ?? 1920,
    frameHeight: row.frame_height ?? 1080,
    cropLeft: row.crop_left ?? 0,
    cropTop: row.crop_top ?? 0,
    cropRight: row.crop_right ?? 1,
    cropBottom: row.crop_bottom ?? 1,
    selectionLeft: row.selection_left,
    selectionTop: row.selection_top,
    selectionRight: row.selection_right,
    selectionBottom: row.selection_bottom,
    verticalPosition: row.vertical_position,
    verticalStd: row.vertical_std,
    boxHeight: row.box_height,
    boxHeightStd: row.box_height_std,
    anchorType: row.anchor_type,
    anchorPosition: row.anchor_position,
    topEdgeStd: row.top_edge_std,
    bottomEdgeStd: row.bottom_edge_std,
    horizontalStdSlope: row.horizontal_std_slope,
    horizontalStdIntercept: row.horizontal_std_intercept,
    cropRegionVersion: row.crop_region_version ?? 0,
  }
}

/**
 * Check if layout is approved.
 */
export async function isLayoutApproved(db: CRSQLiteDatabase): Promise<boolean> {
  const result = await db.query<{ layout_approved: number | null }>(
    `SELECT layout_approved FROM layout_analysis_parameters LIMIT 1`
  )

  const row = result.rows[0]
  return row?.layout_approved === 1
}

/**
 * Get frame summaries for queue display.
 */
export async function getFrameSummaries(
  db: CRSQLiteDatabase,
  videoId: string
): Promise<FrameInfoResult[]> {
  // Get unique frame indices with aggregated stats
  const result = await db.query<FrameSummaryRow>(
    `SELECT
       frame_index,
       COUNT(*) as total_box_count,
       SUM(CASE
         WHEN label = 'in' OR (label IS NULL AND predicted_label = 'in')
         THEN 1 ELSE 0
       END) as caption_box_count,
       MIN(COALESCE(predicted_confidence, 1.0)) as min_confidence,
       MAX(CASE WHEN label IS NOT NULL THEN 1 ELSE 0 END) as has_annotations
     FROM layout_analysis_boxes
     GROUP BY frame_index
     ORDER BY frame_index`
  )

  return result.rows.map(row => ({
    frameIndex: row.frame_index,
    totalBoxCount: row.total_box_count,
    captionBoxCount: row.caption_box_count,
    minConfidence: row.min_confidence,
    hasAnnotations: row.has_annotations === 1,
    imageUrl: buildFrameImageUrl(videoId, row.frame_index),
  }))
}

/**
 * Get complete layout queue data.
 */
export async function getLayoutQueue(
  db: CRSQLiteDatabase,
  videoId: string
): Promise<LayoutQueueResult> {
  const [frames, layoutConfig, layoutApproved] = await Promise.all([
    getFrameSummaries(db, videoId),
    getLayoutConfig(db),
    isLayoutApproved(db),
  ])

  return {
    frames,
    layoutConfig,
    layoutApproved,
  }
}

/**
 * Update box label (annotation).
 */
export async function updateBoxLabel(
  db: CRSQLiteDatabase,
  frameIndex: number,
  boxIndex: number,
  label: BoxLabel | 'clear'
): Promise<number> {
  const now = new Date().toISOString()

  return db.exec(
    `UPDATE layout_analysis_boxes
     SET label = ?, label_updated_at = ?
     WHERE frame_index = ? AND box_index = ?`,
    [label === 'clear' ? null : label, now, frameIndex, boxIndex]
  )
}

/**
 * Batch update box labels.
 */
export async function updateBoxLabels(
  db: CRSQLiteDatabase,
  frameIndex: number,
  annotations: Array<{ boxIndex: number; label: BoxLabel | 'clear' }>
): Promise<number> {
  let totalRows = 0
  const now = new Date().toISOString()

  for (const annotation of annotations) {
    const rows = await db.exec(
      `UPDATE layout_analysis_boxes
       SET label = ?, label_updated_at = ?
       WHERE frame_index = ? AND box_index = ?`,
      [annotation.label === 'clear' ? null : annotation.label, now, frameIndex, annotation.boxIndex]
    )
    totalRows += rows
  }

  return totalRows
}

/**
 * Clear all user annotations.
 */
export async function clearAllAnnotations(db: CRSQLiteDatabase): Promise<number> {
  return db.exec(
    `UPDATE layout_analysis_boxes SET label = NULL, label_updated_at = NULL WHERE label IS NOT NULL`
  )
}

/**
 * Bulk annotate boxes within a rectangle.
 */
export async function bulkAnnotateByRectangle(
  db: CRSQLiteDatabase,
  rectangle: { left: number; top: number; right: number; bottom: number },
  action: 'clear' | 'mark_out'
): Promise<number> {
  const now = new Date().toISOString()

  if (action === 'clear') {
    // Clear annotations for boxes that overlap with rectangle
    return db.exec(
      `UPDATE layout_analysis_boxes
       SET label = NULL, label_updated_at = ?
       WHERE bbox_left < ? AND bbox_right > ?
         AND bbox_top < ? AND bbox_bottom > ?
         AND label IS NOT NULL`,
      [now, rectangle.right, rectangle.left, rectangle.bottom, rectangle.top]
    )
  } else {
    // Mark as 'out' for boxes that overlap with rectangle
    return db.exec(
      `UPDATE layout_analysis_boxes
       SET label = 'out', label_updated_at = ?
       WHERE bbox_left < ? AND bbox_right > ?
         AND bbox_top < ? AND bbox_bottom > ?`,
      [now, rectangle.right, rectangle.left, rectangle.bottom, rectangle.top]
    )
  }
}

/**
 * Get count of user annotations.
 */
export async function getAnnotationCount(db: CRSQLiteDatabase): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM layout_analysis_boxes WHERE label IS NOT NULL`
  )
  return result.rows[0]?.count ?? 0
}

/**
 * Get boxes that need annotation (predicted label differs from high confidence).
 */
export async function getBoxesNeedingAnnotation(
  db: CRSQLiteDatabase,
  confidenceThreshold = 0.5
): Promise<LayoutAnalysisBoxRow[]> {
  const result = await db.query<LayoutAnalysisBoxRow>(
    `SELECT * FROM layout_analysis_boxes
     WHERE label IS NULL
       AND (predicted_confidence IS NULL OR predicted_confidence < ?)
     ORDER BY predicted_confidence ASC, frame_index, box_index`,
    [confidenceThreshold]
  )
  return result.rows
}

/**
 * Set layout as approved.
 */
export async function setLayoutApproved(db: CRSQLiteDatabase, approved: boolean): Promise<number> {
  return db.exec(`UPDATE layout_analysis_parameters SET layout_approved = ?`, [approved ? 1 : 0])
}

/**
 * Update crop region in layout parameters.
 */
export async function updateCropRegion(
  db: CRSQLiteDatabase,
  cropRegion: { left: number; top: number; right: number; bottom: number }
): Promise<number> {
  const result = await db.query<{ crop_region_version: number | null }>(
    `SELECT crop_region_version FROM layout_analysis_parameters LIMIT 1`
  )
  const currentVersion = result.rows[0]?.crop_region_version ?? 0

  return db.exec(
    `UPDATE layout_analysis_parameters
     SET crop_left = ?, crop_top = ?, crop_right = ?, crop_bottom = ?,
         crop_region_version = ?`,
    [cropRegion.left, cropRegion.top, cropRegion.right, cropRegion.bottom, currentVersion + 1]
  )
}

/**
 * Get distinct frame indices.
 */
export async function getFrameIndices(db: CRSQLiteDatabase): Promise<number[]> {
  const result = await db.query<{ frame_index: number }>(
    `SELECT DISTINCT frame_index FROM layout_analysis_boxes ORDER BY frame_index`
  )
  return result.rows.map(row => row.frame_index)
}
