/**
 * Layout queue service for annotation workflow.
 *
 * Provides prioritized frame queue for layout annotation and mislabel detection.
 * This service helps users focus on frames that need the most attention.
 */

import type Database from 'better-sqlite3'

import type { BoxLabel, TextAnchor } from '~/types/enums'
import { getAnnotationDatabase } from '~/utils/database'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Python OCR annotation format from paddleocr output.
 * Format: [text, confidence, [x, y, width, height]]
 */
type PythonOCRAnnotation = [string, number, [number, number, number, number]]

/**
 * Database layout configuration row.
 */
interface VideoLayoutConfigRow {
  id: number
  frame_width: number
  frame_height: number
  crop_left: number
  crop_top: number
  crop_right: number
  crop_bottom: number
  selection_left: number | null
  selection_top: number | null
  selection_right: number | null
  selection_bottom: number | null
  selection_mode: 'hard' | 'soft' | 'disabled'
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
  crop_bounds_version: number
}

/**
 * Frame information for the layout queue.
 */
export interface FrameQueueItem {
  frameIndex: number
  totalBoxCount: number
  /** Estimated caption box count using heuristics */
  captionBoxCount: number
  /** Lowest OCR confidence among unannotated boxes in frame */
  minConfidence: number
  /** Whether frame has any box annotations */
  hasAnnotations: boolean
  /** Whether frame has boxes that haven't been annotated */
  hasUnannotatedBoxes: boolean
  /** URL to the frame image */
  imageUrl: string
}

/**
 * Layout configuration (camelCase for API).
 */
export interface LayoutConfig {
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
  selectionMode: 'hard' | 'soft' | 'disabled'
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
  cropBoundsVersion: number
}

/**
 * Result of getting the layout queue.
 */
export interface LayoutQueueResult {
  frames: FrameQueueItem[]
  layoutConfig: LayoutConfig
  layoutApproved: boolean
}

/**
 * Potential mislabel detected in the dataset.
 */
export interface PotentialMislabel {
  frameIndex: number
  boxIndex: number
  boxText: string
  userLabel: BoxLabel
  predictedLabel: BoxLabel | null
  predictedConfidence: number | null
  boxTop: number
  topDeviation: number
  issueType: string
}

/**
 * Cluster statistics for caption box positions.
 */
export interface ClusterStats {
  avgTop: number
  avgBottom: number
}

/**
 * Summary of mislabel detection results.
 */
export interface MislabelSummary {
  total: number
  modelDisagreements: number
  verticalOutliers: number
  highConfidenceDisagreements: number
}

/**
 * Result of mislabel review.
 */
export interface MislabelReviewResult {
  potentialMislabels: PotentialMislabel[]
  clusterStats: ClusterStats | null
  summary: MislabelSummary
}

/**
 * Processing status from the database.
 */
type ProcessingStatus =
  | 'uploading'
  | 'upload_complete'
  | 'extracting_frames'
  | 'analyzing_layout'
  | 'processing_complete'
  | 'error'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Transform database layout config to domain object.
 */
function transformLayoutConfig(row: VideoLayoutConfigRow): LayoutConfig {
  return {
    frameWidth: row.frame_width,
    frameHeight: row.frame_height,
    cropLeft: row.crop_left,
    cropTop: row.crop_top,
    cropRight: row.crop_right,
    cropBottom: row.crop_bottom,
    selectionLeft: row.selection_left,
    selectionTop: row.selection_top,
    selectionRight: row.selection_right,
    selectionBottom: row.selection_bottom,
    selectionMode: row.selection_mode,
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
    cropBoundsVersion: row.crop_bounds_version,
  }
}

/**
 * Estimate caption box count using crop bounds heuristic.
 *
 * Boxes inside the crop region are likely captions.
 *
 * @param ocrAnnotations - OCR annotations in Python format
 * @param frameWidth - Frame width in pixels
 * @param frameHeight - Frame height in pixels
 * @param cropBounds - Crop region bounds
 * @returns Estimated number of caption boxes
 */
