/**
 * Layout analysis service for video annotation setup.
 *
 * Provides functionality for analyzing OCR data to determine optimal crop bounds,
 * layout parameters, and anchor types for caption detection.
 */

import { getAnnotationDatabase, getWritableDatabase } from '~/utils/database'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Python OCR annotation format from paddleocr output.
 * Format: [text, confidence, [x, y, width, height]]
 */
type PythonOCRAnnotation = [string, number, [number, number, number, number]]

/**
 * Legacy frame OCR data format.
 */
interface FrameOCR {
  frame_index: number
  ocr_text: string
  ocr_annotations: string
  ocr_confidence: number
}

/**
 * Database layout configuration row.
 */
interface VideoLayoutConfigRow {
  id?: number
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
  anchor_type: 'left' | 'center' | 'right' | null
  anchor_position: number | null
  top_edge_std: number | null
  bottom_edge_std: number | null
  horizontal_std_slope: number | null
  horizontal_std_intercept: number | null
  crop_bounds_version: number
  analysis_model_version: string | null
  updated_at: string
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
  anchorType: 'left' | 'center' | 'right' | null
  anchorPosition: number | null
  topEdgeStd: number | null
  bottomEdgeStd: number | null
  horizontalStdSlope: number | null
  horizontalStdIntercept: number | null
  cropBoundsVersion: number
  analysisModelVersion: string | null
}

/**
 * Layout parameters from OCR analysis.
 */
export interface LayoutParams {
  verticalPosition: number
  verticalStd: number
  boxHeight: number
  boxHeightStd: number
  anchorType: 'left' | 'center' | 'right'
  anchorPosition: number
  topEdgeStd: number
  bottomEdgeStd: number
}

/**
 * Crop bounds in pixels.
 */
export interface CropBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Selection bounds in pixels.
 */
export interface SelectionBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Statistics from OCR analysis.
 */
export interface AnalysisStats {
  totalBoxes: number
  captionBoxes: number
  verticalPosition: number
  boxHeight: number
  topEdgeStd: number
  bottomEdgeStd: number
}

/**
 * Input for updating layout configuration.
 */
export interface UpdateLayoutConfigInput {
  cropBounds?: CropBounds
  selectionBounds?: SelectionBounds
  selectionMode?: 'hard' | 'soft' | 'disabled'
  layoutParams?: Partial<LayoutParams>
}

/**
 * Result of resetting crop bounds.
 */
export interface ResetCropBoundsResult {
  newCropBounds: CropBounds
  analysisData: AnalysisStats
}

/**
 * Box statistics from OCR analysis.
 */
interface BoxStats {
  minTop: number
  maxBottom: number
  minLeft: number
  maxRight: number
  topEdges: number[]
  bottomEdges: number[]
  centerYValues: number[]
  heightValues: number[]
  widthValues: number[]
  leftEdges: number[]
  rightEdges: number[]
  centerXValues: number[]
}

/**
 * Density analysis result for edge detection.
 */
interface DensityAnalysisResult {
  density: number[]
  derivatives: number[]
  maxPositiveDerivative: number
  maxNegativeDerivative: number
  positiveEdgePos: number
  negativeEdgePos: number
}

/**
 * Anchor detection result.
 */
interface AnchorInfo {
  anchorType: 'left' | 'center' | 'right'
  anchorPosition: number
  leftEdgeSharpness: number
  rightEdgeSharpness: number
}

/**
 * OCR analysis result.
 */
interface OCRAnalysisResult {
  cropBounds: CropBounds
  layoutParams: LayoutParams
  stats: AnalysisStats
}

// =============================================================================
// Helper Functions - Statistical
// =============================================================================

/**
 * Calculate mode (most common value) from array of numbers.
 * Groups values into bins and finds the bin with highest frequency.
 */
function calculateMode(values: number[], binSize: number = 5): number {
  if (values.length === 0) return 0

  const bins = new Map<number, number>()
  for (const value of values) {
    const bin = Math.round(value / binSize) * binSize
    bins.set(bin, (bins.get(bin) ?? 0) + 1)
  }

  let maxCount = 0
  let modeValue = 0
  for (const [bin, count] of bins) {
    if (count > maxCount) {
      maxCount = count
      modeValue = bin
    }
  }

  return modeValue
}

