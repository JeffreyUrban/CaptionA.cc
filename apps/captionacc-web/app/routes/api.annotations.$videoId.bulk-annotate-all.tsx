import { type ActionFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

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

    // Get layout config for frame dimensions
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as {
      frame_width: number
      frame_height: number
    } | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get all unique frame indices from full_frame_ocr table
    const frames = db.prepare(`
      SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index
    `).all() as Array<{ frame_index: number }>

    let totalAnnotatedBoxes = 0
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
          // Insert or update labels for these boxes
          const stmt = db.prepare(`
            INSERT INTO full_frame_box_labels (
              frame_index,
              box_index,
              box_text,
              box_left,
              box_top,
              box_right,
              box_bottom,
              label,
              label_source,
              labeled_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'out', 'user', datetime('now'))
            ON CONFLICT(frame_index, box_index)
            DO UPDATE SET
              label = 'out',
              label_source = 'user',
              labeled_at = datetime('now')
          `)

          for (const boxIndex of boxesInRectangle) {
            // Find the box data
            const box = ocrBoxes.find(b => b.box_index === boxIndex)
            if (!box) continue

            // Convert fractional to pixels (top-referenced)
            const boxLeft = Math.floor(box.x * layoutConfig.frame_width)
            const boxBottom = Math.floor((1 - box.y) * layoutConfig.frame_height)
            const boxTop = boxBottom - Math.floor(box.height * layoutConfig.frame_height)
            const boxRight = boxLeft + Math.floor(box.width * layoutConfig.frame_width)

            stmt.run(
              frameIndex,
              boxIndex,
              box.text,
              boxLeft,
              boxTop,
              boxRight,
              boxBottom
            )
          }
        }

        totalAnnotatedBoxes += boxesInRectangle.length
        framesProcessed.push(frameIndex)
      }
    }

    db.close()

    console.log(`Bulk annotated ${totalAnnotatedBoxes} boxes across ${framesProcessed.length} frames`)

    return new Response(JSON.stringify({
      success: true,
      action,
      totalAnnotatedBoxes,
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