export function estimateCaptionBoxCount(
  ocrAnnotations: PythonOCRAnnotation[],
  frameWidth: number,
  frameHeight: number,
  cropBounds: { left: number; top: number; right: number; bottom: number }
): number {
  if (!ocrAnnotations || ocrAnnotations.length === 0) {
    return 0
  }

  let count = 0

  for (const annotation of ocrAnnotations) {
    // OCR annotation format: [text, confidence, [x, y, width, height]]
    // Coordinates are fractional [0-1]
    // IMPORTANT: y is measured from BOTTOM of image, not top
    const [, , [x, y, width, height]] = annotation

    // Convert fractional to pixels
    const boxLeft = Math.floor(x * frameWidth)
    // Convert y from bottom-referenced to top-referenced
    const boxBottom = Math.floor((1 - y) * frameHeight)
    const boxTop = boxBottom - Math.floor(height * frameHeight)
    const boxRight = boxLeft + Math.floor(width * frameWidth)

    // Check if box is inside crop bounds
    const insideCrop =
      boxLeft >= cropBounds.left &&
      boxTop >= cropBounds.top &&
      boxRight <= cropBounds.right &&
      boxBottom <= cropBounds.bottom

    if (insideCrop) {
      count++
    }
  }

  return count
}

/**
 * Check video processing status and throw appropriate errors.
 *
 * @param db - Database connection
 * @returns Processing status
 * @throws Error with appropriate message for non-ready states
 */
