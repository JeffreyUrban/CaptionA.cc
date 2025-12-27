import { type ActionFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

interface FrameOCR {
  frame_index: number
  ocr_text: string
  ocr_annotations: string  // JSON: [[text, conf, [x, y, w, h]], ...]
  ocr_confidence: number
}

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
  topEdges: number[]  // For calculating top_edge_std
  bottomEdges: number[]  // For calculating bottom_edge_std
  centerYValues: number[]
  heightValues: number[]
  widthValues: number[]
  leftEdges: number[]
  rightEdges: number[]
  centerXValues: number[]
}

function getDatabase(videoId: string) {
  const dbPath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'annotations.db'
  )

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

/**
 * Calculate median from array of numbers.
 * More robust than mode for finding central tendency.
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
  } else {
    return sorted[mid]!
  }
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
    bins.set(bin, (bins.get(bin) || 0) + 1)
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

/**
 * Analyze all OCR boxes to determine optimal crop bounds and layout parameters.
 */
function analyzeOCRBoxes(
  frames: FrameOCR[],
  frameWidth: number,
  frameHeight: number
): { cropBounds: { left: number; top: number; right: number; bottom: number }; layoutParams: any; stats: any } {
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

  // Collect all box statistics
  for (const frame of frames) {
    let ocrAnnotations: any[] = []
    try {
      ocrAnnotations = JSON.parse(frame.ocr_annotations || '[]')
    } catch (e) {
      continue
    }

    for (const annotation of ocrAnnotations) {
      // OCR annotation format: [text, confidence, [x, y, width, height]]
      // Coordinates are fractional [0-1]
      // IMPORTANT: y is bottom-referenced (0 = bottom, 1 = top)
      const [_text, _conf, [x, y, width, height]] = annotation

      // Convert fractional to pixels (convert y from bottom-referenced to top-referenced)
      const boxLeft = Math.floor(x * frameWidth)
      const boxBottom = Math.floor((1 - y) * frameHeight)  // Convert from bottom-referenced to top-referenced
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

  if (totalBoxes === 0) {
    throw new Error('No OCR boxes found in video')
  }

  // Calculate modes and standard deviations
  const verticalPosition = calculateMode(stats.centerYValues, 5)
  const verticalStd = calculateStd(stats.centerYValues, verticalPosition)

  const boxHeight = calculateMode(stats.heightValues, 2)
  const boxHeightStd = calculateStd(stats.heightValues, boxHeight)

  const boxWidth = calculateMode(stats.widthValues, 2)
  const boxWidthStd = calculateStd(stats.widthValues, boxWidth)

  // Calculate edge standard deviations for crop bounds
  // CRITICAL: Filter outliers before calculating std dev to get tight bounds around main cluster
  const topMode = calculateMode(stats.topEdges, 5)
  const topEdgesFiltered = stats.topEdges.filter(val => Math.abs(val - topMode) < 100) // Remove outliers >100px from mode
  const topEdgeStd = calculateStd(topEdgesFiltered, topMode)

  const bottomMode = calculateMode(stats.bottomEdges, 5)
  const bottomEdgesFiltered = stats.bottomEdges.filter(val => Math.abs(val - bottomMode) < 100)
  const bottomEdgeStd = calculateStd(bottomEdgesFiltered, bottomMode)

  // Determine anchor type by finding edges of box clusters using derivative analysis
  // Left anchor: point with highest positive derivative (boxes start piling up)
  // Right anchor: point with highest negative derivative (boxes stop piling up)
  // Center anchor: symmetric density around center

  // Calculate box density at each horizontal position (count boxes at vertical centerline)
  const densityByX = new Array(frameWidth).fill(0)

  for (let i = 0; i < stats.leftEdges.length; i++) {
    const left = stats.leftEdges[i]!
    const right = stats.rightEdges[i]!
    const centerY = stats.centerYValues[i]!

    // Only count boxes near the vertical center (caption region)
    if (Math.abs(centerY - verticalPosition) < verticalStd * 2) {
      for (let x = Math.max(0, left); x <= Math.min(frameWidth - 1, right); x++) {
        densityByX[x]++
      }
    }
  }

  // Calculate derivatives (change in density)
  const derivatives = new Array(frameWidth - 1).fill(0)
  for (let x = 0; x < frameWidth - 1; x++) {
    derivatives[x] = densityByX[x + 1]! - densityByX[x]!
  }

  // Find highest positive derivative (left edge where density increases)
  let maxPositiveDerivative = 0
  let leftEdgePos = 0
  for (let x = 0; x < derivatives.length; x++) {
    if (derivatives[x]! > maxPositiveDerivative) {
      maxPositiveDerivative = derivatives[x]!
      leftEdgePos = x
    }
  }

  // Find highest negative derivative (right edge where density decreases)
  let maxNegativeDerivative = 0
  let rightEdgePos = frameWidth - 1
  for (let x = 0; x < derivatives.length; x++) {
    if (derivatives[x]! < maxNegativeDerivative) {
      maxNegativeDerivative = derivatives[x]!
      rightEdgePos = x
    }
  }

  // Calculate center of mass for center detection
  const meanCenterX = stats.centerXValues.reduce((sum, val) => sum + val, 0) / stats.centerXValues.length
  const frameCenterX = frameWidth / 2

  // Determine anchor type
  let anchorType: 'left' | 'center' | 'right'
  let anchorPosition: number

  const centerOfMassNearFrameCenter = Math.abs(meanCenterX - frameCenterX) < boxWidth * 1.0
  const leftEdgeStrength = maxPositiveDerivative
  const rightEdgeStrength = Math.abs(maxNegativeDerivative)

  if (centerOfMassNearFrameCenter && Math.abs(leftEdgeStrength - rightEdgeStrength) < leftEdgeStrength * 0.3) {
    // Centered and symmetric edges = center anchor
    anchorType = 'center'
    anchorPosition = Math.round(meanCenterX)
  } else if (leftEdgeStrength > rightEdgeStrength * 1.2) {
    // Strong left edge = left anchor
    anchorType = 'left'
    anchorPosition = leftEdgePos
  } else if (rightEdgeStrength > leftEdgeStrength * 1.2) {
    // Strong right edge = right anchor
    anchorType = 'right'
    anchorPosition = rightEdgePos
  } else {
    // Default to stronger edge
    if (leftEdgeStrength >= rightEdgeStrength) {
      anchorType = 'left'
      anchorPosition = leftEdgePos
    } else {
      anchorType = 'right'
      anchorPosition = rightEdgePos
    }
  }

  console.log(`[Anchor Detection] Horizontal - Left edge at x=${leftEdgePos} (derivative=${maxPositiveDerivative})`)
  console.log(`[Anchor Detection] Horizontal - Right edge at x=${rightEdgePos} (derivative=${maxNegativeDerivative})`)
  console.log(`[Anchor Detection] Horizontal - Center of mass: ${Math.round(meanCenterX)}, frame center: ${frameCenterX}`)
  console.log(`[Anchor Detection] Horizontal - Chosen: ${anchorType} at ${anchorPosition}`)

  // Apply same derivative method for vertical bounds (top/bottom of caption region)
  // Calculate box density at each vertical position
  const densityByY = new Array(frameHeight).fill(0)

  for (let i = 0; i < stats.topEdges.length; i++) {
    const top = stats.topEdges[i]!
    const bottom = stats.bottomEdges[i]!
    const centerX = stats.centerXValues[i]!

    // Only count boxes near the horizontal center (caption region)
    // Use a wide horizontal range to capture all caption boxes
    for (let y = Math.max(0, top); y <= Math.min(frameHeight - 1, bottom); y++) {
      densityByY[y]++
    }
  }

  // Calculate vertical derivatives (change in density)
  const verticalDerivatives = new Array(frameHeight - 1).fill(0)
  for (let y = 0; y < frameHeight - 1; y++) {
    verticalDerivatives[y] = densityByY[y + 1]! - densityByY[y]!
  }

  // Find highest positive derivative (top edge where density increases moving down)
  let maxPositiveVerticalDerivative = 0
  let topEdgePos = 0
  for (let y = 0; y < verticalDerivatives.length; y++) {
    if (verticalDerivatives[y]! > maxPositiveVerticalDerivative) {
      maxPositiveVerticalDerivative = verticalDerivatives[y]!
      topEdgePos = y
    }
  }

  // Find highest negative derivative (bottom edge where density decreases moving down)
  let maxNegativeVerticalDerivative = 0
  let bottomEdgePos = frameHeight - 1
  for (let y = 0; y < verticalDerivatives.length; y++) {
    if (verticalDerivatives[y]! < maxNegativeVerticalDerivative) {
      maxNegativeVerticalDerivative = verticalDerivatives[y]!
      bottomEdgePos = y
    }
  }

  console.log(`[Anchor Detection] Vertical - Top edge at y=${topEdgePos} (derivative=${maxPositiveVerticalDerivative})`)
  console.log(`[Anchor Detection] Vertical - Bottom edge at y=${bottomEdgePos} (derivative=${maxNegativeVerticalDerivative})`)

  // Calculate crop bounds: detected edge position ± padding (fraction of box dimension)
  const PADDING_FRACTION = 0.1  // Add 1/10 of box dimension as padding

  const verticalPadding = Math.ceil(boxHeight * PADDING_FRACTION)
  const cropTop = Math.max(0, topEdgePos - verticalPadding)
  const cropBottom = Math.min(frameHeight, bottomEdgePos + verticalPadding)

  // Helper function: Fit polynomial to find where density reaches zero
  // Uses simple quadratic fit: y = ax² + bx + c
  // Only samples the trailing-off region where density is positive
  function findZeroCrossing(densities: number[], startX: number, endX: number, searchDirection: 'right' | 'left'): number {
    const points: Array<{x: number, y: number}> = []
    const minDensity = 1  // Stop when density drops below this

    if (searchDirection === 'right') {
      // Sample points from startX to the right until density drops to near-zero
      for (let x = startX; x <= endX && x < densities.length; x++) {
        const density = densities[x]!
        if (density < minDensity && points.length > 5) {
          // Found the edge of the trailing region
          break
        }
        if (density >= minDensity) {
          points.push({ x, y: density })
        }
      }
    } else {
      // Sample points from startX to the left until density drops to near-zero
      for (let x = startX; x >= endX && x >= 0; x--) {
        const density = densities[x]!
        if (density < minDensity && points.length > 5) {
          // Found the edge of the trailing region
          break
        }
        if (density >= minDensity) {
          points.push({ x, y: density })
        }
      }
    }

    if (points.length < 10) {
      // Not enough points to fit, find the last point with density > 0
      if (searchDirection === 'right') {
        for (let x = startX; x <= endX && x < densities.length; x++) {
          if (densities[x]! === 0) return x - 1
        }
        return endX
      } else {
        for (let x = startX; x >= endX && x >= 0; x--) {
          if (densities[x]! === 0) return x + 1
        }
        return endX
      }
    }

    // Fit quadratic using least squares: y = a*x² + b*x + c
    // Build normal equations for least squares
    let sumX = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0
    let sumY = 0, sumXY = 0, sumX2Y = 0
    const n = points.length

    for (const p of points) {
      sumX += p.x
      sumX2 += p.x * p.x
      sumX3 += p.x * p.x * p.x
      sumX4 += p.x * p.x * p.x * p.x
      sumY += p.y
      sumXY += p.x * p.y
      sumX2Y += p.x * p.x * p.y
    }

    // Solve 3x3 system for a, b, c
    // [sumX4  sumX3  sumX2] [a]   [sumX2Y]
    // [sumX3  sumX2  sumX ] [b] = [sumXY ]
    // [sumX2  sumX   n    ] [c]   [sumY  ]

    // Using Cramer's rule (simplified for this case)
    const det = sumX4 * (sumX2 * n - sumX * sumX) - sumX3 * (sumX3 * n - sumX * sumX2) + sumX2 * (sumX3 * sumX - sumX2 * sumX2)

    if (Math.abs(det) < 1e-10) {
      // Singular matrix, use linear fit instead
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
      const intercept = (sumY - slope * sumX) / n

      if (Math.abs(slope) < 1e-10) return searchDirection === 'right' ? endX : endX

      const zeroX = -intercept / slope
      return Math.round(zeroX)
    }

    const a = ((sumX2 * n - sumX * sumX) * sumX2Y - (sumX3 * n - sumX * sumX2) * sumXY + (sumX3 * sumX - sumX2 * sumX2) * sumY) / det
    const b = ((sumX4 * sumXY - sumX3 * sumX2Y) * n - (sumX4 * sumY - sumX2 * sumX2Y) * sumX + (sumX3 * sumY - sumX2 * sumXY) * sumX2) / det
    const c = ((sumX4 * (sumX2 * sumY - sumX * sumXY) - sumX3 * (sumX3 * sumY - sumX * sumX2Y)) + sumX2 * (sumX3 * sumXY - sumX2 * sumX2Y)) / det

    // Find zero crossing of quadratic: ax² + bx + c = 0
    if (Math.abs(a) > 1e-10) {
      // Quadratic formula
      const discriminant = b * b - 4 * a * c
      if (discriminant < 0) {
        // No real roots, use endpoint
        return searchDirection === 'right' ? endX : endX
      }

      const x1 = (-b + Math.sqrt(discriminant)) / (2 * a)
      const x2 = (-b - Math.sqrt(discriminant)) / (2 * a)

      // Choose the root in the search direction
      if (searchDirection === 'right') {
        return Math.round(Math.max(x1, x2))
      } else {
        return Math.round(Math.min(x1, x2))
      }
    } else {
      // Linear case
      if (Math.abs(b) < 1e-10) return searchDirection === 'right' ? endX : endX
      return Math.round(-c / b)
    }
  }

  // Horizontal bounds: Use detected anchor/edge position ± padding
  let cropLeft: number
  let cropRight: number

  const anchorPadding = Math.ceil(boxWidth * PADDING_FRACTION)  // Small padding for anchor side
  const farSidePadding = Math.ceil(boxWidth * 2)  // 2 box widths for far side
  const centerPadding = Math.ceil(boxWidth * 1)  // 1 box width for center anchor

  if (anchorType === 'center') {
    // For center anchors: 1 box width padding on each side
    const leftZero = findZeroCrossing(densityByX, anchorPosition, 0, 'left')
    const rightZero = findZeroCrossing(densityByX, anchorPosition, frameWidth - 1, 'right')

    cropLeft = Math.max(0, leftZero - centerPadding)
    cropRight = Math.min(frameWidth, rightZero + centerPadding)

    console.log(`[Crop Bounds] Horizontal - Center anchor at ${anchorPosition}: left zero at ${leftZero}, right zero at ${rightZero}, padding=${centerPadding}px each side`)
  } else if (anchorType === 'left') {
    // For left anchors: small padding on anchor side (left), 2 box widths on far side (right)
    cropLeft = Math.max(0, anchorPosition - anchorPadding)

    const rightZero = findZeroCrossing(densityByX, anchorPosition, frameWidth - 1, 'right')
    cropRight = Math.min(frameWidth, rightZero + farSidePadding)

    console.log(`[Crop Bounds] Horizontal - Left anchor at ${anchorPosition}: left=${cropLeft} (anchor-${anchorPadding}px), right zero at ${rightZero} → ${cropRight} (+${farSidePadding}px)`)
  } else {
    // For right anchors: 2 box widths on far side (left), small padding on anchor side (right)
    const leftZero = findZeroCrossing(densityByX, anchorPosition, 0, 'left')
    cropLeft = Math.max(0, leftZero - farSidePadding)

    cropRight = Math.min(frameWidth, anchorPosition + anchorPadding)

    console.log(`[Crop Bounds] Horizontal - Right anchor at ${anchorPosition}: left zero at ${leftZero} → ${cropLeft} (-${farSidePadding}px), right=${cropRight} (anchor+${anchorPadding}px)`)
  }

  console.log(`[Crop Bounds] Vertical - Top=${cropTop} (edge=${topEdgePos}-${verticalPadding}px), Bottom=${cropBottom} (edge=${bottomEdgePos}+${verticalPadding}px)`)
  console.log(`[Crop Bounds] Final bounds: [${cropLeft}, ${cropTop}] - [${cropRight}, ${cropBottom}] with padding=${PADDING_FRACTION}×box dimensions`)

  // Count caption boxes (those near the vertical mode)
  const captionBoxCount = stats.centerYValues.filter(
    y => Math.abs(y - verticalPosition) < verticalStd * 2
  ).length

  return {
    cropBounds: {
      left: cropLeft,
      top: cropTop,
      right: cropRight,
      bottom: cropBottom,
    },
    layoutParams: {
      verticalPosition,
      verticalStd,
      boxHeight,
      boxHeightStd,
      anchorType,
      anchorPosition,
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
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const db = getDatabase(videoId)

    // Get current layout config for frame dimensions
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get unique frame indices
    const frameIndices = db.prepare(`
      SELECT DISTINCT frame_index
      FROM full_frame_ocr
      ORDER BY frame_index
    `).all() as Array<{ frame_index: number }>

    if (frameIndices.length === 0) {
      db.close()
      return new Response(JSON.stringify({ error: 'No OCR data found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get unique frame indices with caption boxes
    // Uses predictions with user label overrides
    const captionFrameIndices = db.prepare(`
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
    `).all() as Array<{ frame_index: number }>

    // Build frames with caption boxes only
    const frames: FrameOCR[] = captionFrameIndices.map(({ frame_index }) => {
      const boxes = db.prepare(`
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
      `).all(
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
          (layoutConfig.frame_height - box.box_bottom) / layoutConfig.frame_height,  // Convert from top-referenced to bottom-referenced
          (box.box_right - box.box_left) / layoutConfig.frame_width,
          (box.box_bottom - box.box_top) / layoutConfig.frame_height
        ]
      ])

      return {
        frame_index,
        ocr_text: boxes.map(b => b.box_text).join(' '),
        ocr_annotations: JSON.stringify(ocrAnnotations),
        ocr_confidence: 1.0
      }
    })

    // Log summary of boxes used for anchor detection
    const totalBoxStats = db.prepare(`
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
    `).get() as { total_boxes: number; predicted_in: number; user_labeled_in: number; user_labeled_out: number }

    const captionBoxCount = db.prepare(`
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
    `).get() as { count: number }

    console.log(`[Reset Crop Bounds] Total OCR boxes: ${totalBoxStats.total_boxes}`)
    console.log(`[Reset Crop Bounds] Predicted as captions: ${totalBoxStats.predicted_in}`)
    console.log(`[Reset Crop Bounds] User labeled IN: ${totalBoxStats.user_labeled_in}, OUT: ${totalBoxStats.user_labeled_out}`)
    console.log(`[Reset Crop Bounds] Using ${captionBoxCount.count} caption boxes for anchor detection (predicted + user overrides)`)

    console.log(`Analyzing ${frames.length} frames for crop bounds reset`)

    // Analyze OCR boxes to determine optimal bounds
    const analysis = analyzeOCRBoxes(frames, layoutConfig.frame_width, layoutConfig.frame_height)

    // Begin transaction
    db.prepare('BEGIN TRANSACTION').run()

    try {
      // Update crop bounds and increment version
      db.prepare(`
        UPDATE video_layout_config
        SET crop_left = ?,
            crop_top = ?,
            crop_right = ?,
            crop_bottom = ?,
            crop_bounds_version = crop_bounds_version + 1,
            updated_at = datetime('now')
        WHERE id = 1
      `).run(
        analysis.cropBounds.left,
        analysis.cropBounds.top,
        analysis.cropBounds.right,
        analysis.cropBounds.bottom
      )

      // Update layout parameters
      db.prepare(`
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
      `).run(
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

      return new Response(JSON.stringify({
        success: true,
        newCropBounds: analysis.cropBounds,
        analysisData: analysis.stats,
      }), {
        headers: { 'Content-Type': 'application/json' }
      })

    } catch (error) {
      db.prepare('ROLLBACK').run()
      throw error
    }

  } catch (error) {
    console.error('Error resetting crop bounds:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
