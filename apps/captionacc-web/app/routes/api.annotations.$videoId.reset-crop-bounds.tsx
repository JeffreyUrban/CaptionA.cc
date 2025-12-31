import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type ActionFunctionArgs } from 'react-router'

import { getDbPath } from '~/utils/video-paths'

interface FrameOCR {
  frame_index: number
  ocr_text: string
  ocr_annotations: string // JSON: [[text, conf, [x, y, w, h]], ...]
  ocr_confidence: number
}

// Python OCR annotation format: [text, confidence, [x, y, width, height]]
type PythonOCRAnnotation = [string, number, [number, number, number, number]]

interface VideoLayoutConfig {
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
  anchor_type: 'left' | 'center' | 'right' | null
  anchor_position: number | null
  crop_bounds_version: number
}

interface BoxStats {
  minTop: number
  maxBottom: number
  minLeft: number
  maxRight: number
  topEdges: number[] // For calculating top_edge_std
  bottomEdges: number[] // For calculating bottom_edge_std
  centerYValues: number[]
  heightValues: number[]
  widthValues: number[]
  leftEdges: number[]
  rightEdges: number[]
  centerXValues: number[]
}

interface LayoutParams {
  verticalPosition: number
  verticalStd: number
  boxHeight: number
  boxHeightStd: number
  anchorType: 'left' | 'center' | 'right'
  anchorPosition: number
  topEdgeStd: number
  bottomEdgeStd: number
}

interface AnalysisStats {
  totalBoxes: number
  captionBoxes: number
  verticalPosition: number
  boxHeight: number
  topEdgeStd: number
  bottomEdgeStd: number
}

interface OCRAnalysisResult {
  cropBounds: { left: number; top: number; right: number; bottom: number }
  layoutParams: LayoutParams
  stats: AnalysisStats
}

