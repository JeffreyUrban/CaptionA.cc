import { type ActionFunctionArgs } from 'react-router'
import { getDbPath } from '~/utils/video-paths'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { predictBoxLabel } from '~/utils/box-prediction'

interface BulkAnnotateAllRequest {
  rectangle: {
    left: number
    top: number
    right: number
    bottom: number
  }
  action: 'mark_out' | 'clear'
}

function getDatabase(videoId: string) {
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

// POST - Bulk annotate boxes across all 0.1Hz analysis frames
export async function action({ params, request }: ActionFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const body = await request.json() as BulkAnnotateAllRequest
    const { rectangle, action } = body

    if (!rectangle || !action) {
      return new Response(JSON.stringify({ error: 'Missing rectangle or action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const db = getDatabase(videoId)

    // Get layout config for frame dimensions and predictions
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as {
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
    } | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get model version if available
    const modelInfo = db.prepare('SELECT model_version FROM box_classification_model WHERE id = 1').get() as { model_version: string } | undefined
    const modelVersion = modelInfo?.model_version || null

    // Get all unique frame indices from full_frame_ocr table
    const frames = db.prepare(`
      SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index
    `).all() as Array<{ frame_index: number }>

    let totalAnnotatedBoxes = 0
    let newlyAnnotatedBoxes = 0
    const framesProcessed: number[] = []

    // Process each frame
    for (const { frame_index: frameIndex } of frames) {
      // Load OCR boxes for this frame
      const ocrBoxes = db.prepare(`
        SELECT box_index, text, confidence, x, y, width, height
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `).all(frameIndex) as Array<{
        box_index: number
        text: string
        confidence: number
        x: number
        y: number
        width: number
        height: number
      }>

      // Convert all boxes to bounds for feature extraction
      const allBoxBounds = ocrBoxes.map(box => {
        const boxLeft = Math.floor(box.x * layoutConfig.frame_width)
        const boxBottom = Math.floor((1 - box.y) * layoutConfig.frame_height)
        const boxTop = boxBottom - Math.floor(box.height * layoutConfig.frame_height)
        const boxRight = boxLeft + Math.floor(box.width * layoutConfig.frame_width)
        return { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom }
      })

      const boxesInRectangle: number[] = []

      // Find all boxes that intersect with rectangle
      for (const box of ocrBoxes) {
        // Convert fractional to pixels (top-referenced)
        const boxLeft = Math.floor(box.x * layoutConfig.frame_width)
        const boxBottom = Math.floor((1 - box.y) * layoutConfig.frame_height)
        const boxTop = boxBottom - Math.floor(box.height * layoutConfig.frame_height)
        const boxRight = boxLeft + Math.floor(box.width * layoutConfig.frame_width)

        // Check if box intersects with rectangle
        const intersects = !(
          boxRight < rectangle.left ||
          boxLeft > rectangle.right ||
          boxBottom < rectangle.top ||
          boxTop > rectangle.bottom
        )

        if (intersects) {
          boxesInRectangle.push(box.box_index)
        }
      }

      // Apply action to all intersecting boxes in this frame
      if (boxesInRectangle.length > 0) {
        if (action === 'clear') {
          // Delete labels for these boxes
          const stmt = db.prepare(`
            DELETE FROM full_frame_box_labels
            WHERE frame_index = ? AND box_index = ?
          `)

          for (const boxIndex of boxesInRectangle) {
            stmt.run(frameIndex, boxIndex)
          }
        } else {
          // action === 'mark_out'
          // Check which boxes already have labels
          const existingLabels = new Set(
            (db.prepare(`
              SELECT box_index FROM full_frame_box_labels
              WHERE frame_index = ? AND box_index IN (${boxesInRectangle.map(() => '?').join(',')})
            `).all(frameIndex, ...boxesInRectangle) as Array<{ box_index: number }>).map(row => row.box_index)
          )

          // Insert or update labels for these boxes
          const stmt = db.prepare(`
            INSERT INTO full_frame_box_labels (
              annotation_source,
              frame_index,
              box_index,
              box_text,
              box_left,
              box_top,
              box_right,
              box_bottom,
              label,
              label_source,
              predicted_label,
              predicted_confidence,
              model_version,
              labeled_at
            ) VALUES ('full_frame', ?, ?, ?, ?, ?, ?, ?, 'out', 'user', ?, ?, ?, datetime('now'))
            ON CONFLICT(annotation_source, frame_index, box_index)
            DO UPDATE SET
              label = 'out',
              label_source = 'user',
              labeled_at = datetime('now')
          `)

          for (const boxIndex of boxesInRectangle) {
            // Find the box data
            const box = ocrBoxes.find(b => b.box_index === boxIndex)
            if (!box) continue

            // Count only if this box didn't already have a label
            if (!existingLabels.has(boxIndex)) {
              newlyAnnotatedBoxes++
            }

            // Convert fractional to pixels (top-referenced)
            const boxLeft = Math.floor(box.x * layoutConfig.frame_width)
            const boxBottom = Math.floor((1 - box.y) * layoutConfig.frame_height)
            const boxTop = boxBottom - Math.floor(box.height * layoutConfig.frame_height)
            const boxRight = boxLeft + Math.floor(box.width * layoutConfig.frame_width)

            const originalBounds = { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom }

            // Get prediction for this box
            const prediction = predictBoxLabel(originalBounds, layoutConfig, allBoxBounds, db)

            stmt.run(
              frameIndex,
              boxIndex,
              box.text,
              boxLeft,
              boxTop,
              boxRight,
              boxBottom,
              prediction.label,
              prediction.confidence,
              modelVersion
            )
          }
        }

        totalAnnotatedBoxes += boxesInRectangle.length
        framesProcessed.push(frameIndex)
      }
    }

    db.close()

    console.log(`Bulk annotated ${totalAnnotatedBoxes} boxes (${newlyAnnotatedBoxes} new) across ${framesProcessed.length} frames`)

    return new Response(JSON.stringify({
      success: true,
      action,
      totalAnnotatedBoxes,
      newlyAnnotatedBoxes,
      framesProcessed: framesProcessed.length,
      frameIndices: framesProcessed
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error in bulk annotate all:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
