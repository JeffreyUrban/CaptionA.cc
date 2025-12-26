import { type LoaderFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

interface VideoLayoutConfig {
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
  vertical_position: number | null
  vertical_std: number | null
  box_height: number | null
  box_height_std: number | null
  anchor_type: 'left' | 'center' | 'right' | null
  anchor_position: number | null
}

interface BoxData {
  bounds: { left: number; top: number; right: number; bottom: number }
  predictedLabel: 'in' | 'out'
  predictedConfidence: number
  userLabel: 'in' | 'out' | null
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
 * Simple heuristic prediction for box labels.
 * Matches the logic used in frame view for consistency.
 */
function predictBoxLabel(
  boxBounds: { left: number; top: number; right: number; bottom: number },
  layoutConfig: VideoLayoutConfig
): { label: 'in' | 'out'; confidence: number } {
  const { crop_left, crop_top, crop_right, crop_bottom } = layoutConfig

  // Check if box is inside crop bounds
  const insideCrop = (
    boxBounds.left >= crop_left &&
    boxBounds.top >= crop_top &&
    boxBounds.right <= crop_right &&
    boxBounds.bottom <= crop_bottom
  )

  if (!insideCrop) {
    // Outside crop bounds → definitely "out"
    return { label: 'out', confidence: 0.95 }
  }

  // Inside crop bounds - check alignment with layout params
  if (layoutConfig.vertical_position !== null && layoutConfig.box_height !== null) {
    const boxCenterY = (boxBounds.top + boxBounds.bottom) / 2
    const boxHeight = boxBounds.bottom - boxBounds.top

    const verticalDistance = Math.abs(boxCenterY - layoutConfig.vertical_position)
    const heightDifference = Math.abs(boxHeight - layoutConfig.box_height)

    const verticalStd = layoutConfig.vertical_std || 15
    const heightStd = layoutConfig.box_height_std || 5

    // Z-scores
    const verticalZScore = verticalDistance / verticalStd
    const heightZScore = heightDifference / heightStd

    // Good alignment if within ~2 std deviations
    if (verticalZScore < 2 && heightZScore < 2) {
      return { label: 'in', confidence: 0.7 + (1 - Math.min(verticalZScore, 2) / 2) * 0.2 }
    } else if (verticalZScore > 4 || heightZScore > 4) {
      return { label: 'out', confidence: 0.7 }
    } else {
      // Uncertain
      return { label: 'in', confidence: 0.5 }
    }
  }

  // Default: inside crop → probably caption
  return { label: 'in', confidence: 0.6 }
}

// GET - Fetch all OCR boxes for analysis view
export async function loader({ params }: LoaderFunctionArgs) {
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

    // Get layout config
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Fetch all OCR boxes from full_frame_ocr table
    const boxes = db.prepare(`
      SELECT
        frame_index,
        box_index,
        x, y, width, height
      FROM full_frame_ocr
      ORDER BY frame_index, box_index
    `).all() as Array<{
      frame_index: number
      box_index: number
      x: number
      y: number
      width: number
      height: number
    }>

    // Fetch user annotations (full_frame_box_labels)
    const annotations = db.prepare(`
      SELECT
        frame_index,
        box_index,
        label
      FROM full_frame_box_labels
    `).all() as Array<{
      frame_index: number
      box_index: number
      label: 'in' | 'out'
    }>

    // Create annotation map for fast lookup
    const annotationMap = new Map<string, 'in' | 'out'>()
    for (const ann of annotations) {
      annotationMap.set(`${ann.frame_index}-${ann.box_index}`, ann.label)
    }

    // Convert to box data with predictions and annotations
    const boxesData: BoxData[] = boxes.map((box) => {
      // Convert fractional coordinates to pixel coordinates
      // Note: y is from bottom in OCR data
      const left = Math.floor(box.x * layoutConfig.frame_width)
      const bottom = Math.floor((1 - box.y) * layoutConfig.frame_height)
      const boxWidth = Math.floor(box.width * layoutConfig.frame_width)
      const boxHeight = Math.floor(box.height * layoutConfig.frame_height)
      const top = bottom - boxHeight
      const right = left + boxWidth

      const bounds = { left, top, right, bottom }

      // Get prediction
      const prediction = predictBoxLabel(bounds, layoutConfig)

      // Check for user annotation
      const userLabel = annotationMap.get(`${box.frame_index}-${box.box_index}`) || null

      return {
        bounds,
        predictedLabel: prediction.label,
        predictedConfidence: prediction.confidence,
        userLabel,
      }
    })

    db.close()

    return new Response(JSON.stringify({ boxes: boxesData }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error fetching layout analysis boxes:', error)
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