/**
 * Calculate standard deviation of values.
 */
function calculateStd(values: number[], mean: number): number {
  if (values.length === 0) return 0

  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Filter outliers from an array using IQR method.
 * Uses k=3.0 (less aggressive than standard 1.5) to keep more valid boxes.
 */
function filterOutliers(values: number[]): number[] {
  if (values.length < 10) return values

  const sorted = [...values].sort((a, b) => a - b)
  const q1Index = Math.floor(sorted.length * 0.25)
  const q3Index = Math.floor(sorted.length * 0.75)
  const q1 = sorted[q1Index] ?? 0
  const q3 = sorted[q3Index] ?? 0
  const iqr = q3 - q1

  const k = 3.0
  const lowerBound = q1 - k * iqr
  const upperBound = q3 + k * iqr

  const filtered = values.filter(v => v >= lowerBound && v <= upperBound)

  // Safety: if we filter out more than 10% of values, keep original
  if (filtered.length < values.length * 0.9) {
    return values
  }

  return filtered
}

// =============================================================================
// Helper Functions - Box Analysis
// =============================================================================

/**
 * Collect box statistics from OCR frames.
 */
function collectBoxStatistics(
  frames: FrameOCR[],
  frameWidth: number,
  frameHeight: number
): { stats: BoxStats; totalBoxes: number } {
  const stats: BoxStats = {
    minTop: frameHeight,
    maxBottom: 0,
    minLeft: frameWidth,
    maxRight: 0,
    topEdges: [],
    bottomEdges: [],
    centerYValues: [],
    heightValues: [],
    widthValues: [],
    leftEdges: [],
    rightEdges: [],
    centerXValues: [],
  }

  let totalBoxes = 0

  for (const frame of frames) {
    let ocrAnnotations: PythonOCRAnnotation[] = []
    try {
      ocrAnnotations = JSON.parse(frame.ocr_annotations || '[]')
    } catch {
      continue
    }

    for (const annotation of ocrAnnotations) {
      const [, , [x, y, width, height]] = annotation

      // Convert fractional to pixels (y is bottom-referenced)
      const boxLeft = Math.floor(x * frameWidth)
      const boxBottom = Math.floor((1 - y) * frameHeight)
      const boxTop = boxBottom - Math.floor(height * frameHeight)
      const boxRight = boxLeft + Math.floor(width * frameWidth)

      const boxCenterY = Math.floor((boxTop + boxBottom) / 2)
      const boxCenterX = Math.floor((boxLeft + boxRight) / 2)
      const boxHeight = boxBottom - boxTop
      const boxWidth = boxRight - boxLeft

      // Skip very small boxes (likely noise)
      if (boxHeight < 10 || boxWidth < 10) continue

      // Track bounds
      stats.minTop = Math.min(stats.minTop, boxTop)
      stats.maxBottom = Math.max(stats.maxBottom, boxBottom)
      stats.minLeft = Math.min(stats.minLeft, boxLeft)
      stats.maxRight = Math.max(stats.maxRight, boxRight)

      // Collect values
      stats.topEdges.push(boxTop)
      stats.bottomEdges.push(boxBottom)
      stats.centerYValues.push(boxCenterY)
      stats.heightValues.push(boxHeight)
      stats.widthValues.push(boxWidth)
      stats.leftEdges.push(boxLeft)
      stats.rightEdges.push(boxRight)
      stats.centerXValues.push(boxCenterX)

      totalBoxes++
    }
  }

  return { stats, totalBoxes }
}

/**
 * Apply outlier filtering to horizontal edge statistics.
 */
function applyHorizontalOutlierFiltering(stats: BoxStats): void {
  const originalLeftEdges = [...stats.leftEdges]
  const originalRightEdges = [...stats.rightEdges]
  const originalCenterXValues = [...stats.centerXValues]

  stats.leftEdges = filterOutliers(stats.leftEdges)
  stats.rightEdges = filterOutliers(stats.rightEdges)
  stats.centerXValues = filterOutliers(stats.centerXValues)

  // Safety: restore if filtering resulted in empty arrays
  if (stats.leftEdges.length === 0) stats.leftEdges = originalLeftEdges
  if (stats.rightEdges.length === 0) stats.rightEdges = originalRightEdges
  if (stats.centerXValues.length === 0) stats.centerXValues = originalCenterXValues
}

/**
 * Calculate density distribution and derivatives for edge detection.
 */
function calculateDensityAndDerivatives(
  size: number,
  fillDensity: (density: number[]) => void,
  defaultNegativeEdgePos: number
): DensityAnalysisResult {
  const density = new Array(size).fill(0) as number[]
  fillDensity(density)

  // Calculate derivatives
  const derivatives = new Array(size - 1).fill(0) as number[]
  for (let i = 0; i < size - 1; i++) {
    derivatives[i] = (density[i + 1] ?? 0) - (density[i] ?? 0)
  }

  // Find max positive derivative (edge where density increases)
  let maxPositiveDerivative = 0
  let positiveEdgePos = 0
  for (let i = 0; i < derivatives.length; i++) {
    const deriv = derivatives[i] ?? 0
    if (deriv > maxPositiveDerivative) {
      maxPositiveDerivative = deriv
      positiveEdgePos = i
    }
  }

  // Find max negative derivative (edge where density decreases)
  let maxNegativeDerivative = 0
  let negativeEdgePos = defaultNegativeEdgePos
  for (let i = 0; i < derivatives.length; i++) {
    const deriv = derivatives[i] ?? 0
    if (deriv < maxNegativeDerivative) {
      maxNegativeDerivative = deriv
      negativeEdgePos = i
    }
  }

  return {
    density,
    derivatives,
    maxPositiveDerivative,
    maxNegativeDerivative,
    positiveEdgePos,
    negativeEdgePos,
  }
}

/**
 * Determine anchor type and position based on horizontal density analysis.
 */
function determineAnchorType(
  horizontalAnalysis: DensityAnalysisResult,
  stats: BoxStats,
  frameWidth: number,
  boxWidth: number
): AnchorInfo {
  const meanCenterX =
    stats.centerXValues.reduce((sum, val) => sum + val, 0) / stats.centerXValues.length
  const frameCenterX = frameWidth / 2

  const centerOfMassNearFrameCenter = Math.abs(meanCenterX - frameCenterX) < boxWidth * 1.0
  const leftEdgeStrength = horizontalAnalysis.maxPositiveDerivative
  const rightEdgeStrength = Math.abs(horizontalAnalysis.maxNegativeDerivative)

  let anchorType: 'left' | 'center' | 'right'
  let anchorPosition: number

  if (
    centerOfMassNearFrameCenter &&
    Math.abs(leftEdgeStrength - rightEdgeStrength) < leftEdgeStrength * 0.3
  ) {
    anchorType = 'center'
    anchorPosition = Math.round(meanCenterX)
  } else if (leftEdgeStrength > rightEdgeStrength * 1.2) {
    anchorType = 'left'
    anchorPosition = horizontalAnalysis.positiveEdgePos
  } else if (rightEdgeStrength > leftEdgeStrength * 1.2) {
    anchorType = 'right'
    anchorPosition = horizontalAnalysis.negativeEdgePos
  } else {
    if (leftEdgeStrength >= rightEdgeStrength) {
      anchorType = 'left'
      anchorPosition = horizontalAnalysis.positiveEdgePos
    } else {
      anchorType = 'right'
      anchorPosition = horizontalAnalysis.negativeEdgePos
    }
  }

  const maxHorizontalDensity = Math.max(...horizontalAnalysis.density)
  const leftEdgeSharpness = horizontalAnalysis.maxPositiveDerivative / maxHorizontalDensity
  const rightEdgeSharpness =
    Math.abs(horizontalAnalysis.maxNegativeDerivative) / maxHorizontalDensity

  return { anchorType, anchorPosition, leftEdgeSharpness, rightEdgeSharpness }
}

/**
 * Calculate final crop bounds with adaptive padding.
 */
function calculateCropBoundsFromAnalysis(
  anchorInfo: AnchorInfo,
  verticalAnalysis: DensityAnalysisResult,
  stats: BoxStats,
  frameWidth: number,
  frameHeight: number,
  boxWidth: number,
  boxHeight: number
): CropBounds {
  const PADDING_FRACTION = 0.1
  const SHARPNESS_FACTOR = 2.0

  const maxVerticalDensity = Math.max(...verticalAnalysis.density)
  const topEdgeSharpness = verticalAnalysis.maxPositiveDerivative / maxVerticalDensity
  const bottomEdgeSharpness = Math.abs(verticalAnalysis.maxNegativeDerivative) / maxVerticalDensity

  // Adaptive vertical padding
  const topPaddingMultiplier = 1 + SHARPNESS_FACTOR * (1 - Math.min(1, topEdgeSharpness))
  const bottomPaddingMultiplier = 1 + SHARPNESS_FACTOR * (1 - Math.min(1, bottomEdgeSharpness))

  const topPadding = Math.ceil(boxHeight * PADDING_FRACTION * topPaddingMultiplier)
  const bottomPadding = Math.ceil(boxHeight * PADDING_FRACTION * bottomPaddingMultiplier)

  let cropTop = Math.max(0, verticalAnalysis.positiveEdgePos - topPadding)
  let cropBottom = Math.min(frameHeight, verticalAnalysis.negativeEdgePos + bottomPadding)

  // Horizontal bounds
  const leftAnchorPaddingMultiplier =
    1 + SHARPNESS_FACTOR * (1 - Math.min(1, anchorInfo.leftEdgeSharpness))
  const rightAnchorPaddingMultiplier =
    1 + SHARPNESS_FACTOR * (1 - Math.min(1, anchorInfo.rightEdgeSharpness))

  const baseDensePadding = boxWidth * PADDING_FRACTION
  const fixedSparsePadding = Math.ceil(boxWidth * 2)

  const minLeft = Math.min(...stats.leftEdges)
  const maxRight = Math.max(...stats.rightEdges)

  let cropLeft: number
  let cropRight: number

  if (anchorInfo.anchorType === 'center') {
    cropLeft = Math.max(0, minLeft - fixedSparsePadding)
    cropRight = Math.min(frameWidth, maxRight + fixedSparsePadding)
  } else if (anchorInfo.anchorType === 'left') {
    const leftPadding = Math.ceil(baseDensePadding * leftAnchorPaddingMultiplier)
    cropLeft = Math.max(0, anchorInfo.anchorPosition - leftPadding)
    cropRight = Math.min(frameWidth, maxRight + fixedSparsePadding)
  } else {
    cropLeft = Math.max(0, minLeft - fixedSparsePadding)
    const rightPadding = Math.ceil(baseDensePadding * rightAnchorPaddingMultiplier)
    cropRight = Math.min(frameWidth, anchorInfo.anchorPosition + rightPadding)
  }

  // NaN safety fallback
  if (isNaN(cropLeft) || isNaN(cropRight) || isNaN(cropTop) || isNaN(cropBottom)) {
    const fallbackPadding = 20
    cropLeft = isNaN(cropLeft) ? Math.max(0, minLeft - fallbackPadding) : cropLeft
    cropRight = isNaN(cropRight) ? Math.min(frameWidth, maxRight + fallbackPadding) : cropRight
    cropTop = isNaN(cropTop) ? Math.max(0, Math.min(...stats.topEdges) - fallbackPadding) : cropTop
    cropBottom = isNaN(cropBottom)
      ? Math.min(frameHeight, Math.max(...stats.bottomEdges) + fallbackPadding)
      : cropBottom
  }

  return { left: cropLeft, top: cropTop, right: cropRight, bottom: cropBottom }
}

/**
 * Analyze OCR boxes to determine optimal crop bounds and layout parameters.
 */
function analyzeOCRBoxes(
  frames: FrameOCR[],
  frameWidth: number,
  frameHeight: number
): OCRAnalysisResult {
  // Collect statistics
  const { stats, totalBoxes } = collectBoxStatistics(frames, frameWidth, frameHeight)

  if (totalBoxes === 0) {
    throw new Error('No OCR boxes found in video')
  }

  // Filter horizontal outliers
  applyHorizontalOutlierFiltering(stats)

  // Calculate modes and standard deviations
  const verticalPosition = calculateMode(stats.centerYValues, 5)
  const verticalStd = calculateStd(stats.centerYValues, verticalPosition)
  const boxHeight = calculateMode(stats.heightValues, 2)
  const boxHeightStd = calculateStd(stats.heightValues, boxHeight)
  const boxWidth = calculateMode(stats.widthValues, 2)

  // Calculate edge standard deviations
  const topMode = calculateMode(stats.topEdges, 5)
  const topEdgesFiltered = stats.topEdges.filter(val => Math.abs(val - topMode) < 100)
  const topEdgeStd = calculateStd(topEdgesFiltered, topMode)

  const bottomMode = calculateMode(stats.bottomEdges, 5)
  const bottomEdgesFiltered = stats.bottomEdges.filter(val => Math.abs(val - bottomMode) < 100)
  const bottomEdgeStd = calculateStd(bottomEdgesFiltered, bottomMode)

  // Horizontal density analysis for anchor detection
  const horizontalAnalysis = calculateDensityAndDerivatives(
    frameWidth,
    density => {
      for (let i = 0; i < stats.leftEdges.length; i++) {
        const left = stats.leftEdges[i] ?? 0
        const right = stats.rightEdges[i] ?? 0
        const centerY = stats.centerYValues[i] ?? 0

        if (Math.abs(centerY - verticalPosition) < verticalStd * 2) {
          for (let x = Math.max(0, left); x <= Math.min(frameWidth - 1, right); x++) {
            ;(density[x] as number)++
          }
        }
      }
    },
    frameWidth - 1
  )

  const anchorInfo = determineAnchorType(horizontalAnalysis, stats, frameWidth, boxWidth)

  // Vertical density analysis for top/bottom edge detection
  const verticalAnalysis = calculateDensityAndDerivatives(
    frameHeight,
    density => {
      for (let i = 0; i < stats.topEdges.length; i++) {
        const top = stats.topEdges[i] ?? 0
        const bottom = stats.bottomEdges[i] ?? 0

        for (let y = Math.max(0, top); y <= Math.min(frameHeight - 1, bottom); y++) {
          ;(density[y] as number)++
        }
      }
    },
    frameHeight - 1
  )

  // Calculate crop bounds
  const cropBounds = calculateCropBoundsFromAnalysis(
    anchorInfo,
    verticalAnalysis,
    stats,
    frameWidth,
    frameHeight,
    boxWidth,
    boxHeight
  )

  // Count caption boxes
  const captionBoxCount = stats.centerYValues.filter(
    y => Math.abs(y - verticalPosition) < verticalStd * 2
  ).length

  return {
    cropBounds,
    layoutParams: {
      verticalPosition,
      verticalStd,
      boxHeight,
      boxHeightStd,
      anchorType: anchorInfo.anchorType,
      anchorPosition: anchorInfo.anchorPosition,
      topEdgeStd,
      bottomEdgeStd,
    },
    stats: {
      totalBoxes,
      captionBoxes: captionBoxCount,
      verticalPosition,
      boxHeight,
      topEdgeStd,
      bottomEdgeStd,
    },
  }
}

// =============================================================================
// Helper Functions - Transform
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
    analysisModelVersion: row.analysis_model_version,
  }
}

