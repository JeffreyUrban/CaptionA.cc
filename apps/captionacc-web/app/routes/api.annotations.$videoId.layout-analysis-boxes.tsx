import { type LoaderFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { predictBoxLabel } from '~/utils/box-prediction'

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

    // Fetch all OCR boxes from full_frame_ocr table with predictions
    const boxes = db.prepare(`
      SELECT
        id,
        frame_index,
        box_index,
        x, y, width, height,
        predicted_label,
        predicted_confidence
      FROM full_frame_ocr
      ORDER BY frame_index, box_index
    `).all() as Array<{
      id: number
      frame_index: number
      box_index: number
      x: number
      y: number
      width: number
      height: number
      predicted_label: 'in' | 'out' | null
      predicted_confidence: number | null
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

    // Prepare statement to update predictions if missing
    const updatePredictionStmt = db.prepare(`
      UPDATE full_frame_ocr
      SET
        predicted_label = ?,
        predicted_confidence = ?,
        predicted_at = datetime('now')
      WHERE id = ?
    `)

    // Convert to box data with predictions (calculate on-the-fly if missing)
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

      // Check for user annotation
      const userLabel = annotationMap.get(`${box.frame_index}-${box.box_index}`) || null

      // Use stored prediction if available, otherwise calculate and store
      let predictedLabel: 'in' | 'out'
      let predictedConfidence: number

      if (box.predicted_label && box.predicted_confidence !== null) {
        // Use stored prediction
        predictedLabel = box.predicted_label
        predictedConfidence = box.predicted_confidence
      } else {
        // Calculate prediction on-the-fly
        const prediction = predictBoxLabel(bounds, layoutConfig, db)
        predictedLabel = prediction.label
        predictedConfidence = prediction.confidence

        // Store for next time
        updatePredictionStmt.run(predictedLabel, predictedConfidence, box.id)
      }

      return {
        bounds,
        predictedLabel,
        predictedConfidence,
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
