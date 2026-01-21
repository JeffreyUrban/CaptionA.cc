/**
 * Database Queries - Type-safe query builders for layout.db
 *
 * Provides typed interfaces and query functions for the layout database.
 * These queries are executed locally via CR-SQLite and synced via WebSocket.
 *
 * Layout database schema:
 * - boxes: OCR box detections with labels
 * - crop_region: Frame crop region configuration
 * - layout_config: Layout analysis configuration
 */

import type { CRSQLiteDatabase } from './crsqlite-client'

import type { BoxLabel, TextAnchor } from '~/types/enums'

// =============================================================================
// Database Row Types
// =============================================================================

/**
 * Raw row from boxes table.
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
 * Raw row from layout_config table.
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
  vertical_center: number | null
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
  // layoutApproved is now managed via Supabase, not in the SQLite database
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Determine color code based on box state.
 * Every box should have either a userLabel or a predictedLabel.
 * If neither exists, returns 'needs_prediction' to indicate prediction calculation is needed.
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

  // No user annotation - check for prediction
  const confidence = predictedConfidence ?? 0.5

  if (predictedLabel === 'in') {
    if (confidence >= 0.8) return 'predicted_in_high'
    if (confidence >= 0.5) return 'predicted_in_medium'
    return 'predicted_in_low'
  }
  if (predictedLabel === 'out') {
    if (confidence >= 0.8) return 'predicted_out_high'
    if (confidence >= 0.5) return 'predicted_out_medium'
    return 'predicted_out_low'
  }

  // No userLabel and no predictedLabel - needs prediction calculation
  return 'needs_prediction'
}

/**
 * Build image URL for a frame.
 * Returns S3 path that can be used with S3Image component for signed URL generation.
 * @param useThumbnail - If true, returns thumbnail path (320px wide) for faster loading
 */
function buildFrameImageUrl(videoId: string, frameIndex: number, useThumbnail = false): string {
  // Returns S3 path - S3Image component will convert to signed URL
  const prefix = useThumbnail ? 'full_frames_thumbnails' : 'full_frames'
  return `${prefix}/frame_${String(frameIndex).padStart(6, '0')}.jpg`
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
    `SELECT * FROM boxes
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
    `SELECT * FROM boxes ORDER BY frame_index, box_index`
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
  const result = await db.query<LayoutAnalysisParametersRow>(`SELECT * FROM layout_config LIMIT 1`)

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
    verticalPosition: row.vertical_center,
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
 * @deprecated Layout approval is now managed via Supabase, not in the SQLite database
 */
export async function isLayoutApproved(db: CRSQLiteDatabase): Promise<boolean> {
  // Layout approval is now managed via Supabase
  return false
}

/**
 * Get frame summaries for queue display.
 * Returns up to 11 evenly-distributed representative frames.
 * TODO: We must load the 11 frames with the lowest min confidence from our Bayesian model.
 */
export async function getFrameSummaries(
  db: CRSQLiteDatabase,
  videoId: string
): Promise<FrameInfoResult[]> {
  // First, get total count of frames
  const countResult = await db.query<{ count: number }>(
    `SELECT COUNT(DISTINCT frame_index) as count FROM boxes`
  )
  const totalFrames = countResult.rows[0]?.count ?? 0

  if (totalFrames === 0) {
    return []
  }

  // Calculate step size to get 11 evenly-distributed frames
  const targetFrameCount = Math.min(11, totalFrames)
  const step = Math.max(1, Math.floor(totalFrames / targetFrameCount))

  // Get all frame indices first
  const allFramesResult = await db.query<{ frame_index: number; row_num: number }>(
    `SELECT frame_index, ROW_NUMBER() OVER (ORDER BY frame_index) as row_num
     FROM (SELECT DISTINCT frame_index FROM boxes ORDER BY frame_index)`
  )

  // Select every Nth frame
  const selectedFrameIndices = allFramesResult.rows
    .filter((_, index) => index % step === 0)
    .slice(0, targetFrameCount)
    .map(row => row.frame_index)

  if (selectedFrameIndices.length === 0) {
    return []
  }

  // Get stats for selected frames
  const placeholders = selectedFrameIndices.map(() => '?').join(',')
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
     FROM boxes
     WHERE frame_index IN (${placeholders})
     GROUP BY frame_index
     ORDER BY frame_index`,
    selectedFrameIndices
  )

  return result.rows.map(row => ({
    frameIndex: row.frame_index,
    totalBoxCount: row.total_box_count,
    captionBoxCount: row.caption_box_count,
    minConfidence: row.min_confidence,
    hasAnnotations: row.has_annotations === 1,
    imageUrl: buildFrameImageUrl(videoId, row.frame_index, true), // Use thumbnails for grid
  }))
}

