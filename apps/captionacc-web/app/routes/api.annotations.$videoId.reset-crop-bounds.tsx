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

  // Determine anchor type using both peak density and center of mass
  // - Peak density: for detecting left/right alignment (boxes cluster at one edge)
  // - Center of mass: for detecting center alignment (distribution balanced around center)

  // ============================================================================
  // Anchor Detection Parameters
  // ============================================================================
  // Sliding window configuration (for peak density analysis)
  const MIN_WINDOW_SIZE_PX = 30                    // Minimum window size in pixels
  const DENSITY_SAMPLE_STEP_FRACTION = 0.5         // Sample every N box widths (0.5 = half box width)
  const MIN_DENSITY_SAMPLE_STEP_PX = 10            // Minimum step size in pixels

  // Peak analysis thresholds (measured in box widths)
  const PEAK_COLOCATION_THRESHOLD_BOX_WIDTHS = 2.0  // Max distance for peaks to be "colocated"

  // Center of mass thresholds (measured in box widths)
  const CENTER_OF_MASS_THRESHOLD_BOX_WIDTHS = 1.0   // Max distance from frame center for center alignment

  // Density comparison thresholds
  const DENSITY_DOMINANCE_RATIO = 1.2              // Minimum ratio for one side to dominate (20% stronger)
  // ============================================================================

  // Calculate center of mass (mean position) for each metric
  const meanLeftEdge = stats.leftEdges.reduce((sum, val) => sum + val, 0) / stats.leftEdges.length
  const meanRightEdge = stats.rightEdges.reduce((sum, val) => sum + val, 0) / stats.rightEdges.length
  const meanCenterX = stats.centerXValues.reduce((sum, val) => sum + val, 0) / stats.centerXValues.length

  // Calculate peak density for left/right alignment detection
  const windowSize = Math.max(boxWidth, MIN_WINDOW_SIZE_PX)

  const calculateDensity = (values: number[], position: number, window: number): number => {
    return values.filter(v => Math.abs(v - position) <= window / 2).length
  }

  // Test positions across the frame
  const step = Math.max(Math.floor(boxWidth * DENSITY_SAMPLE_STEP_FRACTION), MIN_DENSITY_SAMPLE_STEP_PX)
  const positions: number[] = []
  for (let pos = 0; pos <= frameWidth; pos += step) {
    positions.push(pos)
  }

  let maxLeftDensity = 0
  let maxRightDensity = 0
  let leftPeakPos = 0
  let rightPeakPos = 0

  for (const pos of positions) {
    const leftDensity = calculateDensity(stats.leftEdges, pos, windowSize)
    const rightDensity = calculateDensity(stats.rightEdges, pos, windowSize)

    if (leftDensity > maxLeftDensity) {
      maxLeftDensity = leftDensity
      leftPeakPos = pos
    }
    if (rightDensity > maxRightDensity) {
      maxRightDensity = rightDensity
      rightPeakPos = pos
    }
  }

  // Determine anchor type using both metrics
  const frameCenterX = frameWidth / 2
  const centerOfMassNearFrameCenter = Math.abs(meanCenterX - frameCenterX) < boxWidth * CENTER_OF_MASS_THRESHOLD_BOX_WIDTHS
  const peaksColocated = Math.abs(leftPeakPos - rightPeakPos) < boxWidth * PEAK_COLOCATION_THRESHOLD_BOX_WIDTHS

  let anchorType: 'left' | 'center' | 'right'
  let anchorPosition: number

  if (centerOfMassNearFrameCenter && peaksColocated) {
    // Center of mass is at frame center AND peaks are colocated = center alignment
    anchorType = 'center'
    anchorPosition = Math.round(meanCenterX)
  } else if (maxRightDensity > maxLeftDensity * DENSITY_DOMINANCE_RATIO) {
    // Right peak is significantly stronger = right alignment
    anchorType = 'right'
    anchorPosition = rightPeakPos
  } else if (maxLeftDensity > maxRightDensity * DENSITY_DOMINANCE_RATIO) {
    // Left peak is significantly stronger = left alignment
    anchorType = 'left'
    anchorPosition = leftPeakPos
  } else {
    // Similar densities - check center of mass
    if (centerOfMassNearFrameCenter) {
      anchorType = 'center'
      anchorPosition = Math.round(meanCenterX)
    } else {
      // Default to stronger peak
      anchorType = maxRightDensity > maxLeftDensity ? 'right' : 'left'
      anchorPosition = maxRightDensity > maxLeftDensity ? rightPeakPos : leftPeakPos
    }
  }

  console.log(`[Anchor Detection] boxWidth=${boxWidth}, windowSize=${windowSize}`)
  console.log(`[Anchor Detection] Center of mass: left=${Math.round(meanLeftEdge)}, right=${Math.round(meanRightEdge)}, center=${Math.round(meanCenterX)}`)
  console.log(`[Anchor Detection] Frame center: ${Math.round(frameCenterX)}, offset: ${Math.round(meanCenterX - frameCenterX)}px`)
  console.log(`[Anchor Detection] Peak density: left pos=${leftPeakPos} (density=${maxLeftDensity}), right pos=${rightPeakPos} (density=${maxRightDensity})`)
  console.log(`[Anchor Detection] Center at frame center: ${centerOfMassNearFrameCenter}, peaks colocated: ${peaksColocated}`)
  console.log(`[Anchor Detection] Chosen: ${anchorType} at ${anchorPosition}`)

  // Calculate crop bounds using anchor as a prior
  // Vertical bounds: Use edge-specific standard deviations (3 sigma)
  const cropTop = Math.max(0, topMode - Math.ceil(topEdgeStd * 3))
  const cropBottom = Math.min(frameHeight, bottomMode + Math.ceil(bottomEdgeStd * 3))

  // Horizontal bounds: Use anchor type to determine strategy
  let cropLeft: number
  let cropRight: number

  const HORIZONTAL_PADDING_PX = 50  // Padding beyond box edges

  if (anchorType === 'center') {
    // For center anchors: make bounds symmetric around anchor position
    const leftDistance = anchorPosition - stats.minLeft
    const rightDistance = stats.maxRight - anchorPosition
    const maxDistance = Math.max(leftDistance, rightDistance)

    cropLeft = Math.max(0, anchorPosition - maxDistance - HORIZONTAL_PADDING_PX)
    cropRight = Math.min(frameWidth, anchorPosition + maxDistance + HORIZONTAL_PADDING_PX)

    console.log(`[Crop Bounds] Center anchor: symmetric bounds at ${anchorPosition} ± ${maxDistance + HORIZONTAL_PADDING_PX}px`)
  } else {
    // For left/right anchors: use natural bounds with padding
    cropLeft = Math.max(0, stats.minLeft - HORIZONTAL_PADDING_PX)
    cropRight = Math.min(frameWidth, stats.maxRight + HORIZONTAL_PADDING_PX)

    console.log(`[Crop Bounds] ${anchorType} anchor: natural bounds [${cropLeft}, ${cropRight}]`)
  }

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
    // NOTE: Anchor detection uses predicted caption boxes (predicted_label='in'),
    // with user labels as overrides. This allows automatic anchor detection after
    // prediction, while respecting manual corrections.
    const captionFrameIndices = db.prepare(`
      SELECT DISTINCT o.frame_index
      FROM full_frame_ocr o
      LEFT JOIN full_frame_box_labels l
        ON o.frame_index = l.frame_index
        AND o.box_index = l.box_index
        AND l.annotation_source = 'full_frame'
      WHERE (
        -- Use prediction if no user label
        (l.label IS NULL AND o.predicted_label = 'in')
        OR
        -- Or use user label if it's 'in'
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