function getDatabase(videoId: string): Database.Database | Response {
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

/**
 * Calculate mode (most common value) from array of numbers.
 * Groups values into bins and finds the bin with highest frequency.
 */
function calculateMode(values: number[], binSize: number = 5): number {
  if (values.length === 0) return 0

  // Group into bins
  const bins = new Map<number, number>()
  for (const value of values) {
    const bin = Math.round(value / binSize) * binSize
    bins.set(bin, (bins.get(bin) ?? 0) + 1)
  }

  // Find bin with max count
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

// ============================================================================
// Helper types for OCR box analysis
// ============================================================================

/** Result of density derivative analysis for edge detection */
interface DensityAnalysisResult {
  density: number[]
  derivatives: number[]
  maxPositiveDerivative: number
  maxNegativeDerivative: number
  positiveEdgePos: number
  negativeEdgePos: number
}

/** Detected anchor information */
interface AnchorInfo {
  anchorType: 'left' | 'center' | 'right'
  anchorPosition: number
  leftEdgeSharpness: number
  rightEdgeSharpness: number
}

/** Crop bounds with padding info for logging */
interface CropBoundsResult {
  cropLeft: number
  cropRight: number
  cropTop: number
  cropBottom: number
}

// ============================================================================
// Helper functions for OCR box analysis
// ============================================================================

/**
 * Filter outliers from an array using IQR (Interquartile Range) method.
 * Uses k=3.0 (less aggressive than standard 1.5) to keep more valid boxes.
 */
function filterOutliers(values: number[]): number[] {
  if (values.length < 10) return values // Need sufficient values for meaningful filtering

  const sorted = [...values].sort((a, b) => a - b)
  const q1Index = Math.floor(sorted.length * 0.25)
  const q3Index = Math.floor(sorted.length * 0.75)
  const q1 = sorted[q1Index] ?? 0
  const q3 = sorted[q3Index] ?? 0
  const iqr = q3 - q1

  // Use 3.0 * IQR instead of 1.5 to be less aggressive
  const k = 3.0
  const lowerBound = q1 - k * iqr
  const upperBound = q3 + k * iqr

  const filtered = values.filter(v => v >= lowerBound && v <= upperBound)

  // Safety: if we filter out more than 10% of values, keep original
  if (filtered.length < values.length * 0.9) {
    console.log(
      `[Outlier Filtering] Filtered too many (${values.length - filtered.length}), keeping original`
    )
    return values
  }

  return filtered
}

/**
 * Collect box statistics from OCR frames.
 * Returns box statistics and count of valid boxes.
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
      // OCR annotation format: [text, confidence, [x, y, width, height]]
      // Coordinates are fractional [0-1]
      // IMPORTANT: y is bottom-referenced (0 = bottom, 1 = top)
      const [, , [x, y, width, height]] = annotation

      // Convert fractional to pixels (convert y from bottom-referenced to top-referenced)
      const boxLeft = Math.floor(x * frameWidth)
      const boxBottom = Math.floor((1 - y) * frameHeight) // Convert from bottom-referenced to top-referenced
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

      // Collect values for mode and std dev calculation
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
 * Apply outlier filtering to horizontal edge statistics and restore if filtering is too aggressive.
 */
function applyHorizontalOutlierFiltering(stats: BoxStats): void {
  const originalLeftCount = stats.leftEdges.length
  const originalRightCount = stats.rightEdges.length

  const originalLeftEdges = [...stats.leftEdges]
  const originalRightEdges = [...stats.rightEdges]
  const originalCenterXValues = [...stats.centerXValues]

  stats.leftEdges = filterOutliers(stats.leftEdges)
  stats.rightEdges = filterOutliers(stats.rightEdges)
  stats.centerXValues = filterOutliers(stats.centerXValues)

  // Safety: if filtering resulted in empty arrays, restore originals
  if (stats.leftEdges.length === 0) {
    console.log('[Outlier Filtering] Left edges filtered to empty - restoring original')
    stats.leftEdges = originalLeftEdges
  }
  if (stats.rightEdges.length === 0) {
    console.log('[Outlier Filtering] Right edges filtered to empty - restoring original')
    stats.rightEdges = originalRightEdges
  }
  if (stats.centerXValues.length === 0) {
    console.log('[Outlier Filtering] Center X values filtered to empty - restoring original')
    stats.centerXValues = originalCenterXValues
  }

  console.log(
    `[Outlier Filtering] Left edges: ${originalLeftCount} → ${stats.leftEdges.length} (removed ${originalLeftCount - stats.leftEdges.length})`
  )
  console.log(
    `[Outlier Filtering] Right edges: ${originalRightCount} → ${stats.rightEdges.length} (removed ${originalRightCount - stats.rightEdges.length})`
  )
}

/**
 * Calculate density distribution and derivatives for edge detection.
 * Used for both horizontal (X) and vertical (Y) analysis.
 */
function calculateDensityAndDerivatives(
  size: number,
  fillDensity: (density: number[]) => void,
  defaultNegativeEdgePos: number
): DensityAnalysisResult {
  const density = new Array(size).fill(0) as number[]
  fillDensity(density)

  // Calculate derivatives (change in density)
  const derivatives = new Array(size - 1).fill(0) as number[]
  for (let i = 0; i < size - 1; i++) {
    derivatives[i] = (density[i + 1] ?? 0) - (density[i] ?? 0)
  }

  // Find highest positive derivative (edge where density increases)
  let maxPositiveDerivative = 0
  let positiveEdgePos = 0
  for (let i = 0; i < derivatives.length; i++) {
    const deriv = derivatives[i] ?? 0
    if (deriv > maxPositiveDerivative) {
      maxPositiveDerivative = deriv
      positiveEdgePos = i
    }
  }

  // Find highest negative derivative (edge where density decreases)
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
  // Calculate center of mass for center detection
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
    // Centered and symmetric edges = center anchor
    anchorType = 'center'
    anchorPosition = Math.round(meanCenterX)
  } else if (leftEdgeStrength > rightEdgeStrength * 1.2) {
    // Strong left edge = left anchor
    anchorType = 'left'
    anchorPosition = horizontalAnalysis.positiveEdgePos
  } else if (rightEdgeStrength > leftEdgeStrength * 1.2) {
    // Strong right edge = right anchor
    anchorType = 'right'
    anchorPosition = horizontalAnalysis.negativeEdgePos
  } else {
    // Default to stronger edge
    if (leftEdgeStrength >= rightEdgeStrength) {
      anchorType = 'left'
      anchorPosition = horizontalAnalysis.positiveEdgePos
    } else {
      anchorType = 'right'
      anchorPosition = horizontalAnalysis.negativeEdgePos
    }
  }

  // Log anchor detection details
  console.log(
    `[Anchor Detection] Horizontal - Left edge at x=${horizontalAnalysis.positiveEdgePos} (derivative=${horizontalAnalysis.maxPositiveDerivative})`
  )
  console.log(
    `[Anchor Detection] Horizontal - Right edge at x=${horizontalAnalysis.negativeEdgePos} (derivative=${horizontalAnalysis.maxNegativeDerivative})`
  )
  console.log(
    `[Anchor Detection] Horizontal - Center of mass: ${Math.round(meanCenterX)}, frame center: ${frameCenterX}`
  )
  console.log(`[Anchor Detection] Horizontal - Chosen: ${anchorType} at ${anchorPosition}`)

  // Calculate edge sharpness
  const maxHorizontalDensity = Math.max(...horizontalAnalysis.density)
  const leftEdgeSharpness = horizontalAnalysis.maxPositiveDerivative / maxHorizontalDensity
  const rightEdgeSharpness =
    Math.abs(horizontalAnalysis.maxNegativeDerivative) / maxHorizontalDensity

  console.log(
    `[Anchor Detection] Horizontal - Left sharpness=${leftEdgeSharpness.toFixed(3)}, Right sharpness=${rightEdgeSharpness.toFixed(3)}`
  )

  return { anchorType, anchorPosition, leftEdgeSharpness, rightEdgeSharpness }
}

/**
 * Calculate final crop bounds based on detected edges and anchor type.
 */
function calculateCropBounds(
  anchorInfo: AnchorInfo,
  verticalAnalysis: DensityAnalysisResult,
  stats: BoxStats,
  frameWidth: number,
  frameHeight: number,
  boxWidth: number,
  boxHeight: number
): CropBoundsResult {
  const PADDING_FRACTION = 0.1 // Base padding: 1/10 of box dimension
  const SHARPNESS_FACTOR = 2.0 // How much to increase padding for gradual edges

  // Calculate vertical edge sharpness
  const maxVerticalDensity = Math.max(...verticalAnalysis.density)
  const topEdgeSharpness = verticalAnalysis.maxPositiveDerivative / maxVerticalDensity
  const bottomEdgeSharpness = Math.abs(verticalAnalysis.maxNegativeDerivative) / maxVerticalDensity

  console.log(
    `[Anchor Detection] Vertical - Top edge at y=${verticalAnalysis.positiveEdgePos} (derivative=${verticalAnalysis.maxPositiveDerivative})`
  )
  console.log(
    `[Anchor Detection] Vertical - Bottom edge at y=${verticalAnalysis.negativeEdgePos} (derivative=${verticalAnalysis.maxNegativeDerivative})`
  )
  console.log(
    `[Anchor Detection] Vertical - Top sharpness=${topEdgeSharpness.toFixed(3)}, Bottom sharpness=${bottomEdgeSharpness.toFixed(3)}`
  )

  // Adaptive vertical padding: padding × (1 + factor × (1 - sharpness))
  const topPaddingMultiplier = 1 + SHARPNESS_FACTOR * (1 - Math.min(1, topEdgeSharpness))
  const bottomPaddingMultiplier = 1 + SHARPNESS_FACTOR * (1 - Math.min(1, bottomEdgeSharpness))

  const topPadding = Math.ceil(boxHeight * PADDING_FRACTION * topPaddingMultiplier)
  const bottomPadding = Math.ceil(boxHeight * PADDING_FRACTION * bottomPaddingMultiplier)

  const cropTop = Math.max(0, verticalAnalysis.positiveEdgePos - topPadding)
  const cropBottom = Math.min(frameHeight, verticalAnalysis.negativeEdgePos + bottomPadding)

  console.log(
    `[Crop Bounds] Vertical - Top padding=${topPadding}px (×${topPaddingMultiplier.toFixed(2)}), Bottom padding=${bottomPadding}px (×${bottomPaddingMultiplier.toFixed(2)})`
  )

  // Horizontal bounds calculation
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
    console.log(
      `[Crop Bounds] Horizontal - Center anchor at ${anchorInfo.anchorPosition}: using box extents ${minLeft}-${maxRight} with ±${fixedSparsePadding}px padding`
    )
  } else if (anchorInfo.anchorType === 'left') {
    const leftPadding = Math.ceil(baseDensePadding * leftAnchorPaddingMultiplier)
    cropLeft = Math.max(0, anchorInfo.anchorPosition - leftPadding)
    cropRight = Math.min(frameWidth, maxRight + fixedSparsePadding)
    console.log(
      `[Crop Bounds] Horizontal - Left anchor at ${anchorInfo.anchorPosition}: left=${cropLeft} (anchor-${leftPadding}px, ×${leftAnchorPaddingMultiplier.toFixed(2)}), right=${cropRight} (extent=${maxRight}+${fixedSparsePadding}px)`
    )
  } else {
    cropLeft = Math.max(0, minLeft - fixedSparsePadding)
    const rightPadding = Math.ceil(baseDensePadding * rightAnchorPaddingMultiplier)
    cropRight = Math.min(frameWidth, anchorInfo.anchorPosition + rightPadding)
    console.log(
      `[Crop Bounds] Horizontal - Right anchor at ${anchorInfo.anchorPosition}: left=${cropLeft} (extent=${minLeft}-${fixedSparsePadding}px), right=${cropRight} (anchor+${rightPadding}px, ×${rightAnchorPaddingMultiplier.toFixed(2)})`
    )
  }

  // Apply NaN safety fallback if needed
  const result = applyNaNSafetyFallback(
    { cropLeft, cropRight, cropTop, cropBottom },
    stats,
    frameWidth,
    frameHeight
  )

  console.log(
    `[Crop Bounds] Final bounds: [${result.cropLeft}, ${result.cropTop}] - [${result.cropRight}, ${result.cropBottom}] with adaptive padding (sharpness factor=${SHARPNESS_FACTOR})`
  )

  return result
}

