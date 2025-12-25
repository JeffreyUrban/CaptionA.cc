import { type LoaderFunctionArgs } from 'react-router'
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

interface FrameInfo {
  frameIndex: number
  totalBoxCount: number
  captionBoxCount: number  // Estimated using simple heuristics
  hasAnnotations: boolean
  imageUrl: string
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
 * Simple heuristic to estimate caption box count.
 * Uses crop bounds to filter boxes - boxes inside crop region are likely captions.
 * This is a simplified version; full prediction will use the Python model.
 */
function estimateCaptionBoxCount(
  ocrAnnotations: any[],
  frameWidth: number,
  frameHeight: number,
  cropBounds: { left: number; top: number; right: number; bottom: number }
): number {
  if (!ocrAnnotations || ocrAnnotations.length === 0) {
    return 0
  }

  let count = 0

  for (const annotation of ocrAnnotations) {
    // OCR annotation format: [text, confidence, [x, y, width, height]]
    // Coordinates are fractional [0-1]
    const [_text, _conf, [x, y, width, height]] = annotation

    // Convert fractional to pixels
    const boxLeft = Math.floor(x * frameWidth)
    const boxTop = Math.floor(y * frameHeight)
    const boxRight = boxLeft + Math.floor(width * frameWidth)
    const boxBottom = boxTop + Math.floor(height * frameHeight)

    // Check if box is inside crop bounds
    const insideCrop = (
      boxLeft >= cropBounds.left &&
      boxTop >= cropBounds.top &&
      boxRight <= cropBounds.right &&
      boxBottom <= cropBounds.bottom
    )

    if (insideCrop) {
      count++
    }
  }

  return count
}

// GET - Fetch layout annotation queue (frames with high caption box counts)
export async function loader({ params }: LoaderFunctionArgs) {
  console.log('=== LAYOUT QUEUE API LOADER CALLED ===', new Date().toISOString())
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

    // Get layout config (or create default if not exists)
    let layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig | undefined

    if (!layoutConfig) {
      // TODO: Initialize from subtitle_region analysis
      // For now, return error - layout config must be initialized first
      db.close()
      return new Response(JSON.stringify({
        error: 'Layout config not initialized. Run subtitle region analysis first.'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get all frames with OCR data
    const frames = db.prepare(`
      SELECT frame_index, ocr_text, ocr_annotations, ocr_confidence
      FROM frames_ocr
      ORDER BY frame_index
    `).all() as FrameOCR[]

    console.log(`Found ${frames.length} frames with OCR data`)

    // Calculate caption box count for each frame
    const frameInfos: FrameInfo[] = frames.map(frame => {
      let ocrAnnotations: any[] = []
      try {
        ocrAnnotations = JSON.parse(frame.ocr_annotations || '[]')
      } catch (e) {
        console.error(`Failed to parse OCR annotations for frame ${frame.frame_index}:`, e)
      }

      const totalBoxCount = ocrAnnotations.length
      const captionBoxCount = estimateCaptionBoxCount(
        ocrAnnotations,
        layoutConfig!.frame_width,
        layoutConfig!.frame_height,
        {
          left: layoutConfig!.crop_left,
          top: layoutConfig!.crop_top,
          right: layoutConfig!.crop_right,
          bottom: layoutConfig!.crop_bottom,
        }
      )

      // Check if frame has any box annotations
      const hasAnnotations = db.prepare(`
        SELECT COUNT(*) as count
        FROM ocr_box_annotations
        WHERE frame_index = ? AND annotation_source = 'user'
      `).get(frame.frame_index) as { count: number }

      return {
        frameIndex: frame.frame_index,
        totalBoxCount,
        captionBoxCount,
        hasAnnotations: hasAnnotations.count > 0,
        imageUrl: `/api/frames/${encodeURIComponent(videoId)}/${frame.frame_index}.jpg`
      }
    })

    // Sort by caption box count (descending) and select top 10
    const topFrames = frameInfos
      .sort((a, b) => b.captionBoxCount - a.captionBoxCount)
      .slice(0, 10)

    console.log(`Selected ${topFrames.length} top frames`)

    // Prepare response
    const response = {
      frames: topFrames,
      layoutConfig: {
        frameWidth: layoutConfig.frame_width,
        frameHeight: layoutConfig.frame_height,
        cropLeft: layoutConfig.crop_left,
        cropTop: layoutConfig.crop_top,
        cropRight: layoutConfig.crop_right,
        cropBottom: layoutConfig.crop_bottom,
        selectionLeft: layoutConfig.selection_left,
        selectionTop: layoutConfig.selection_top,
        selectionRight: layoutConfig.selection_right,
        selectionBottom: layoutConfig.selection_bottom,
        selectionMode: layoutConfig.selection_mode,
        verticalPosition: layoutConfig.vertical_position,
        verticalStd: layoutConfig.vertical_std,
        boxHeight: layoutConfig.box_height,
        boxHeightStd: layoutConfig.box_height_std,
        anchorType: layoutConfig.anchor_type,
        anchorPosition: layoutConfig.anchor_position,
        cropBoundsVersion: layoutConfig.crop_bounds_version,
      },
      subtitleAnalysisUrl: `/api/images/${encodeURIComponent(videoId)}/subtitle_analysis.png`
    }

    db.close()

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in layout queue API:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