/**
 * Get complete layout queue data.
 */
export async function getLayoutQueue(
  db: CRSQLiteDatabase,
  videoId: string
): Promise<LayoutQueueResult> {
  const [frames, layoutConfig] = await Promise.all([
    getFrameSummaries(db, videoId),
    getLayoutConfig(db),
  ])

  return {
    frames,
    layoutConfig,
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
    `UPDATE boxes
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
      `UPDATE boxes
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
  return db.exec(`UPDATE boxes SET label = NULL, label_updated_at = NULL WHERE label IS NOT NULL`)
}

/**
 * Prediction to apply to a box.
 */
export interface BoxPredictionUpdate {
  frameIndex: number
  boxIndex: number
  predictedLabel: 'in' | 'out'
  predictedConfidence: number
}

/**
 * Apply predictions to boxes.
 * Updates predicted_label and predicted_confidence for each box.
 */
export async function applyPredictions(
  db: CRSQLiteDatabase,
  predictions: BoxPredictionUpdate[]
): Promise<number> {
  if (predictions.length === 0) return 0

  let updated = 0
  for (const pred of predictions) {
    const rows = await db.exec(
      `UPDATE boxes
       SET predicted_label = ?, predicted_confidence = ?
       WHERE frame_index = ? AND box_index = ?`,
      [pred.predictedLabel, pred.predictedConfidence, pred.frameIndex, pred.boxIndex]
    )
    updated += rows
  }
  return updated
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
      `UPDATE boxes
       SET label = NULL, label_updated_at = ?
       WHERE bbox_left < ? AND bbox_right > ?
         AND bbox_top < ? AND bbox_bottom > ?
         AND label IS NOT NULL`,
      [now, rectangle.right, rectangle.left, rectangle.bottom, rectangle.top]
    )
  } else {
    // Mark as 'out' for boxes that overlap with rectangle
    return db.exec(
      `UPDATE boxes
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
    `SELECT COUNT(*) as count FROM boxes WHERE label IS NOT NULL`
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
    `SELECT * FROM boxes
     WHERE label IS NULL
       AND (predicted_confidence IS NULL OR predicted_confidence < ?)
     ORDER BY predicted_confidence ASC, frame_index, box_index`,
    [confidenceThreshold]
  )
  return result.rows
}

/**
 * Set layout as approved.
 * @deprecated Layout approval is now managed via Supabase, not in the SQLite database
 */
export async function setLayoutApproved(db: CRSQLiteDatabase, approved: boolean): Promise<number> {
  // Layout approval is now managed via Supabase
  return 0
}

/**
 * Update crop region in layout parameters.
 */
export async function updateCropRegion(
  db: CRSQLiteDatabase,
  cropRegion: { left: number; top: number; right: number; bottom: number }
): Promise<number> {
  const result = await db.query<{ crop_region_version: number | null }>(
    `SELECT crop_region_version FROM layout_config LIMIT 1`
  )
  const currentVersion = result.rows[0]?.crop_region_version ?? 0

  return db.exec(
    `UPDATE layout_config
     SET crop_left = ?, crop_top = ?, crop_right = ?, crop_bottom = ?,
         crop_region_version = ?`,
    [cropRegion.left, cropRegion.top, cropRegion.right, cropRegion.bottom, currentVersion + 1]
  )
}

/**
 * Update layout parameters from Bayesian analysis.
 */
export interface LayoutParamsUpdate {
  verticalPosition?: number | null
  verticalStd?: number | null
  boxHeight?: number | null
  boxHeightStd?: number | null
  anchorType?: string | null
  anchorPosition?: number | null
}

export async function updateLayoutParams(
  db: CRSQLiteDatabase,
  params: LayoutParamsUpdate
): Promise<number> {
  return db.exec(
    `UPDATE layout_config
     SET vertical_center = ?,
         vertical_std = ?,
         box_height = ?,
         box_height_std = ?,
         anchor_type = ?,
         anchor_position = ?`,
    [
      params.verticalPosition ?? null,
      params.verticalStd ?? null,
      params.boxHeight ?? null,
      params.boxHeightStd ?? null,
      params.anchorType ?? null,
      params.anchorPosition ?? null,
    ]
  )
}

/**
 * Get distinct frame indices.
 */
export async function getFrameIndices(db: CRSQLiteDatabase): Promise<number[]> {
  const result = await db.query<{ frame_index: number }>(
    `SELECT DISTINCT frame_index FROM boxes ORDER BY frame_index`
  )
  return result.rows.map(row => row.frame_index)
}

// =============================================================================
// Caption Database Types
// =============================================================================

/**
 * Caption frame extent state values.
 */
export type CaptionFrameExtentState = 'predicted' | 'confirmed' | 'gap' | 'issue'

/**
 * Text status values.
 */
export type TextStatus = 'valid_caption' | 'no_caption' | 'illegible' | 'non_text' | 'partial'

/**
 * Raw row from caption_frame_extents table.
 */
export interface CaptionFrameExtentRow {
  id: number
  start_frame_index: number
  end_frame_index: number
  caption_frame_extents_state: CaptionFrameExtentState
  caption_frame_extents_pending: number
  caption_frame_extents_updated_at: string | null
  text: string | null
  text_pending: number
  text_status: TextStatus | null
  text_notes: string | null
  caption_ocr: string | null
  text_updated_at: string | null
  created_at: string
}

/**
 * Raw row from video_preferences table.
 */
export interface VideoPreferencesRow {
  id: number
  text_size: number | null
  padding_scale: number | null
  text_anchor: TextAnchor | null
}

/**
 * Caption queue annotation for list display.
 */
export interface CaptionQueueAnnotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  caption_frame_extents_state: CaptionFrameExtentState
  text: string | null
  text_pending: number
  text_status: TextStatus | null
  created_at: string
}

/**
 * Full caption annotation data.
 */
export interface CaptionAnnotationData {
  id: number
  start_frame_index: number
  end_frame_index: number
  caption_frame_extents_state: CaptionFrameExtentState
  caption_frame_extents_pending: number
  caption_frame_extents_updated_at: string | null
  text: string | null
  text_pending: number
  text_status: TextStatus | null
  text_notes: string | null
  caption_ocr: string | null
  text_updated_at: string | null
  created_at: string
}

/**
 * Video preferences for display.
 */
export interface VideoPreferencesResult {
  textSize: number
  paddingScale: number
  textAnchor: TextAnchor
}

/**
 * Caption queue result with progress info.
 */
export interface CaptionQueueResult {
  annotations: CaptionQueueAnnotation[]
  total: number
  completed: number
  pending: number
}

/**
 * Caption frame extents queue result for navigation.
 */
export interface CaptionFrameExtentsQueueResult {
  annotations: CaptionAnnotationData[]
  total: number
  completed: number
  pending: number
}

// =============================================================================
// Caption Database Queries
// =============================================================================

/**
 * Get text annotation queue - items needing text annotation.
 * Returns annotations where text is pending (text_status is null or text is null).
 */
export async function getTextAnnotationQueue(db: CRSQLiteDatabase): Promise<CaptionQueueResult> {
  // Get pending annotations (need text annotation)
  const pendingResult = await db.query<CaptionFrameExtentRow>(
    `SELECT * FROM caption_frame_extents
     WHERE (text_status IS NULL OR text IS NULL)
       AND caption_frame_extents_state IN ('confirmed', 'predicted')
     ORDER BY start_frame_index`
  )

  // Get total count for all workable annotations
  const totalResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM caption_frame_extents
     WHERE caption_frame_extents_state IN ('confirmed', 'predicted')`
  )

  // Get completed count
  const completedResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM caption_frame_extents
     WHERE caption_frame_extents_state IN ('confirmed', 'predicted')
       AND text_status IS NOT NULL AND text IS NOT NULL`
  )

  const total = totalResult.rows[0]?.count ?? 0
  const completed = completedResult.rows[0]?.count ?? 0

  return {
    annotations: pendingResult.rows.map(row => ({
      id: row.id,
      start_frame_index: row.start_frame_index,
      end_frame_index: row.end_frame_index,
      caption_frame_extents_state: row.caption_frame_extents_state,
      text: row.text,
      text_pending: row.text_pending,
      text_status: row.text_status,
      created_at: row.created_at,
    })),
    total,
    completed,
    pending: pendingResult.rows.length,
  }
}

/**
 * Get caption frame extents queue - items needing frame extent annotation.
 * Returns annotations that are workable (predicted or gap state).
 */
export async function getCaptionFrameExtentsQueue(
  db: CRSQLiteDatabase,
  options?: { startFrame?: number; endFrame?: number; workable?: boolean; limit?: number }
): Promise<CaptionFrameExtentsQueueResult> {
  let whereClause = '1=1'
  const params: unknown[] = []

  if (options?.startFrame !== undefined) {
    whereClause += ' AND end_frame_index >= ?'
    params.push(options.startFrame)
  }

  if (options?.endFrame !== undefined) {
    whereClause += ' AND start_frame_index <= ?'
    params.push(options.endFrame)
  }

  if (options?.workable) {
    whereClause += ` AND caption_frame_extents_state IN ('predicted', 'gap')`
  }

  let sql = `SELECT * FROM caption_frame_extents WHERE ${whereClause} ORDER BY start_frame_index`
  if (options?.limit) {
    sql += ` LIMIT ?`
    params.push(options.limit)
  }

  const result = await db.query<CaptionFrameExtentRow>(sql, params)

  // Get total count
  const totalResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM caption_frame_extents`
  )

  // Get completed count (confirmed state)
  const completedResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM caption_frame_extents
     WHERE caption_frame_extents_state = 'confirmed'`
  )

  // Get pending count (workable items)
  const pendingResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM caption_frame_extents
     WHERE caption_frame_extents_state IN ('predicted', 'gap')`
  )

  return {
    annotations: result.rows,
    total: totalResult.rows[0]?.count ?? 0,
    completed: completedResult.rows[0]?.count ?? 0,
    pending: pendingResult.rows[0]?.count ?? 0,
  }
}