/**
 * Apply fallback bounds when NaN values are detected.
 */
function applyNaNSafetyFallback(
  bounds: CropBoundsResult,
  stats: BoxStats,
  frameWidth: number,
  frameHeight: number
): CropBoundsResult {
  let { cropLeft, cropRight, cropTop, cropBottom } = bounds

  if (isNaN(cropLeft) || isNaN(cropRight) || isNaN(cropTop) || isNaN(cropBottom)) {
    console.error(
      `[Crop Bounds] ERROR: NaN values detected - cropLeft=${cropLeft}, cropTop=${cropTop}, cropRight=${cropRight}, cropBottom=${cropBottom}`
    )
    // Fallback to using actual box extents with fixed padding
    const minLeft = Math.min(...stats.leftEdges)
    const maxRight = Math.max(...stats.rightEdges)
    const minTop = Math.min(...stats.topEdges)
    const maxBottom = Math.max(...stats.bottomEdges)
    const fallbackPadding = 20 // Fixed 20px padding

    cropLeft = isNaN(cropLeft) ? Math.max(0, minLeft - fallbackPadding) : cropLeft
    cropRight = isNaN(cropRight) ? Math.min(frameWidth, maxRight + fallbackPadding) : cropRight
    cropTop = isNaN(cropTop) ? Math.max(0, minTop - fallbackPadding) : cropTop
    cropBottom = isNaN(cropBottom) ? Math.min(frameHeight, maxBottom + fallbackPadding) : cropBottom

    console.log(
      `[Crop Bounds] Applied fallback bounds: [${cropLeft}, ${cropTop}] - [${cropRight}, ${cropBottom}]`
    )
  }

  return { cropLeft, cropRight, cropTop, cropBottom }
}