function checkProcessingStatus(db: Database.Database): ProcessingStatus {
  const processingStatus = db.prepare('SELECT status FROM processing_status WHERE id = 1').get() as
    | { status: ProcessingStatus }
    | undefined

  if (!processingStatus) {
    throw new Error('Processing status not found')
  }

  const inProgressStatuses: ProcessingStatus[] = [
    'uploading',
    'upload_complete',
    'extracting_frames',
    'analyzing_layout',
  ]

  if (inProgressStatuses.includes(processingStatus.status)) {
    const error = new Error('Video is still processing. Please wait for processing to complete.')
    ;(error as Error & { status: number }).status = 425
    ;(error as Error & { processingStatus: string }).processingStatus = processingStatus.status
    throw error
  }

  if (processingStatus.status === 'error') {
    throw new Error('Video processing failed. Cannot load layout annotation.')
  }

  if (processingStatus.status !== 'processing_complete') {
    throw new Error(`Unexpected processing status: ${processingStatus.status}`)
  }

  return processingStatus.status
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Get the prioritized layout queue for a video.
 *
 * Returns frames ordered by the minimum prediction confidence of their
 * unannotated boxes. Frames with lower confidence predictions appear first,
 * as they are most likely to need human annotation.
 *
 * @param videoId - Video identifier
 * @param limit - Maximum number of frames to return (default: 11)
 * @returns Layout queue result with frames and config, or null if not configured
 * @throws Error if databases are not found
 */
export async function getLayoutQueue(
  videoId: string,
  limit: number = 11
): Promise<LayoutQueueResult | null> {
  // Get layout config from layout.db
  const layoutResult = await getAnnotationDatabase(videoId, { dbName: 'layout.db' })
  if (!layoutResult.success) {
    throw new Error('layout.db not found')
  }

  let layoutConfig: VideoLayoutConfigRow | undefined
  try {
    // Get the most recent config (append-only table)
    layoutConfig = layoutResult.db
      .prepare('SELECT * FROM video_layout_config ORDER BY created_at DESC LIMIT 1')
      .get() as VideoLayoutConfigRow | undefined
  } finally {
    layoutResult.db.close()
  }

  // If no layout config, return null (not configured yet)
  if (!layoutConfig) {
    return null
  }

  // Get OCR data from fullOCR.db
  const ocrResult = await getAnnotationDatabase(videoId, { dbName: 'fullOCR.db' })
  if (!ocrResult.success) {
    throw new Error('fullOCR.db not found')
  }

  // Get box labels from layout.db
  const layoutDbResult = await getAnnotationDatabase(videoId, { dbName: 'layout.db' })
  if (!layoutDbResult.success) {
    throw new Error('layout.db not found')
  }

  const ocrDb = ocrResult.db
  const layoutDb = layoutDbResult.db

  try {
    // Load frames from full_frame_ocr table
    const frameRows = ocrDb
      .prepare('SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index')
      .all() as Array<{ frame_index: number }>

    if (frameRows.length === 0) {
      throw new Error('No OCR data found in database. Run full_frames analysis first.')
    }

    // Pre-load all box labels from layout.db for efficiency
    const allLabels = layoutDb
      .prepare('SELECT frame_index, box_index FROM full_frame_box_labels WHERE label_source = ?')
      .all('user') as Array<{ frame_index: number; box_index: number }>

    // Build a map of frame -> Set of labeled box indices
    const labelsByFrame = new Map<number, Set<number>>()
    for (const { frame_index, box_index } of allLabels) {
      if (!labelsByFrame.has(frame_index)) {
        labelsByFrame.set(frame_index, new Set())
      }
      labelsByFrame.get(frame_index)!.add(box_index)
    }

    // Calculate caption box count for each frame
    const frameInfos: FrameQueueItem[] = frameRows.map(({ frame_index: frameIndex }) => {
      // Get all OCR boxes for this frame
      const ocrBoxes = ocrDb
        .prepare(
          `
          SELECT box_index, text, confidence, bbox_left, bbox_top, bbox_right, bbox_bottom
          FROM full_frame_ocr
          WHERE frame_index = ?
          ORDER BY box_index
        `
        )
        .all(frameIndex) as Array<{
        box_index: number
        text: string
        confidence: number
        bbox_left: number
        bbox_top: number
        bbox_right: number
        bbox_bottom: number
      }>

      const totalBoxCount = ocrBoxes.length

      // Count boxes inside crop bounds (likely caption boxes)
      let captionBoxCount = 0
      for (const box of ocrBoxes) {
        const insideCrop =
          box.bbox_left >= layoutConfig.crop_left &&
          box.bbox_top >= layoutConfig.crop_top &&
          box.bbox_right <= layoutConfig.crop_right &&
          box.bbox_bottom <= layoutConfig.crop_bottom
        if (insideCrop) captionBoxCount++
      }

      // Get labeled box indices for this frame
      const labeledBoxIndices = labelsByFrame.get(frameIndex) ?? new Set<number>()

      // Count unlabeled boxes - default confidence 0.5 since predictions not cached yet
      const unlabeledCount = ocrBoxes.filter(box => !labeledBoxIndices.has(box.box_index)).length

      // All boxes labeled = push to end of queue (high confidence)
      const minConfidence = unlabeledCount > 0 ? 0.5 : 1.0

      const hasLabels = labeledBoxIndices.size > 0
      const hasUnlabeledBoxes = unlabeledCount > 0

      return {
        frameIndex,
        totalBoxCount,
        captionBoxCount,
        minConfidence,
        hasAnnotations: hasLabels,
        hasUnannotatedBoxes: hasUnlabeledBoxes,
        imageUrl: `/api/full-frames/${encodeURIComponent(videoId)}/${frameIndex}.jpg`,
      }
    })

    // Filter out frames with no unlabeled boxes, then sort by minimum confidence
    const framesWithUnlabeledBoxes = frameInfos.filter(f => f.hasUnannotatedBoxes)
    const topFrames = framesWithUnlabeledBoxes
      .sort((a, b) => a.minConfidence - b.minConfidence)
      .slice(0, limit)

    // layoutApproved: for now, always false until we add this to Supabase
    const layoutApproved = false

    return {
      frames: topFrames,
      layoutConfig: transformLayoutConfig(layoutConfig),
      layoutApproved,
    }
  } finally {
    ocrDb.close()
    layoutDb.close()
  }
}

/**
 * Find potential mislabels in the dataset.
 *
 * Identifies boxes where the model disagrees with user labels or where
 * boxes labeled as 'in' have unusual vertical positions compared to the
 * caption cluster. These may indicate labeling errors that need review.
 *
 * Detection criteria:
 * - Model disagreements: predicted label differs from user label
 * - High-confidence disagreements: model confidence > 0.7
 * - Vertical outliers: 'in' boxes with top deviation > 50px from cluster average
 *
 * @param videoId - Video identifier
 * @param limit - Maximum number of mislabels to return (default: 100)
 * @returns Mislabel review result with potential mislabels and statistics
 * @throws Error if database is not found
 */
export async function findPotentialMislabels(
  videoId: string,
  limit: number = 100
): Promise<MislabelReviewResult> {
  const result = await getAnnotationDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Get main cluster statistics from labeled 'in' boxes
    const clusterStats = db
      .prepare(
        `
        SELECT
          AVG(box_top) as avg_top,
          AVG(box_bottom) as avg_bottom
        FROM full_frame_box_labels
        WHERE label = 'in' AND annotation_source = 'full_frame'
      `
      )
      .get() as { avg_top: number; avg_bottom: number } | undefined

    // No labeled boxes yet - return empty result
    if (!clusterStats?.avg_top) {
      return {
        potentialMislabels: [],
        clusterStats: null,
        summary: {
          total: 0,
          modelDisagreements: 0,
          verticalOutliers: 0,
          highConfidenceDisagreements: 0,
        },
      }
    }

    const avgTop = clusterStats.avg_top

    // Find potential mislabels:
    // - Model disagreements (predicted != user label)
    // - Vertical outliers ('in' boxes far from cluster average)
    const potentialMislabels = db
      .prepare(
        `
        SELECT
          frame_index as frameIndex,
          box_index as boxIndex,
          box_text as boxText,
          label as userLabel,
          predicted_label as predictedLabel,
          predicted_confidence as predictedConfidence,
          box_top as boxTop,
          ABS(box_top - ?) as topDeviation,
          CASE
            WHEN predicted_label IS NOT NULL AND predicted_label != label AND predicted_confidence > 0.7
              THEN 'High-confidence model disagreement'
            WHEN predicted_label IS NOT NULL AND predicted_label != label
              THEN 'Model disagreement'
            WHEN label = 'in' AND ABS(box_top - ?) > 100
              THEN 'Major vertical outlier (>100px)'
            WHEN label = 'in' AND ABS(box_top - ?) > 50
              THEN 'Vertical outlier (>50px)'
            ELSE 'Minor deviation'
          END as issueType
        FROM full_frame_box_labels
        WHERE label_source = 'user'
          AND annotation_source = 'full_frame'
          AND (
            (predicted_label IS NOT NULL AND predicted_label != label)
            OR (label = 'in' AND ABS(box_top - ?) > 50)
          )
        ORDER BY
          CASE WHEN predicted_label != label AND predicted_confidence > 0.7 THEN 0 ELSE 1 END,
          ABS(box_top - ?) DESC,
          frame_index,
          box_index
        LIMIT ?
      `
      )
      .all(avgTop, avgTop, avgTop, avgTop, avgTop, limit) as PotentialMislabel[]

    // Calculate summary statistics
    const modelDisagreements = potentialMislabels.filter(
      m => m.predictedLabel && m.predictedLabel !== m.userLabel
    ).length
    const verticalOutliers = potentialMislabels.filter(m => m.topDeviation > 50).length
    const highConfidenceDisagreements = potentialMislabels.filter(
      m =>
        m.predictedLabel &&
        m.predictedLabel !== m.userLabel &&
        m.predictedConfidence !== null &&
        m.predictedConfidence > 0.7
    ).length

    return {
      potentialMislabels,
      clusterStats: {
        avgTop: Math.round(clusterStats.avg_top),
        avgBottom: Math.round(clusterStats.avg_bottom),
      },
      summary: {
        total: potentialMislabels.length,
        modelDisagreements,
        verticalOutliers,
        highConfidenceDisagreements,
      },
    }
  } finally {
    db.close()
  }
}