/**
 * Get a single annotation by ID.
 */
export async function getCaptionAnnotation(
  db: CRSQLiteDatabase,
  annotationId: number
): Promise<CaptionAnnotationData | null> {
  const result = await db.query<CaptionFrameExtentRow>(
    `SELECT * FROM caption_frame_extents WHERE id = ?`,
    [annotationId]
  )
  return result.rows[0] ?? null
}

/**
 * Get annotations for a frame range.
 */
export async function getCaptionAnnotationsForRange(
  db: CRSQLiteDatabase,
  startFrame: number,
  endFrame: number
): Promise<CaptionAnnotationData[]> {
  const result = await db.query<CaptionFrameExtentRow>(
    `SELECT * FROM caption_frame_extents
     WHERE start_frame_index <= ? AND end_frame_index >= ?
     ORDER BY start_frame_index`,
    [endFrame, startFrame]
  )
  return result.rows
}

/**
 * Update annotation text, status, and notes.
 */
export async function updateCaptionAnnotationText(
  db: CRSQLiteDatabase,
  annotationId: number,
  text: string,
  textStatus: TextStatus,
  textNotes: string
): Promise<number> {
  const now = new Date().toISOString()
  return db.exec(
    `UPDATE caption_frame_extents
     SET text = ?, text_status = ?, text_notes = ?, text_updated_at = ?, text_pending = 0
     WHERE id = ?`,
    [text, textStatus, textNotes, now, annotationId]
  )
}