// ============================================================================
// Main analysis function
// ============================================================================

/**
 * Analyze all OCR boxes to determine optimal crop bounds and layout parameters.
 */
function analyzeOCRBoxes(
  frames: FrameOCR[],
  frameWidth: number,
  frameHeight: number
): OCRAnalysisResult {
  // Step 1: Collect box statistics from all frames
  const { stats, totalBoxes } = collectBoxStatistics(frames, frameWidth, frameHeight)

  if (totalBoxes === 0) {
    throw new Error('No OCR boxes found in video')
  }

  // Step 2: Filter outliers from horizontal edges
  applyHorizontalOutlierFiltering(stats)

  // Step 3: Calculate modes and standard deviations
  const verticalPosition = calculateMode(stats.centerYValues, 5)
  const verticalStd = calculateStd(stats.centerYValues, verticalPosition)
  const boxHeight = calculateMode(stats.heightValues, 2)
  const boxHeightStd = calculateStd(stats.heightValues, boxHeight)
  const boxWidth = calculateMode(stats.widthValues, 2)

  // Calculate edge standard deviations (filter outliers >100px from mode)
  const topMode = calculateMode(stats.topEdges, 5)
  const topEdgesFiltered = stats.topEdges.filter(val => Math.abs(val - topMode) < 100)
  const topEdgeStd = calculateStd(topEdgesFiltered, topMode)

  const bottomMode = calculateMode(stats.bottomEdges, 5)
  const bottomEdgesFiltered = stats.bottomEdges.filter(val => Math.abs(val - bottomMode) < 100)
  const bottomEdgeStd = calculateStd(bottomEdgesFiltered, bottomMode)

  // Step 4: Calculate horizontal density and detect anchor
  const horizontalAnalysis = calculateDensityAndDerivatives(
    frameWidth,
    density => {
      for (let i = 0; i < stats.leftEdges.length; i++) {
        const left = stats.leftEdges[i] ?? 0
        const right = stats.rightEdges[i] ?? 0
        const centerY = stats.centerYValues[i] ?? 0

        // Only count boxes near the vertical center (caption region)
        if (Math.abs(centerY - verticalPosition) < verticalStd * 2) {
          for (let x = Math.max(0, left); x <= Math.min(frameWidth - 1, right); x++) {
            // Safe: density array was initialized with size=frameWidth, and x is bounded to [0, frameWidth-1]
            ;(density[x] as number)++
          }
        }
      }
    },
    frameWidth - 1
  )

  const anchorInfo = determineAnchorType(horizontalAnalysis, stats, frameWidth, boxWidth)

  // Step 5: Calculate vertical density for top/bottom edge detection
  const verticalAnalysis = calculateDensityAndDerivatives(
    frameHeight,
    density => {
      for (let i = 0; i < stats.topEdges.length; i++) {
        const top = stats.topEdges[i] ?? 0
        const bottom = stats.bottomEdges[i] ?? 0

        for (let y = Math.max(0, top); y <= Math.min(frameHeight - 1, bottom); y++) {
          // Safe: density array was initialized with size=frameHeight, and y is bounded to [0, frameHeight-1]
          ;(density[y] as number)++
        }
      }
    },
    frameHeight - 1
  )

  // Step 6: Calculate final crop bounds
  const cropBounds = calculateCropBounds(
    anchorInfo,
    verticalAnalysis,
    stats,
    frameWidth,
    frameHeight,
    boxWidth,
    boxHeight
  )

  // Step 7: Count caption boxes (those near the vertical mode)
  const captionBoxCount = stats.centerYValues.filter(
    y => Math.abs(y - verticalPosition) < verticalStd * 2
  ).length

  return {
    cropBounds: {
      left: cropBounds.cropLeft,
      top: cropBounds.cropTop,
      right: cropBounds.cropRight,
      bottom: cropBounds.cropBottom,
    },
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

// POST - Reset crop bounds by re-analyzing OCR data
export async function action({ params }: ActionFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const db = getDatabase(videoId)
    if (db instanceof Response) return db

    // Get current layout config for frame dimensions
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfig
      | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get unique frame indices
    const frameIndices = db
      .prepare(
        `
      SELECT DISTINCT frame_index
      FROM full_frame_ocr
      ORDER BY frame_index
    `
      )
      .all() as Array<{ frame_index: number }>

    if (frameIndices.length === 0) {
      db.close()
      return new Response(JSON.stringify({ error: 'No OCR data found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Count caption boxes to determine if we need fallback
    const totalBoxStats = db
      .prepare(
        `
      SELECT
        COUNT(*) as total_boxes,
        SUM(CASE WHEN o.predicted_label = 'in' THEN 1 ELSE 0 END) as predicted_in,
        SUM(CASE WHEN l.label = 'in' AND l.label_source = 'user' THEN 1 ELSE 0 END) as user_labeled_in,
        SUM(CASE WHEN l.label = 'out' AND l.label_source = 'user' THEN 1 ELSE 0 END) as user_labeled_out
      FROM full_frame_ocr o
      LEFT JOIN full_frame_box_labels l
        ON o.frame_index = l.frame_index
        AND o.box_index = l.box_index
        AND l.annotation_source = 'full_frame'
    `
      )
      .get() as {
      total_boxes: number
      predicted_in: number
      user_labeled_in: number
      user_labeled_out: number
    }

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

    console.log(`[Reset Crop Bounds] Total OCR boxes: ${totalBoxStats.total_boxes}`)
    console.log(`[Reset Crop Bounds] Predicted as captions: ${totalBoxStats.predicted_in}`)
    console.log(
      `[Reset Crop Bounds] User labeled IN: ${totalBoxStats.user_labeled_in}, OUT: ${totalBoxStats.user_labeled_out}`
    )
    console.log(
      `[Reset Crop Bounds] Using ${captionBoxCount.count} caption boxes for anchor detection (predicted + user overrides)`
    )

    // Check if there are any caption boxes to analyze
    // If model predicted everything as 'out' and user hasn't labeled anything,
    // fall back to using ALL boxes for initial analysis
    const useAllBoxesFallback = captionBoxCount.count === 0

    // Get unique frame indices with caption boxes
    // Uses predictions with user label overrides
    // Falls back to ALL boxes if model predicted everything as 'out'
    const captionFrameIndices = db
      .prepare(
        useAllBoxesFallback
          ? `
      SELECT DISTINCT frame_index
      FROM full_frame_ocr
      ORDER BY frame_index
    `
          : `
      SELECT DISTINCT o.frame_index
      FROM full_frame_ocr o
      LEFT JOIN full_frame_box_labels l
        ON o.frame_index = l.frame_index
        AND o.box_index = l.box_index
        AND l.annotation_source = 'full_frame'
      WHERE (
        (l.label IS NULL AND o.predicted_label = 'in')
        OR
        (l.label_source = 'user' AND l.label = 'in')
      )
      ORDER BY o.frame_index
    `
      )
      .all() as Array<{ frame_index: number }>

    if (useAllBoxesFallback) {
      console.log(
        `[Reset Crop Bounds] No caption boxes predicted/labeled - using ALL ${totalBoxStats.total_boxes} boxes for initial analysis`
      )
    }

    // Build frames with caption boxes (or all boxes if fallback)
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
            OR
            (l.label_source = 'user' AND l.label = 'in')
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

      // Convert to legacy OCR format: [[text, conf, [x, y, w, h]], ...]
      // Note: OCR format uses bottom-referenced y coordinate (0 = bottom, 1 = top)
      const ocrAnnotations = boxes.map(box => [
        box.box_text,
        1.0,
        [
          box.box_left / layoutConfig.frame_width,
          (layoutConfig.frame_height - box.box_bottom) / layoutConfig.frame_height, // Convert from top-referenced to bottom-referenced
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

    console.log(`Analyzing ${frames.length} frames for crop bounds reset`)

    // Analyze OCR boxes to determine optimal bounds
    const analysis = analyzeOCRBoxes(frames, layoutConfig.frame_width, layoutConfig.frame_height)

    // Begin transaction
    db.prepare('BEGIN TRANSACTION').run()

    try {
      // Get current model version to record with bounds
      const modelInfo = db
        .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
        .get() as { model_version: string } | undefined
      const currentModelVersion = modelInfo?.model_version ?? null

      // Update crop bounds and increment version
      db.prepare(
        `
        UPDATE video_layout_config
        SET crop_left = ?,
            crop_top = ?,
            crop_right = ?,
            crop_bottom = ?,
            crop_bounds_version = crop_bounds_version + 1,
            analysis_model_version = ?,
            updated_at = datetime('now')
        WHERE id = 1
      `
      ).run(
        analysis.cropBounds.left,
        analysis.cropBounds.top,
        analysis.cropBounds.right,
        analysis.cropBounds.bottom,
        currentModelVersion
      )

      // Update layout parameters
      db.prepare(
        `
        UPDATE video_layout_config
        SET vertical_position = ?,
            vertical_std = ?,
            box_height = ?,
            box_height_std = ?,
            anchor_type = ?,
            anchor_position = ?,
            top_edge_std = ?,
            bottom_edge_std = ?
        WHERE id = 1
      `
      ).run(
        analysis.layoutParams.verticalPosition,
        analysis.layoutParams.verticalStd,
        analysis.layoutParams.boxHeight,
        analysis.layoutParams.boxHeightStd,
        analysis.layoutParams.anchorType,
        analysis.layoutParams.anchorPosition,
        analysis.layoutParams.topEdgeStd,
        analysis.layoutParams.bottomEdgeStd
      )

      // Note: Frame invalidation not needed for full_frame_ocr workflow
      // The cropped frames will be regenerated when layout is marked complete

      db.prepare('COMMIT').run()

      console.log(`Reset crop bounds: updated layout config`)

      db.close()

      return new Response(
        JSON.stringify({
          success: true,
          newCropBounds: analysis.cropBounds,
          analysisData: analysis.stats,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } catch (error) {
      db.prepare('ROLLBACK').run()
      throw error
    }
  } catch (error) {
    console.error('Error resetting crop bounds:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
