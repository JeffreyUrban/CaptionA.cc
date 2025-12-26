import { type ActionFunctionArgs } from 'react-router'
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
  vertical_position: number | null
  vertical_std: number | null
  box_height: number | null
  box_height_std: number | null
  anchor_type: 'left' | 'center' | 'right' | null
  anchor_position: number | null
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

// POST - Calculate and cache predictions for all boxes
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

    // Get layout config
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get model version if available
    const modelRow = db.prepare('SELECT model_version FROM box_classification_model WHERE id = 1').get() as { model_version: string } | undefined
    const modelVersion = modelRow?.model_version || 'heuristic_v1'

    // Fetch all OCR boxes
    const boxes = db.prepare(`
      SELECT
        id,
        frame_index,
        box_index,
        x, y, width, height
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
    }>

    console.log(`[Calculate Predictions] Processing ${boxes.length} boxes...`)

    // Prepare update statement
    const updateStmt = db.prepare(`
      UPDATE full_frame_ocr
      SET
        predicted_label = ?,
        predicted_confidence = ?,
        model_version = ?,
        predicted_at = datetime('now')
      WHERE id = ?
    `)

    let processedCount = 0
    const startTime = Date.now()

    // Calculate and store predictions
    for (const box of boxes) {
      // Convert fractional coordinates to pixel coordinates
      const left = Math.floor(box.x * layoutConfig.frame_width)
      const bottom = Math.floor((1 - box.y) * layoutConfig.frame_height)
      const boxWidth = Math.floor(box.width * layoutConfig.frame_width)
      const boxHeight = Math.floor(box.height * layoutConfig.frame_height)
      const top = bottom - boxHeight
      const right = left + boxWidth

      const bounds = { left, top, right, bottom }

      // Get prediction
      const prediction = predictBoxLabel(bounds, layoutConfig, db)

      // Update database
      updateStmt.run(
        prediction.label,
        prediction.confidence,
        modelVersion,
        box.id
      )

      processedCount++

      // Log progress every 1000 boxes
      if (processedCount % 1000 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`[Calculate Predictions] Processed ${processedCount}/${boxes.length} boxes (${elapsed}s)`)
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[Calculate Predictions] Completed ${processedCount} boxes in ${totalTime}s`)

    db.close()

    return new Response(JSON.stringify({
      success: true,
      processedCount,
      totalTime: parseFloat(totalTime),
      modelVersion
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error calculating predictions:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