/**
 * Update annotation frame extents and state.
 */
export async function updateCaptionFrameExtents(
  db: CRSQLiteDatabase,
  annotationId: number,
  startFrameIndex: number,
  endFrameIndex: number,
  state: CaptionFrameExtentState
): Promise<number> {
  const now = new Date().toISOString()
  return db.exec(
    `UPDATE caption_frame_extents
     SET start_frame_index = ?, end_frame_index = ?,
         caption_frame_extents_state = ?, caption_frame_extents_updated_at = ?,
         caption_frame_extents_pending = 0
     WHERE id = ?`,
    [startFrameIndex, endFrameIndex, state, now, annotationId]
  )
}

/**
 * Create a new annotation (gap fill or split).
 */
export async function createCaptionAnnotation(
  db: CRSQLiteDatabase,
  startFrameIndex: number,
  endFrameIndex: number,
  state: CaptionFrameExtentState = 'gap'
): Promise<number> {
  const now = new Date().toISOString()
  return db.exec(
    `INSERT INTO caption_frame_extents
     (start_frame_index, end_frame_index, caption_frame_extents_state,
      caption_frame_extents_pending, created_at)
     VALUES (?, ?, ?, 1, ?)`,
    [startFrameIndex, endFrameIndex, state, now]
  )
}

/**
 * Delete an annotation.
 */
export async function deleteCaptionAnnotation(
  db: CRSQLiteDatabase,
  annotationId: number
): Promise<number> {
  return db.exec(`DELETE FROM caption_frame_extents WHERE id = ?`, [annotationId])
}

/**
 * Get video preferences from captions.db.
 */
export async function getVideoPreferences(db: CRSQLiteDatabase): Promise<VideoPreferencesResult> {
  const result = await db.query<VideoPreferencesRow>(`SELECT * FROM video_preferences LIMIT 1`)

  const row = result.rows[0]
  return {
    textSize: row?.text_size ?? 3.0,
    paddingScale: row?.padding_scale ?? 0.75,
    textAnchor: row?.text_anchor ?? 'left',
  }
}