// =============================================================================
// Service Functions
// =============================================================================

/**
 * Get the current layout configuration for a video.
 *
 * @param videoId - Video identifier
 * @returns Layout configuration, or null if not found
 * @throws Error if database is not found
 */
export function getLayoutConfig(videoId: string): LayoutConfig | null {
  const result = getAnnotationDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfigRow
      | undefined

    return layoutConfig ? transformLayoutConfig(layoutConfig) : null
  } finally {
    db.close()
  }
}

/**
 * Update the layout configuration.
 *
 * Increments the crop_bounds_version when crop bounds change to track
 * which model version was used for analysis.
 *
 * @param videoId - Video identifier
 * @param input - Layout configuration updates
 * @returns Updated layout configuration
 * @throws Error if database is not found
 */
export function updateLayoutConfig(videoId: string, input: UpdateLayoutConfigInput): LayoutConfig {
  const result = getWritableDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Build update query dynamically
    const updates: string[] = []
    const values: unknown[] = []

    if (input.cropBounds) {
      updates.push('crop_left = ?', 'crop_top = ?', 'crop_right = ?', 'crop_bottom = ?')
      values.push(
        input.cropBounds.left,
        input.cropBounds.top,
        input.cropBounds.right,
        input.cropBounds.bottom
      )
      updates.push('crop_bounds_version = crop_bounds_version + 1')
    }

    if (input.selectionBounds) {
      updates.push(
        'selection_left = ?',
        'selection_top = ?',
        'selection_right = ?',
        'selection_bottom = ?'
      )
      values.push(
        input.selectionBounds.left,
        input.selectionBounds.top,
        input.selectionBounds.right,
        input.selectionBounds.bottom
      )
    }

    if (input.selectionMode) {
      updates.push('selection_mode = ?')
      values.push(input.selectionMode)
    }

    if (input.layoutParams) {
      const lp = input.layoutParams
      if (lp.verticalPosition !== undefined) {
        updates.push('vertical_position = ?')
        values.push(lp.verticalPosition)
      }
      if (lp.verticalStd !== undefined) {
        updates.push('vertical_std = ?')
        values.push(lp.verticalStd)
      }
      if (lp.boxHeight !== undefined) {
        updates.push('box_height = ?')
        values.push(lp.boxHeight)
      }
      if (lp.boxHeightStd !== undefined) {
        updates.push('box_height_std = ?')
        values.push(lp.boxHeightStd)
      }
      if (lp.anchorType !== undefined) {
        updates.push('anchor_type = ?')
        values.push(lp.anchorType)
      }
      if (lp.anchorPosition !== undefined) {
        updates.push('anchor_position = ?')
        values.push(lp.anchorPosition)
      }
      if (lp.topEdgeStd !== undefined) {
        updates.push('top_edge_std = ?')
        values.push(lp.topEdgeStd)
      }
      if (lp.bottomEdgeStd !== undefined) {
        updates.push('bottom_edge_std = ?')
        values.push(lp.bottomEdgeStd)
      }
    }

    updates.push("updated_at = datetime('now')")

    if (updates.length > 1) {
      const sql = `UPDATE video_layout_config SET ${updates.join(', ')} WHERE id = 1`
      db.prepare(sql).run(...values)
    }

    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfigRow
      | undefined

    if (!layoutConfig) {
      throw new Error('Layout config not found after update')
    }

    return transformLayoutConfig(layoutConfig)
  } finally {
    db.close()
  }
}

