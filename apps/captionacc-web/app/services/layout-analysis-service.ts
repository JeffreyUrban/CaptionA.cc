/**
 * Layout analysis service for video annotation setup.
 *
 * Provides functionality for analyzing OCR data to determine optimal crop bounds,
 * layout parameters, and anchor types for caption detection.
 */

import type { TextAnchor } from '~/types/enums'
import { predictBoxLabel } from '~/utils/box-prediction'
import { getCaptionDb, getWritableCaptionDb } from '~/utils/database'

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
  anchor_type: TextAnchor | null
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
  anchorType: TextAnchor | null
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
  anchorType: TextAnchor
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
  layoutParams?: {
    verticalPosition: number
    verticalStd: number
    boxHeight: number
    boxHeightStd: number
    anchorType: 'left' | 'center' | 'right'
    anchorPosition: number
  }
}

/**
 * Result from updating layout configuration.
 */
export interface UpdateLayoutConfigResult {
  success: boolean
  boundsChanged: boolean
  framesInvalidated: number
  layoutParamsChanged: boolean
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
// Helper Functions - Config Update
// =============================================================================

/**
 * Result of detecting crop bounds changes.
 */
interface CropBoundsChangeResult {
  changed: boolean
  requiresVersionIncrement: boolean
}

/**
 * Detect if crop bounds have changed from current config.
 *
 * @param currentConfig - Current layout configuration from database
 * @param newCropBounds - New crop bounds to compare against
 * @returns Object indicating if bounds changed and if version increment is needed
 */
function detectCropBoundsChanges(
  currentConfig: VideoLayoutConfigRow,
  newCropBounds: CropBounds | undefined
): CropBoundsChangeResult {
  if (!newCropBounds) {
    return { changed: false, requiresVersionIncrement: false }
  }

  const changed =
    newCropBounds.left !== currentConfig.crop_left ||
    newCropBounds.top !== currentConfig.crop_top ||
    newCropBounds.right !== currentConfig.crop_right ||
    newCropBounds.bottom !== currentConfig.crop_bottom

  return { changed, requiresVersionIncrement: changed }
}

/**
 * Invalidate frames when crop bounds change by resetting their crop_bounds_version.
 *
 * @param db - Database connection
 * @param cropBounds - New crop bounds to apply
 * @returns Number of frames invalidated
 */
async function invalidateFramesForCropChange(
  db: import('better-sqlite3').Database,
  cropBounds: CropBounds
): Promise<number> {
  // Get layout config for frame dimensions
  const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
    | VideoLayoutConfigRow
    | undefined

  if (!layoutConfig) {
    throw new Error('Layout config not found')
  }

  // Get all OCR boxes for visualization
  const boxes = db
    .prepare(
      `
    SELECT id, frame_index, box_index, text, x, y, width, height, predicted_label, predicted_confidence
    FROM full_frame_ocr ORDER BY frame_index, box_index
  `
    )
    .all() as OcrBoxRow[]

  const analysisBoxes: LayoutAnalysisBox[] = []
  for (const box of boxes) {
    const bounds = convertToPixelBounds(box, layoutConfig)
    const predictedLabel: 'in' | 'out' = box.predicted_label ?? 'out'
    const predictedConfidence = box.predicted_confidence ?? 0
    const userLabel = null

    analysisBoxes.push({
      boxIndex: box.box_index,
      text: box.text,
      originalBounds: bounds,
      displayBounds: bounds,
      predictedLabel,
      predictedConfidence,
      userLabel,
      colorCode: getBoxColorCode(userLabel, predictedLabel),
    })
  }

  // Generate OCR visualization image with layout annotations
  const layoutParams =
    layoutConfig.anchor_type &&
    layoutConfig.anchor_position !== null &&
    layoutConfig.vertical_position !== null
      ? {
          anchorType: layoutConfig.anchor_type,
          anchorPosition: layoutConfig.anchor_position,
          verticalPosition: layoutConfig.vertical_position,
        }
      : undefined

  const ocrVisualizationImage = await generateOCRVisualization(
    analysisBoxes,
    cropBounds,
    layoutConfig.frame_width,
    layoutConfig.frame_height,
    layoutParams
  )

  // Increment crop_bounds_version and update crop bounds with OCR visualization
  db.prepare(
    `
    UPDATE video_layout_config
    SET crop_bounds_version = crop_bounds_version + 1,
        crop_left = ?,
        crop_top = ?,
        crop_right = ?,
        crop_bottom = ?,
        ocr_visualization_image = ?,
        updated_at = datetime('now')
    WHERE id = 1
  `
  ).run(cropBounds.left, cropBounds.top, cropBounds.right, cropBounds.bottom, ocrVisualizationImage)

  // Invalidate all frames (set crop_bounds_version to 0)
  const invalidateResult = db
    .prepare(
      `
    UPDATE frames_ocr
    SET crop_bounds_version = 0
  `
    )
    .run()

  return invalidateResult.changes
}

/**
 * Layout parameters input for database update.
 */
interface LayoutParamsInput {
  verticalPosition: number
  verticalStd: number
  boxHeight: number
  boxHeightStd: number
  anchorType: 'left' | 'center' | 'right'
  anchorPosition: number
}

/**
 * Update layout parameters (Bayesian priors) in the database.
 * Also clears the trained model since it was trained with different parameters.
 *
 * @param db - Database connection
 * @param layoutParams - New layout parameters
 * @returns True if parameters were updated
 */
function updateLayoutParameters(
  db: import('better-sqlite3').Database,
  layoutParams: LayoutParamsInput
): boolean {
  db.prepare(
    `
    UPDATE video_layout_config
    SET vertical_position = ?,
        vertical_std = ?,
        box_height = ?,
        box_height_std = ?,
        anchor_type = ?,
        anchor_position = ?,
        updated_at = datetime('now')
    WHERE id = 1
  `
  ).run(
    layoutParams.verticalPosition,
    layoutParams.verticalStd,
    layoutParams.boxHeight,
    layoutParams.boxHeightStd,
    layoutParams.anchorType,
    layoutParams.anchorPosition
  )

  // Clear the trained model since it was trained with different layout parameters
  // Predictions will fall back to heuristics until model is retrained
  db.prepare(`DELETE FROM box_classification_model WHERE id = 1`).run()
  console.log(
    `[Layout Config] Layout parameters changed, cleared trained model (will use heuristics until retrained)`
  )

  return true
}

/**
 * Update selection bounds and mode in the database.
 *
 * @param db - Database connection
 * @param selectionBounds - Optional new selection bounds
 * @param selectionMode - Optional new selection mode
 */
function updateSelectionConfig(
  db: import('better-sqlite3').Database,
  selectionBounds: SelectionBounds | undefined,
  selectionMode: 'hard' | 'soft' | 'disabled' | undefined
): void {
  if (selectionBounds === undefined && selectionMode === undefined) {
    return
  }

  const updates: string[] = []
  const values: (number | string)[] = []

  if (selectionBounds !== undefined) {
    updates.push(
      'selection_left = ?',
      'selection_top = ?',
      'selection_right = ?',
      'selection_bottom = ?'
    )
    values.push(
      selectionBounds.left,
      selectionBounds.top,
      selectionBounds.right,
      selectionBounds.bottom
    )
  }

  if (selectionMode !== undefined) {
    updates.push('selection_mode = ?')
    values.push(selectionMode)
  }

  updates.push("updated_at = datetime('now')")

  db.prepare(
    `
    UPDATE video_layout_config
    SET ${updates.join(', ')}
    WHERE id = 1
  `
  ).run(...values)
}

/**
 * Trigger async prediction recalculation after layout parameter changes.
 *
 * @param videoId - Video identifier
 */
function triggerPredictionRecalculation(videoId: string): void {
  console.log(
    `[Layout Config] Layout parameters changed, triggering prediction recalculation for ${videoId}`
  )
  fetch(
    `http://localhost:5173/api/annotations/${encodeURIComponent(videoId)}/calculate-predictions`,
    { method: 'POST' }
  )
    .then(response => response.json())
    .then(result => {
      console.log(`[Layout Config] Predictions recalculated after layout change:`, result)
    })
    .catch(err => {
      console.error(`[Layout Config] Failed to recalculate predictions:`, err.message)
    })
}

// =============================================================================
// Helper Functions - Reset Crop Bounds
// =============================================================================

/**
 * Raw box data from database query.
 */
interface RawBoxData {
  box_text: string
  box_left: number
  box_top: number
  box_right: number
  box_bottom: number
}

/**
 * SQL query strings for caption box retrieval.
 */
const CAPTION_BOX_QUERIES = {
  allBoxes: `
    SELECT
      text as box_text,
      FLOOR(x * ?) as box_left,
      FLOOR((1 - y) * ?) - FLOOR(height * ?) as box_top,
      FLOOR(x * ?) + FLOOR(width * ?) as box_right,
      FLOOR((1 - y) * ?) as box_bottom
    FROM full_frame_ocr
    WHERE frame_index = ?
    ORDER BY box_index
  `,
  captionBoxesOnly: `
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
  `,
} as const

/**
 * Caption frame info result from getCaptionFrameInfo.
 */
interface CaptionFrameInfo {
  useAllBoxesFallback: boolean
  frameIndices: Array<{ frame_index: number }>
}

/**
 * Get caption frame info: count caption boxes and determine frame indices.
 *
 * @param db - Database connection
 * @returns Caption frame info with fallback flag and frame indices
 */
function getCaptionFrameInfo(db: import('better-sqlite3').Database): CaptionFrameInfo {
  // Get unique frame indices
  const allFrameIndices = db
    .prepare('SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index')
    .all() as Array<{ frame_index: number }>

  if (allFrameIndices.length === 0) {
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
  const frameIndices = db
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

  return { useAllBoxesFallback, frameIndices }
}

/**
 * Build caption box frames from frame indices.
 *
 * @param db - Database connection
 * @param frameIndices - Frame indices to process
 * @param layoutConfig - Layout configuration
 * @param useAllBoxesFallback - Whether to use all boxes (no caption predictions)
 * @returns Array of frames in legacy FrameOCR format for analysis
 */
function buildCaptionBoxFrames(
  db: import('better-sqlite3').Database,
  frameIndices: Array<{ frame_index: number }>,
  layoutConfig: VideoLayoutConfigRow,
  useAllBoxesFallback: boolean
): FrameOCR[] {
  const queryStr = useAllBoxesFallback
    ? CAPTION_BOX_QUERIES.allBoxes
    : CAPTION_BOX_QUERIES.captionBoxesOnly
  const stmt = db.prepare(queryStr)

  return frameIndices.map(({ frame_index }) => {
    const boxes = stmt.all(
      layoutConfig.frame_width,
      layoutConfig.frame_height,
      layoutConfig.frame_height,
      layoutConfig.frame_width,
      layoutConfig.frame_width,
      layoutConfig.frame_height,
      frame_index
    ) as RawBoxData[]

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
}

/**
 * Save analysis results to the database.
 *
 * @param db - Database connection
 * @param analysis - OCR analysis result
 * @param modelVersion - Current model version (if any)
 * @param ocrVisualizationImage - OCR visualization PNG image buffer
 */
function saveAnalysisResults(
  db: import('better-sqlite3').Database,
  analysis: OCRAnalysisResult,
  modelVersion: string | null,
  ocrVisualizationImage: Buffer
): void {
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
        ocr_visualization_image = ?,
        updated_at = datetime('now')
    WHERE id = 1
  `
  ).run(
    analysis.cropBounds.left,
    analysis.cropBounds.top,
    analysis.cropBounds.right,
    analysis.cropBounds.bottom,
    modelVersion,
    analysis.layoutParams.verticalPosition,
    analysis.layoutParams.verticalStd,
    analysis.layoutParams.boxHeight,
    analysis.layoutParams.boxHeightStd,
    analysis.layoutParams.anchorType,
    analysis.layoutParams.anchorPosition,
    analysis.layoutParams.topEdgeStd,
    analysis.layoutParams.bottomEdgeStd,
    ocrVisualizationImage
  )
}

// =============================================================================
// Helper Functions - OCR Visualization
// =============================================================================

/**
 * Generate OCR visualization image for boundary detection model.
 *
 * Creates a PNG image showing OCR boxes cropped to the caption bounds using additive
 * darkening. Boxes from all frames are overlaid, with overlapping areas appearing darker.
 *
 * @param analysisBoxes - All OCR boxes from the video
 * @param cropBounds - Crop bounds to apply
 * @param frameWidth - Original frame width
 * @param frameHeight - Original frame height
 * @param layoutParams - Optional layout parameters for annotations (anchor type, position, etc.)
 * @returns PNG image as Buffer
 */
/**
 * Count box edges at each pixel.
 */
function countBoxEdges(
  edgeCount: Uint16Array,
  croppedWidth: number,
  clampedX1: number,
  clampedY1: number,
  clampedX2: number,
  clampedY2: number
): void {
  // Top and bottom edges
  for (let x = clampedX1; x <= clampedX2; x++) {
    const topIdx = clampedY1 * croppedWidth + x
    const bottomIdx = clampedY2 * croppedWidth + x
    edgeCount[topIdx] = (edgeCount[topIdx] ?? 0) + 1
    edgeCount[bottomIdx] = (edgeCount[bottomIdx] ?? 0) + 1
  }
  // Left and right edges
  for (let y = clampedY1; y <= clampedY2; y++) {
    const leftIdx = y * croppedWidth + clampedX1
    const rightIdx = y * croppedWidth + clampedX2
    edgeCount[leftIdx] = (edgeCount[leftIdx] ?? 0) + 1
    edgeCount[rightIdx] = (edgeCount[rightIdx] ?? 0) + 1
  }
}

/**
 * Count box overlaps at each pixel for normalized darkening.
 */
function countBoxOverlaps(
  analysisBoxes: Pick<LayoutAnalysisBox, 'predictedLabel' | 'originalBounds'>[],
  cropBounds: CropBounds,
  croppedWidth: number,
  croppedHeight: number
): {
  edgeCount: Uint16Array
  fillCount: Uint16Array
  maxEdgeCount: number
  maxFillCount: number
} {
  const edgeCount = new Uint16Array(croppedWidth * croppedHeight)
  const fillCount = new Uint16Array(croppedWidth * croppedHeight)

  for (const box of analysisBoxes) {
    if (box.predictedLabel !== 'in') continue

    const x1 = box.originalBounds.left - cropBounds.left
    const y1 = box.originalBounds.top - cropBounds.top
    const x2 = box.originalBounds.right - cropBounds.left
    const y2 = box.originalBounds.bottom - cropBounds.top

    // Skip boxes outside crop region
    if (x2 < 0 || x1 >= croppedWidth || y2 < 0 || y1 >= croppedHeight) continue

    const clampedX1 = Math.max(0, Math.min(x1, croppedWidth - 1))
    const clampedY1 = Math.max(0, Math.min(y1, croppedHeight - 1))
    const clampedX2 = Math.max(0, Math.min(x2, croppedWidth - 1))
    const clampedY2 = Math.max(0, Math.min(y2, croppedHeight - 1))

    // Count fill pixels
    for (let y = clampedY1 + 1; y < clampedY2; y++) {
      for (let x = clampedX1 + 1; x < clampedX2; x++) {
        const idx = y * croppedWidth + x
        fillCount[idx] = (fillCount[idx] ?? 0) + 1
      }
    }

    // Count edge pixels
    countBoxEdges(edgeCount, croppedWidth, clampedX1, clampedY1, clampedX2, clampedY2)
  }

  // Find maximum overlaps
  let maxEdgeCount = 0
  let maxFillCount = 0
  for (let i = 0; i < edgeCount.length; i++) {
    const edge = edgeCount[i] ?? 0
    const fill = fillCount[i] ?? 0
    if (edge > maxEdgeCount) maxEdgeCount = edge
    if (fill > maxFillCount) maxFillCount = fill
  }

  return { edgeCount, fillCount, maxEdgeCount, maxFillCount }
}

/**
 * Apply edge darkening (black) to image data.
 */
function applyEdgeDarkening(
  data: Uint8ClampedArray,
  croppedWidth: number,
  croppedHeight: number,
  edgeCount: Uint16Array,
  maxEdgeCount: number
): void {
  for (let y = 0; y < croppedHeight; y++) {
    for (let x = 0; x < croppedWidth; x++) {
      const idx = y * croppedWidth + x
      const count = edgeCount[idx] ?? 0
      if (count > 0) {
        const darknessAmount = Math.round((count / maxEdgeCount) * 255)
        const pixelIdx = idx * 4
        data[pixelIdx] = Math.max(0, (data[pixelIdx] ?? 255) - darknessAmount)
        data[pixelIdx + 1] = Math.max(0, (data[pixelIdx + 1] ?? 255) - darknessAmount)
        data[pixelIdx + 2] = Math.max(0, (data[pixelIdx + 2] ?? 255) - darknessAmount)
      }
    }
  }
}

/**
 * Apply fill darkening (green tint) to image data.
 */
function applyFillDarkening(
  data: Uint8ClampedArray,
  croppedWidth: number,
  croppedHeight: number,
  fillCount: Uint16Array,
  maxFillCount: number
): void {
  for (let y = 0; y < croppedHeight; y++) {
    for (let x = 0; x < croppedWidth; x++) {
      const idx = y * croppedWidth + x
      const count = fillCount[idx] ?? 0
      if (count > 0) {
        const darknessAmount = Math.round((count / maxFillCount) * 180)
        const pixelIdx = idx * 4
        data[pixelIdx] = Math.max(0, (data[pixelIdx] ?? 255) - darknessAmount)
        data[pixelIdx + 2] = Math.max(0, (data[pixelIdx + 2] ?? 255) - darknessAmount)
      }
    }
  }
}

/**
 * Apply normalized darkening to image data.
 */
function applyNormalizedDarkening(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any, // Canvas context from node-canvas (different type than DOM CanvasRenderingContext2D)
  croppedWidth: number,
  croppedHeight: number,
  edgeCount: Uint16Array,
  fillCount: Uint16Array,
  maxEdgeCount: number,
  maxFillCount: number
): void {
  const imageData = ctx.getImageData(0, 0, croppedWidth, croppedHeight)
  const data = imageData.data

  if (maxEdgeCount > 0) {
    applyEdgeDarkening(data, croppedWidth, croppedHeight, edgeCount, maxEdgeCount)
  }

  if (maxFillCount > 0) {
    applyFillDarkening(data, croppedWidth, croppedHeight, fillCount, maxFillCount)
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * Draw colored layout annotations (anchor line, vertical position line).
 */
function drawLayoutAnnotations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any, // Canvas context from node-canvas (different type than DOM CanvasRenderingContext2D)
  layoutParams: {
    anchorType: 'left' | 'center' | 'right'
    anchorPosition: number
    verticalPosition: number
  },
  cropBounds: CropBounds,
  croppedWidth: number,
  croppedHeight: number
): void {
  // Draw vertical anchor line
  const anchorX = layoutParams.anchorPosition - cropBounds.left
  if (anchorX >= 0 && anchorX <= croppedWidth) {
    const anchorColors = {
      left: 'rgb(0, 0, 255)',
      right: 'rgb(255, 0, 0)',
      center: 'rgb(0, 255, 255)',
    }
    ctx.strokeStyle = anchorColors[layoutParams.anchorType]
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(anchorX, 0)
    ctx.lineTo(anchorX, croppedHeight)
    ctx.stroke()
  }

  // Draw horizontal vertical position line
  const verticalY = layoutParams.verticalPosition - cropBounds.top
  if (verticalY >= 0 && verticalY <= croppedHeight) {
    ctx.strokeStyle = 'rgb(255, 255, 0)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, verticalY)
    ctx.lineTo(croppedWidth, verticalY)
    ctx.stroke()
  }
}

export async function generateOCRVisualization(
  analysisBoxes: Pick<LayoutAnalysisBox, 'predictedLabel' | 'originalBounds'>[],
  cropBounds: CropBounds,
  frameWidth: number,
  frameHeight: number,
  layoutParams?: {
    anchorType: 'left' | 'center' | 'right'
    anchorPosition: number
    verticalPosition: number
  }
): Promise<Buffer> {
  // Server-side only - canvas module is dynamically loaded
  // Use dynamic import which works in ES modules
  const canvasModule = await import('canvas')
  const { createCanvas } = canvasModule

  const croppedWidth = cropBounds.right - cropBounds.left
  const croppedHeight = cropBounds.bottom - cropBounds.top

  const canvas = createCanvas(croppedWidth, croppedHeight)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = 'rgb(255, 255, 255)'
  ctx.fillRect(0, 0, croppedWidth, croppedHeight)

  // Count box overlaps
  const { edgeCount, fillCount, maxEdgeCount, maxFillCount } = countBoxOverlaps(
    analysisBoxes,
    cropBounds,
    croppedWidth,
    croppedHeight
  )

  // Apply normalized darkening
  applyNormalizedDarkening(
    ctx,
    croppedWidth,
    croppedHeight,
    edgeCount,
    fillCount,
    maxEdgeCount,
    maxFillCount
  )

  // Draw annotations
  if (layoutParams) {
    drawLayoutAnnotations(ctx, layoutParams, cropBounds, croppedWidth, croppedHeight)
  }

  return canvas.toBuffer('image/png')
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
export async function getLayoutConfig(videoId: string): Promise<LayoutConfig | null> {
  const result = await getCaptionDb(videoId)
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
 * Handles crop bounds changes with versioning, frame invalidation, and layout parameter updates.
 * When crop bounds change, increments the version and invalidates all frames.
 * When layout parameters change, clears the trained model and triggers prediction recalculation.
 *
 * @param videoId - Video identifier
 * @param input - Layout configuration updates
 * @returns Result indicating what changed
 * @throws Error if database or config is not found
 */
export async function updateLayoutConfig(
  videoId: string,
  input: UpdateLayoutConfigInput
): Promise<UpdateLayoutConfigResult> {
  const result = await getWritableCaptionDb(videoId)
  if (!result.success) {
    throw new Error('Database not found')
  }

  const db = result.db

  try {
    const currentConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfigRow
      | undefined

    if (!currentConfig) {
      throw new Error('Layout config not found')
    }

    const { cropBounds, selectionBounds, selectionMode, layoutParams } = input
    const boundsChange = detectCropBoundsChanges(currentConfig, cropBounds)
    let framesInvalidated = 0

    db.prepare('BEGIN TRANSACTION').run()

    try {
      // Handle crop bounds changes
      if (boundsChange.changed && cropBounds) {
        framesInvalidated = await invalidateFramesForCropChange(db, cropBounds)
        console.log(`Crop bounds changed: invalidated ${framesInvalidated} frames`)
      } else if (cropBounds) {
        // Update crop bounds without invalidation (no actual change)
        db.prepare(
          `UPDATE video_layout_config SET crop_left = ?, crop_top = ?, crop_right = ?, crop_bottom = ?, updated_at = datetime('now') WHERE id = 1`
        ).run(cropBounds.left, cropBounds.top, cropBounds.right, cropBounds.bottom)
      }

      // Update selection config
      updateSelectionConfig(db, selectionBounds, selectionMode)

      // Update layout parameters
      if (layoutParams) {
        updateLayoutParameters(db, layoutParams)
      }

      db.prepare('COMMIT').run()
    } catch (error) {
      db.prepare('ROLLBACK').run()
      throw error
    }

    // Trigger async prediction recalculation if layout parameters changed
    if (layoutParams) {
      triggerPredictionRecalculation(videoId)
    }

    return {
      success: true,
      boundsChanged: boundsChange.changed,
      framesInvalidated,
      layoutParamsChanged: !!layoutParams,
    }
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
export async function resetCropBounds(videoId: string): Promise<ResetCropBoundsResult> {
  const result = await getWritableCaptionDb(videoId)
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

    // Get caption frame info (handles fallback logic)
    const { useAllBoxesFallback, frameIndices } = getCaptionFrameInfo(db)

    // Build frames with caption boxes
    const frames = buildCaptionBoxFrames(db, frameIndices, layoutConfig, useAllBoxesFallback)

    // Analyze OCR boxes
    const analysis = analyzeOCRBoxes(frames, layoutConfig.frame_width, layoutConfig.frame_height)

    // Get current model version
    const modelInfo = db
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as { model_version: string } | undefined

    // Get all OCR boxes for visualization (inline to reuse db connection)
    const boxes = db
      .prepare(
        `
      SELECT id, frame_index, box_index, text, x, y, width, height, predicted_label, predicted_confidence
      FROM full_frame_ocr ORDER BY frame_index, box_index
    `
      )
      .all() as OcrBoxRow[]

    const analysisBoxes: LayoutAnalysisBox[] = []
    for (const box of boxes) {
      const bounds = convertToPixelBounds(box, layoutConfig)
      const predictedLabel: 'in' | 'out' = box.predicted_label ?? 'out'
      const predictedConfidence = box.predicted_confidence ?? 0
      const userLabel = null // No user labels at this stage

      analysisBoxes.push({
        boxIndex: box.box_index,
        text: box.text,
        originalBounds: bounds,
        displayBounds: bounds,
        predictedLabel,
        predictedConfidence,
        userLabel,
        colorCode: getBoxColorCode(userLabel, predictedLabel),
      })
    }

    // Generate OCR visualization image with layout annotations
    const layoutParams = {
      anchorType: analysis.layoutParams.anchorType,
      anchorPosition: analysis.layoutParams.anchorPosition,
      verticalPosition: analysis.layoutParams.verticalPosition,
    }

    const ocrVisualizationImage = await generateOCRVisualization(
      analysisBoxes,
      analysis.cropBounds,
      layoutConfig.frame_width,
      layoutConfig.frame_height,
      layoutParams
    )

    // Save analysis results to database
    saveAnalysisResults(db, analysis, modelInfo?.model_version ?? null, ocrVisualizationImage)

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
export async function setLayoutApproved(videoId: string, approved: boolean): Promise<void> {
  const result = await getWritableCaptionDb(videoId)
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
 * Box data for layout analysis visualization.
 */
export interface LayoutAnalysisBox {
  boxIndex: number
  text: string
  originalBounds: { left: number; top: number; right: number; bottom: number }
  displayBounds: { left: number; top: number; right: number; bottom: number }
  predictedLabel: 'in' | 'out'
  predictedConfidence: number
  userLabel: 'in' | 'out' | null
  colorCode: string
}

/** Raw OCR box from database. */
interface OcrBoxRow {
  id: number
  frame_index: number
  box_index: number
  text: string
  x: number
  y: number
  width: number
  height: number
  predicted_label: 'in' | 'out' | null
  predicted_confidence: number | null
}

/** Box bounds in pixel coordinates. */
interface BoxBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/** Type for predict function imported lazily. */
type PredictBoxLabelFn = (
  boxBounds: BoxBounds,
  layoutConfig: VideoLayoutConfigRow,
  allBoxes: BoxBounds[],
  frameIndex: number,
  boxIndex: number,
  db?: import('better-sqlite3').Database
) => { label: 'in' | 'out'; confidence: number }

/**
 * Generate color code for a box based on its labels.
 *
 * Color scheme:
 * - User labeled "in": teal (#14b8a6)
 * - User labeled "out": red (#dc2626)
 * - Predicted "in": blue (#3b82f6)
 * - Predicted "out": orange (#f97316)
 */
function getBoxColorCode(userLabel: 'in' | 'out' | null, predictedLabel: 'in' | 'out'): string {
  if (userLabel === 'in') return '#14b8a6' // teal
  if (userLabel === 'out') return '#dc2626' // red
  if (predictedLabel === 'in') return '#3b82f6' // blue
  return '#f97316' // orange
}

/** Convert fractional OCR coordinates to pixel bounds. */
function convertToPixelBounds(box: OcrBoxRow, config: VideoLayoutConfigRow): BoxBounds {
  const left = Math.floor(box.x * config.frame_width)
  const bottom = Math.floor((1 - box.y) * config.frame_height)
  const boxWidth = Math.floor(box.width * config.frame_width)
  const boxHeight = Math.floor(box.height * config.frame_height)
  return { left, top: bottom - boxHeight, right: left + boxWidth, bottom }
}

/** Group boxes by frame index. */
function groupBoxesByFrame(boxes: OcrBoxRow[]): Map<number, OcrBoxRow[]> {
  const byFrame = new Map<number, OcrBoxRow[]>()
  for (const box of boxes) {
    const frameBoxes = byFrame.get(box.frame_index) ?? []
    frameBoxes.push(box)
    byFrame.set(box.frame_index, frameBoxes)
  }
  return byFrame
}

/** Build annotation lookup map from annotations. */
function buildAnnotationMap(
  annotations: Array<{ frame_index: number; box_index: number; label: 'in' | 'out' }>
): Map<string, 'in' | 'out'> {
  const map = new Map<string, 'in' | 'out'>()
  for (const ann of annotations) {
    map.set(`${ann.frame_index}-${ann.box_index}`, ann.label)
  }
  return map
}

/** Process a single box and return its visualization data. */
function processBox(
  box: OcrBoxRow,
  bounds: BoxBounds,
  layoutConfig: VideoLayoutConfigRow,
  allBounds: BoxBounds[],
  annotationMap: Map<string, 'in' | 'out'>,
  updateStmt: import('better-sqlite3').Statement,
  predictBoxLabel: PredictBoxLabelFn,
  db: import('better-sqlite3').Database
): LayoutAnalysisBox {
  const userLabel = annotationMap.get(`${box.frame_index}-${box.box_index}`) ?? null
  let predictedLabel: 'in' | 'out' = box.predicted_label ?? 'out'
  let predictedConfidence = box.predicted_confidence ?? 0

  if (!box.predicted_label || box.predicted_confidence === null) {
    const prediction = predictBoxLabel(
      bounds,
      layoutConfig,
      allBounds,
      box.frame_index,
      box.box_index,
      db
    )
    predictedLabel = prediction.label
    predictedConfidence = prediction.confidence
    updateStmt.run(predictedLabel, predictedConfidence, box.id)
  }

  return {
    boxIndex: box.box_index,
    text: box.text,
    originalBounds: bounds,
    displayBounds: bounds,
    predictedLabel,
    predictedConfidence,
    userLabel,
    colorCode: getBoxColorCode(userLabel, predictedLabel),
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
export async function getLayoutAnalysisBoxes(
  videoId: string,
  frameIndex?: number
): Promise<LayoutAnalysisBox[]> {
  const result = await getWritableCaptionDb(videoId)
  if (!result.success) throw new Error('Database not found')
  const db = result.db

  try {
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfigRow
      | undefined
    if (!layoutConfig) throw new Error('Layout config not found')

    // Log model version mismatch for background recalculation
    const analysisVersion = layoutConfig.analysis_model_version ?? null
    const modelInfo = db
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as { model_version: string } | undefined
    if (analysisVersion !== (modelInfo?.model_version ?? null)) {
      console.log(`[LayoutAnalysisBoxes] Model version mismatch for ${videoId}`)
    }

    // Fetch OCR boxes and annotations
    const whereClause = frameIndex !== undefined ? 'WHERE frame_index = ?' : ''
    const params = frameIndex !== undefined ? [frameIndex] : []

    const boxes = db
      .prepare(
        `
      SELECT id, frame_index, box_index, text, x, y, width, height, predicted_label, predicted_confidence
      FROM full_frame_ocr ${whereClause} ORDER BY frame_index, box_index
    `
      )
      .all(...params) as OcrBoxRow[]

    const annotations = db
      .prepare(
        `
      SELECT frame_index, box_index, label FROM full_frame_box_labels
      ${frameIndex !== undefined ? 'WHERE frame_index = ?' : ''}
    `
      )
      .all(...params) as Array<{ frame_index: number; box_index: number; label: 'in' | 'out' }>

    const annotationMap = buildAnnotationMap(annotations)
    const updateStmt = db.prepare(
      `UPDATE full_frame_ocr SET predicted_label = ?, predicted_confidence = ?, predicted_at = datetime('now') WHERE id = ?`
    )

    // Process boxes by frame
    const boxesData: LayoutAnalysisBox[] = []
    for (const [, frameBoxes] of groupBoxesByFrame(boxes)) {
      const allBounds = frameBoxes.map(b => convertToPixelBounds(b, layoutConfig))
      for (let i = 0; i < frameBoxes.length; i++) {
        const box = frameBoxes[i]
        const bounds = allBounds[i]
        if (box && bounds) {
          boxesData.push(
            processBox(
              box,
              bounds,
              layoutConfig,
              allBounds,
              annotationMap,
              updateStmt,
              predictBoxLabel,
              db
            )
          )
        }
      }
    }
    return boxesData
  } finally {
    db.close()
  }
}