/**
 * Update video preferences in captions.db.
 */
export async function updateVideoPreferences(
  db: CRSQLiteDatabase,
  preferences: Partial<VideoPreferencesResult>
): Promise<number> {
  // Check if row exists
  const existingResult = await db.query<{ id: number }>(`SELECT id FROM video_preferences LIMIT 1`)

  if (existingResult.rows.length === 0) {
    // Insert new row
    return db.exec(
      `INSERT INTO video_preferences (text_size, padding_scale, text_anchor) VALUES (?, ?, ?)`,
      [
        preferences.textSize ?? 3.0,
        preferences.paddingScale ?? 0.75,
        preferences.textAnchor ?? 'left',
      ]
    )
  }

  // Build update query dynamically
  const updates: string[] = []
  const params: unknown[] = []

  if (preferences.textSize !== undefined) {
    updates.push('text_size = ?')
    params.push(preferences.textSize)
  }
  if (preferences.paddingScale !== undefined) {
    updates.push('padding_scale = ?')
    params.push(preferences.paddingScale)
  }
  if (preferences.textAnchor !== undefined) {
    updates.push('text_anchor = ?')
    params.push(preferences.textAnchor)
  }

  if (updates.length === 0) {
    return 0
  }

  return db.exec(`UPDATE video_preferences SET ${updates.join(', ')}`, params)
}

/**
 * Get progress stats for caption workflow.
 */
export async function getCaptionWorkflowProgress(
  db: CRSQLiteDatabase
): Promise<{ total: number; completed: number; pending: number; progress: number }> {
  const totalResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM caption_frame_extents
     WHERE caption_frame_extents_state IN ('confirmed', 'predicted')`
  )

  const completedResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM caption_frame_extents
     WHERE caption_frame_extents_state IN ('confirmed', 'predicted')
       AND text_status IS NOT NULL`
  )

  const total = totalResult.rows[0]?.count ?? 0
  const completed = completedResult.rows[0]?.count ?? 0

  return {
    total,
    completed,
    pending: total - completed,
    progress: total > 0 ? (completed / total) * 100 : 0,
  }
}

/**
 * Get progress stats for caption frame extents workflow.
 */
export async function getCaptionFrameExtentsWorkflowProgress(
  db: CRSQLiteDatabase
): Promise<{ total: number; completed: number; pending: number; progress: number }> {
  const totalResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM caption_frame_extents`
  )

  const completedResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM caption_frame_extents
     WHERE caption_frame_extents_state = 'confirmed'`
  )

  const pendingResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM caption_frame_extents
     WHERE caption_frame_extents_state IN ('predicted', 'gap')`
  )

  const total = totalResult.rows[0]?.count ?? 0
  const completed = completedResult.rows[0]?.count ?? 0

  return {
    total,
    completed,
    pending: pendingResult.rows[0]?.count ?? 0,
    progress: total > 0 ? (completed / total) * 100 : 0,
  }
}

/**
 * Handle overlap resolution when updating frame extents.
 * This creates gaps for any frames that are no longer covered.
 */
export async function resolveFrameExtentOverlaps(
  db: CRSQLiteDatabase,
  annotationId: number,
  newStartFrame: number,
  newEndFrame: number
): Promise<CaptionAnnotationData[]> {
  // Get the current annotation
  const current = await getCaptionAnnotation(db, annotationId)
  if (!current) return []

  const createdGaps: CaptionAnnotationData[] = []
  const oldStart = current.start_frame_index
  const oldEnd = current.end_frame_index

  // Check if we need to create gaps
  // If new start is after old start, create gap for [oldStart, newStart-1]
  if (newStartFrame > oldStart) {
    await createCaptionAnnotation(db, oldStart, newStartFrame - 1, 'gap')
    const newGap = await getCaptionAnnotationsForRange(db, oldStart, newStartFrame - 1)
    createdGaps.push(...newGap.filter(g => g.caption_frame_extents_state === 'gap'))
  }

  // If new end is before old end, create gap for [newEnd+1, oldEnd]
  if (newEndFrame < oldEnd) {
    await createCaptionAnnotation(db, newEndFrame + 1, oldEnd, 'gap')
    const newGap = await getCaptionAnnotationsForRange(db, newEndFrame + 1, oldEnd)
    createdGaps.push(...newGap.filter(g => g.caption_frame_extents_state === 'gap'))
  }

  return createdGaps
}
