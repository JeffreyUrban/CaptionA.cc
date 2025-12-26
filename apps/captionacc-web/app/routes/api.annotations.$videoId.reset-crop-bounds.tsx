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
  centerYValues: number[]
  heightValues: number[]
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
    centerYValues: [],
    heightValues: [],
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
      const [_text, _conf, [x, y, width, height]] = annotation

      // Convert fractional to pixels
      const boxLeft = Math.floor(x * frameWidth)
      const boxTop = Math.floor(y * frameHeight)
      const boxRight = boxLeft + Math.floor(width * frameWidth)
      const boxBottom = boxTop + Math.floor(height * frameHeight)

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

      // Collect values for mode calculation
      stats.centerYValues.push(boxCenterY)
      stats.heightValues.push(boxHeight)
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

  // Determine anchor type based on distribution of edges
  const leftMode = calculateMode(stats.leftEdges, 10)
  const rightMode = calculateMode(stats.rightEdges, 10)
  const centerMode = calculateMode(stats.centerXValues, 10)

  // Count how many boxes align to each anchor
  const leftAlignedCount = stats.leftEdges.filter(x => Math.abs(x - leftMode) < 20).length
  const rightAlignedCount = stats.rightEdges.filter(x => Math.abs(x - rightMode) < 20).length
  const centerAlignedCount = stats.centerXValues.filter(x => Math.abs(x - centerMode) < 20).length

  let anchorType: 'left' | 'center' | 'right' = 'left'
  let anchorPosition = leftMode

  if (centerAlignedCount > leftAlignedCount && centerAlignedCount > rightAlignedCount) {
    anchorType = 'center'
    anchorPosition = centerMode
  } else if (rightAlignedCount > leftAlignedCount) {
    anchorType = 'right'
    anchorPosition = rightMode
  }

  // Calculate crop bounds with padding
  const verticalPadding = Math.max(30, Math.ceil(verticalStd * 3))  // 3 std deviations or 30px min
  const horizontalPadding = 50

  const cropTop = Math.max(0, stats.minTop - verticalPadding)
  const cropBottom = Math.min(frameHeight, stats.maxBottom + verticalPadding)
  const cropLeft = Math.max(0, stats.minLeft - horizontalPadding)
  const cropRight = Math.min(frameWidth, stats.maxRight + horizontalPadding)

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
    },
    stats: {
      totalBoxes,
      captionBoxes: captionBoxCount,
      verticalPosition,
      boxHeight,
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

    // Get all frames with OCR data
    const frames = db.prepare('SELECT * FROM frames_ocr ORDER BY frame_index').all() as FrameOCR[]

    if (frames.length === 0) {
      db.close()
      return new Response(JSON.stringify({ error: 'No OCR data found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

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
            anchor_position = ?
        WHERE id = 1
      `).run(
        analysis.layoutParams.verticalPosition,
        analysis.layoutParams.verticalStd,
        analysis.layoutParams.boxHeight,
        analysis.layoutParams.boxHeightStd,
        analysis.layoutParams.anchorType,
        analysis.layoutParams.anchorPosition
      )

      // Invalidate all frames
      const result = db.prepare(`
        UPDATE frames_ocr
        SET crop_bounds_version = 0
      `).run()

      const framesInvalidated = result.changes

      db.prepare('COMMIT').run()

      console.log(`Reset crop bounds: invalidated ${framesInvalidated} frames`)

      db.close()

      return new Response(JSON.stringify({
        success: true,
        newCropBounds: analysis.cropBounds,
        analysisData: analysis.stats,
        framesInvalidated,
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
