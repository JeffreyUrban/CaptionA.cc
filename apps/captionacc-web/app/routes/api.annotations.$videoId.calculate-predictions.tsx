import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type ActionFunctionArgs } from 'react-router'

import { predictBoxLabel, trainModel, initializeSeedModel } from '~/utils/box-prediction'
import { getDbPath } from '~/utils/video-paths'

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

// POST - Calculate and cache predictions for all boxes
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

    // Get layout config
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

    // Initialize seed model if no model exists yet
    initializeSeedModel(db)

    // Train model using user annotations (replaces seed model if 10+ annotations available)
    const trainingCount = trainModel(db, layoutConfig)
    if (trainingCount) {
      console.log(`[Calculate Predictions] Model retrained with ${trainingCount} annotations`)
    } else {
      console.log(
        '[Calculate Predictions] Using seed model or heuristics (insufficient training data)'
      )
    }

    // Get model version if available
    const modelRow = db
      .prepare('SELECT model_version FROM box_classification_model WHERE id = 1')
      .get() as { model_version: string } | undefined
    const modelVersion = modelRow?.model_version || 'heuristic_v1'

    // Fetch all OCR boxes
    const boxes = db
      .prepare(
        `
      SELECT
        id,
        frame_index,
        box_index,
        x, y, width, height
      FROM full_frame_ocr
      ORDER BY frame_index, box_index
    `
      )
      .all() as Array<{
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

    // Group boxes by frame for local feature extraction
    const boxesByFrame = new Map<number, typeof boxes>()
    for (const box of boxes) {
      if (!boxesByFrame.has(box.frame_index)) {
        boxesByFrame.set(box.frame_index, [])
      }
      boxesByFrame.get(box.frame_index)!.push(box)
    }

    console.log(`[Calculate Predictions] Processing ${boxesByFrame.size} frames...`)

    // Calculate and store predictions frame by frame
    for (const [frameIndex, frameBoxes] of boxesByFrame) {
      // Convert all boxes in this frame to BoxBounds for feature extraction
      const allBoxBounds = frameBoxes.map(b => {
        const left = Math.floor(b.x * layoutConfig.frame_width)
        const bottom = Math.floor((1 - b.y) * layoutConfig.frame_height)
        const boxWidth = Math.floor(b.width * layoutConfig.frame_width)
        const boxHeight = Math.floor(b.height * layoutConfig.frame_height)
        const top = bottom - boxHeight
        const right = left + boxWidth
        return { left, top, right, bottom }
      })

      // Process each box in this frame
      for (let i = 0; i < frameBoxes.length; i++) {
        const box = frameBoxes[i]!
        const bounds = allBoxBounds[i]!

        // Get prediction with all boxes from this frame
        const prediction = predictBoxLabel(
          bounds,
          layoutConfig,
          allBoxBounds,
          box.frame_index,
          box.box_index,
          db
        )

        // Update database
        updateStmt.run(prediction.label, prediction.confidence, modelVersion, box.id)

        processedCount++

        // Log progress every 1000 boxes
        if (processedCount % 1000 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          console.log(
            `[Calculate Predictions] Processed ${processedCount}/${boxes.length} boxes (${elapsed}s)`
          )
        }
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[Calculate Predictions] Completed ${processedCount} boxes in ${totalTime}s`)

    db.close()

    return new Response(
      JSON.stringify({
        success: true,
        processedCount,
        totalTime: parseFloat(totalTime),
        modelVersion,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error calculating predictions:', error)
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
