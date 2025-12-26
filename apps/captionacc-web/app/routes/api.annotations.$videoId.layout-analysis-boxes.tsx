import { type LoaderFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

interface VideoLayoutConfig {
  frame_width: number
  frame_height: number
  selection_left: number | null
  selection_top: number | null
  selection_right: number | null
  selection_bottom: number | null
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
 * Simple heuristic prediction: boxes inside selection rectangle are "in"
 */
function predictBoxLabel(
  box: { left: number; top: number; right: number; bottom: number },
  selectionRect: { left: number; top: number; right: number; bottom: number } | null
): { label: 'in' | 'out'; confidence: number } {
  if (!selectionRect) {
    return { label: 'out', confidence: 0.5 }
  }

  const inside =
    box.left >= selectionRect.left &&
    box.top >= selectionRect.top &&
    box.right <= selectionRect.right &&
    box.bottom <= selectionRect.bottom

  return {
    label: inside ? 'in' : 'out',
    confidence: inside ? 0.85 : 0.9,
  }
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

    const selectionRect = (
      layoutConfig.selection_left !== null &&
      layoutConfig.selection_top !== null &&
      layoutConfig.selection_right !== null &&
      layoutConfig.selection_bottom !== null
    ) ? {
      left: layoutConfig.selection_left,
      top: layoutConfig.selection_top,
      right: layoutConfig.selection_right,
      bottom: layoutConfig.selection_bottom,
    } : null

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
      const prediction = predictBoxLabel(bounds, selectionRect)

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