/**
 * Get frame statistics for progress tracking.
 *
 * @param videoId - Video identifier
 * @returns Statistics about frame annotation progress
 * @throws Error if database is not found
 */
export async function getFrameAnnotationStats(videoId: string): Promise<{
  totalFrames: number
  framesWithAnnotations: number
  totalBoxes: number
  annotatedBoxes: number
  completionPercentage: number
}> {
  const result = await getAnnotationDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Get total frames and boxes
    const frameStats = db
      .prepare(
        `
        SELECT
          COUNT(DISTINCT frame_index) as total_frames,
          COUNT(*) as total_boxes
        FROM full_frame_ocr
      `
      )
      .get() as { total_frames: number; total_boxes: number }

    // Get frames with annotations and annotated box count
    const annotationStats = db
      .prepare(
        `
        SELECT
          COUNT(DISTINCT frame_index) as frames_with_annotations,
          COUNT(*) as annotated_boxes
        FROM full_frame_box_labels
        WHERE label_source = 'user'
      `
      )
      .get() as { frames_with_annotations: number; annotated_boxes: number }

    const completionPercentage =
      frameStats.total_boxes > 0
        ? Math.round((annotationStats.annotated_boxes / frameStats.total_boxes) * 100)
        : 0

    return {
      totalFrames: frameStats.total_frames,
      framesWithAnnotations: annotationStats.frames_with_annotations,
      totalBoxes: frameStats.total_boxes,
      annotatedBoxes: annotationStats.annotated_boxes,
      completionPercentage,
    }
  } finally {
    db.close()
  }
}