/**
 * Reset crop bounds by re-analyzing OCR data.
 *
 * Uses caption boxes (predicted + user overrides) to determine optimal
 * crop bounds and layout parameters. Falls back to all boxes if no
 * caption boxes are available.
 *
 * @param videoId - Video identifier
 * @returns Reset result with new bounds and analysis data
 * @throws Error if database or required data is not found
 */
export function resetCropBounds(videoId: string): ResetCropBoundsResult {
  const result = getWritableDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Get current layout config for frame dimensions
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfigRow
      | undefined

    if (!layoutConfig) {
      throw new Error('Layout config not found')
    }

    // Get unique frame indices
    const frameIndices = db
      .prepare('SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index')
      .all() as Array<{ frame_index: number }>

    if (frameIndices.length === 0) {
      throw new Error('No OCR data found')
    }

    // Count caption boxes
    const captionBoxCount = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM full_frame_ocr o
        LEFT JOIN full_frame_box_labels l
          ON o.frame_index = l.frame_index
          AND o.box_index = l.box_index
          AND l.annotation_source = 'full_frame'
        WHERE (
          (l.label IS NULL AND o.predicted_label = 'in')
          OR (l.label_source = 'user' AND l.label = 'in')
        )
      `
      )
      .get() as { count: number }

    const useAllBoxesFallback = captionBoxCount.count === 0

    // Get frame indices with caption boxes
    const captionFrameIndices = db
      .prepare(
        useAllBoxesFallback
          ? 'SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index'
          : `
            SELECT DISTINCT o.frame_index
            FROM full_frame_ocr o
            LEFT JOIN full_frame_box_labels l
              ON o.frame_index = l.frame_index
              AND o.box_index = l.box_index
              AND l.annotation_source = 'full_frame'
            WHERE (
              (l.label IS NULL AND o.predicted_label = 'in')
              OR (l.label_source = 'user' AND l.label = 'in')
            )
            ORDER BY o.frame_index
          `
      )
      .all() as Array<{ frame_index: number }>

    // Build frames with caption boxes
    const frames: FrameOCR[] = captionFrameIndices.map(({ frame_index }) => {
      const boxes = db
        .prepare(
          useAllBoxesFallback
            ? `
              SELECT
                text as box_text,
                FLOOR(x * ?) as box_left,
                FLOOR((1 - y) * ?) - FLOOR(height * ?) as box_top,
                FLOOR(x * ?) + FLOOR(width * ?) as box_right,
                FLOOR((1 - y) * ?) as box_bottom
              FROM full_frame_ocr
              WHERE frame_index = ?
              ORDER BY box_index
            `
            : `
              SELECT
                o.text as box_text,
                FLOOR(o.x * ?) as box_left,
                FLOOR((1 - o.y) * ?) - FLOOR(o.height * ?) as box_top,
                FLOOR(o.x * ?) + FLOOR(o.width * ?) as box_right,
                FLOOR((1 - o.y) * ?) as box_bottom
              FROM full_frame_ocr o
              LEFT JOIN full_frame_box_labels l
                ON o.frame_index = l.frame_index
                AND o.box_index = l.box_index
                AND l.annotation_source = 'full_frame'
              WHERE o.frame_index = ?
                AND (
                  (l.label IS NULL AND o.predicted_label = 'in')
                  OR (l.label_source = 'user' AND l.label = 'in')
                )
              ORDER BY o.box_index
            `
        )
        .all(
          layoutConfig.frame_width,
          layoutConfig.frame_height,
          layoutConfig.frame_height,
          layoutConfig.frame_width,
          layoutConfig.frame_width,
          layoutConfig.frame_height,
          frame_index
        ) as Array<{
        box_text: string
        box_left: number
        box_top: number
        box_right: number
        box_bottom: number
      }>

      // Convert to legacy OCR format
      const ocrAnnotations = boxes.map(box => [
        box.box_text,
        1.0,
        [
          box.box_left / layoutConfig.frame_width,
          (layoutConfig.frame_height - box.box_bottom) / layoutConfig.frame_height,
          (box.box_right - box.box_left) / layoutConfig.frame_width,
          (box.box_bottom - box.box_top) / layoutConfig.frame_height,
        ],
      ])

      return {
        frame_index,
        ocr_text: boxes.map(b => b.box_text).join(' '),
        ocr_annotations: JSON.stringify(ocrAnnotations),
        ocr_confidence: 1.0,
      }
    })

    // Analyze OCR boxes
    const analysis = analyzeOCRBoxes(frames, layoutConfig.frame_width, layoutConfig.frame_height)

    // Get current model version
    const modelInfo = db
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as { model_version: string } | undefined

    // Update database
    db.prepare(
      `
      UPDATE video_layout_config
      SET crop_left = ?,
          crop_top = ?,
          crop_right = ?,
          crop_bottom = ?,
          crop_bounds_version = crop_bounds_version + 1,
          analysis_model_version = ?,
          vertical_position = ?,
          vertical_std = ?,
          box_height = ?,
          box_height_std = ?,
          anchor_type = ?,
          anchor_position = ?,
          top_edge_std = ?,
          bottom_edge_std = ?,
          updated_at = datetime('now')
      WHERE id = 1
    `
    ).run(
      analysis.cropBounds.left,
      analysis.cropBounds.top,
      analysis.cropBounds.right,
      analysis.cropBounds.bottom,
      modelInfo?.model_version ?? null,
      analysis.layoutParams.verticalPosition,
      analysis.layoutParams.verticalStd,
      analysis.layoutParams.boxHeight,
      analysis.layoutParams.boxHeightStd,
      analysis.layoutParams.anchorType,
      analysis.layoutParams.anchorPosition,
      analysis.layoutParams.topEdgeStd,
      analysis.layoutParams.bottomEdgeStd
    )

    return {
      newCropBounds: analysis.cropBounds,
      analysisData: analysis.stats,
    }
  } finally {
    db.close()
  }
}

/**
 * Set the layout approved status.
 *
 * @param videoId - Video identifier
 * @param approved - Whether layout is approved
 * @throws Error if database is not found
 */
export function setLayoutApproved(videoId: string, approved: boolean): void {
  const result = getWritableDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Ensure video_preferences table exists and has a row
    try {
      db.prepare('SELECT id FROM video_preferences WHERE id = 1').get()
    } catch {
      // Table might not exist, try to create it
      db.prepare(
        `
        CREATE TABLE IF NOT EXISTS video_preferences (
          id INTEGER PRIMARY KEY,
          layout_approved INTEGER NOT NULL DEFAULT 0
        )
      `
      ).run()
      db.prepare(
        'INSERT OR IGNORE INTO video_preferences (id, layout_approved) VALUES (1, 0)'
      ).run()
    }

    db.prepare('UPDATE video_preferences SET layout_approved = ? WHERE id = 1').run(
      approved ? 1 : 0
    )
  } finally {
    db.close()
  }
}

/**
 * Get all OCR boxes for visualization in the layout editor.
 *
 * @param videoId - Video identifier
 * @param frameIndex - Optional specific frame to get boxes for
 * @returns Array of box data for visualization
 * @throws Error if database is not found
 */
export function getLayoutAnalysisBoxes(
  videoId: string,
  frameIndex?: number
): Array<{
  frameIndex: number
  boxIndex: number
  text: string
  bounds: { left: number; top: number; right: number; bottom: number }
  predictedLabel: 'in' | 'out' | null
  userLabel: 'in' | 'out' | null
}> {
  const result = getAnnotationDatabase(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    // Get layout config for dimensions
    const layoutConfig = db
      .prepare('SELECT frame_width, frame_height FROM video_layout_config WHERE id = 1')
      .get() as { frame_width: number; frame_height: number } | undefined

    if (!layoutConfig) {
      throw new Error('Layout config not found')
    }

    // Build query
    const whereClause = frameIndex !== undefined ? 'WHERE o.frame_index = ?' : ''
    const params = frameIndex !== undefined ? [frameIndex] : []

    const boxes = db
      .prepare(
        `
        SELECT
          o.frame_index,
          o.box_index,
          o.text,
          o.x, o.y, o.width, o.height,
          o.predicted_label,
          l.label as user_label
        FROM full_frame_ocr o
        LEFT JOIN full_frame_box_labels l
          ON o.frame_index = l.frame_index
          AND o.box_index = l.box_index
          AND l.annotation_source = 'full_frame'
          AND l.label_source = 'user'
        ${whereClause}
        ORDER BY o.frame_index, o.box_index
      `
      )
      .all(...params) as Array<{
      frame_index: number
      box_index: number
      text: string
      x: number
      y: number
      width: number
      height: number
      predicted_label: 'in' | 'out' | null
      user_label: 'in' | 'out' | null
    }>

    return boxes.map(box => {
      const boxLeft = Math.floor(box.x * layoutConfig.frame_width)
      const boxBottom = Math.floor((1 - box.y) * layoutConfig.frame_height)
      const boxTop = boxBottom - Math.floor(box.height * layoutConfig.frame_height)
      const boxRight = boxLeft + Math.floor(box.width * layoutConfig.frame_width)

      return {
        frameIndex: box.frame_index,
        boxIndex: box.box_index,
        text: box.text,
        bounds: { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom },
        predictedLabel: box.predicted_label,
        userLabel: box.user_label,
      }
    })
  } finally {
    db.close()
  }
}
