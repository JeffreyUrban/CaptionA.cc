import { type ActionFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'

interface VideoLayoutConfig {
  id: number
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
  selection_mode: 'hard' | 'soft' | 'disabled'
  vertical_position: number | null
  vertical_std: number | null
  box_height: number | null
  box_height_std: number | null
  anchor_type: 'left' | 'center' | 'right' | null
  anchor_position: number | null
  crop_bounds_version: number
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

// PUT - Update layout configuration
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
    const body = await request.json()
    const {
      cropBounds,
      selectionBounds,
      selectionMode,
      layoutParams
    } = body as {
      cropBounds?: { left: number; top: number; right: number; bottom: number }
      selectionBounds?: { left: number; top: number; right: number; bottom: number }
      selectionMode?: 'hard' | 'soft' | 'disabled'
      layoutParams?: {
        verticalPosition: number
        verticalStd: number
        boxHeight: number
        boxHeightStd: number
        anchorType: 'left' | 'center' | 'right'
        anchorPosition: number
      }
    }

    const db = getDatabase(videoId)

    // Get current config
    const currentConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig | undefined

    if (!currentConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Check if crop bounds changed
    const cropBoundsChanged = cropBounds && (
      cropBounds.left !== currentConfig.crop_left ||
      cropBounds.top !== currentConfig.crop_top ||
      cropBounds.right !== currentConfig.crop_right ||
      cropBounds.bottom !== currentConfig.crop_bottom
    )

    let framesInvalidated = 0

    // Begin transaction
    db.prepare('BEGIN TRANSACTION').run()

    try {
      // Update crop bounds and increment version if changed
      if (cropBoundsChanged && cropBounds) {
        // Increment crop_bounds_version
        db.prepare(`
          UPDATE video_layout_config
          SET crop_bounds_version = crop_bounds_version + 1,
              crop_left = ?,
              crop_top = ?,
              crop_right = ?,
              crop_bottom = ?,
              updated_at = datetime('now')
          WHERE id = 1
        `).run(cropBounds.left, cropBounds.top, cropBounds.right, cropBounds.bottom)

        // Invalidate all frames (set crop_bounds_version to 0)
        const result = db.prepare(`
          UPDATE frames_ocr
          SET crop_bounds_version = 0
        `).run()

        framesInvalidated = result.changes

        console.log(`Crop bounds changed: invalidated ${framesInvalidated} frames`)
      } else if (cropBounds) {
        // Update crop bounds without incrementing version (no actual change)
        db.prepare(`
          UPDATE video_layout_config
          SET crop_left = ?,
              crop_top = ?,
              crop_right = ?,
              crop_bottom = ?,
              updated_at = datetime('now')
          WHERE id = 1
        `).run(cropBounds.left, cropBounds.top, cropBounds.right, cropBounds.bottom)
      }

      // Update selection bounds and mode
      if (selectionBounds !== undefined || selectionMode !== undefined) {
        const updates: string[] = []
        const values: any[] = []

        if (selectionBounds !== undefined) {
          updates.push('selection_left = ?', 'selection_top = ?', 'selection_right = ?', 'selection_bottom = ?')
          values.push(selectionBounds.left, selectionBounds.top, selectionBounds.right, selectionBounds.bottom)
        }

        if (selectionMode !== undefined) {
          updates.push('selection_mode = ?')
          values.push(selectionMode)
        }

        updates.push('updated_at = datetime(\'now\')')

        db.prepare(`
          UPDATE video_layout_config
          SET ${updates.join(', ')}
          WHERE id = 1
        `).run(...values)
      }

      // Update layout parameters (Bayesian priors)
      if (layoutParams) {
        db.prepare(`
          UPDATE video_layout_config
          SET vertical_position = ?,
              vertical_std = ?,
              box_height = ?,
              box_height_std = ?,
              anchor_type = ?,
              anchor_position = ?,
              updated_at = datetime('now')
          WHERE id = 1
        `).run(
          layoutParams.verticalPosition,
          layoutParams.verticalStd,
          layoutParams.boxHeight,
          layoutParams.boxHeightStd,
          layoutParams.anchorType,
          layoutParams.anchorPosition
        )
      }

      db.prepare('COMMIT').run()
    } catch (error) {
      db.prepare('ROLLBACK').run()
      throw error
    }

    db.close()

    return new Response(JSON.stringify({
      success: true,
      boundsChanged: cropBoundsChanged,
      framesInvalidated,
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error updating layout config:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
