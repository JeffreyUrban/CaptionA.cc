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
    // IMPORTANT: y is measured from BOTTOM of image, not top
    const [_text, _conf, [x, y, width, height]] = annotation

    // Convert fractional to pixels
    const boxLeft = Math.floor(x * frameWidth)
    // Convert y from bottom-referenced to top-referenced
    const boxBottom = Math.floor((1 - y) * frameHeight)
    const boxTop = boxBottom - Math.floor(height * frameHeight)
    const boxRight = boxLeft + Math.floor(width * frameWidth)

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

    // Get layout config (or auto-initialize from subtitle_analysis.txt)
    let layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig | undefined

    if (!layoutConfig) {
      // Auto-initialize from subtitle_analysis.txt
      const analysisPath = resolve(
        process.cwd(),
        '..',
        '..',
        'local',
        'data',
        ...videoId.split('/'),
        'caption_layout',
        'subtitle_analysis.txt'
      )

      if (!existsSync(analysisPath)) {
        db.close()
        return new Response(JSON.stringify({
          error: 'subtitle_analysis.txt not found. Run caption_layout analysis first.'
        }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Parse subtitle_analysis.txt to get layout parameters
      const analysisContent = readFileSync(analysisPath, 'utf-8')
      const jsonStart = analysisContent.indexOf('---\n') + 4
      const jsonContent = analysisContent.slice(jsonStart).trim()
      const analysisData = JSON.parse(jsonContent)

      // Get frame dimensions from first frame image
      const framesDir = resolve(
        process.cwd(),
        '..',
        '..',
        'local',
        'data',
        ...videoId.split('/'),
        'caption_layout',
        'full_frames'
      )

      let frameWidth = 1280  // Default
      let frameHeight = 720  // Default

      // Find first frame to get actual dimensions
      const { readdirSync } = await import('fs')
      const frameFiles = readdirSync(framesDir).filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))

      if (frameFiles.length > 0) {
        const firstFramePath = resolve(framesDir, frameFiles[0])

        // Read image dimensions using sharp
        try {
          const sharp = (await import('sharp')).default
          const metadata = await sharp(firstFramePath).metadata()
          frameWidth = metadata.width || 1280
          frameHeight = metadata.height || 720
          console.log(`Detected frame dimensions: ${frameWidth}x${frameHeight}`)
        } catch (error) {
          console.warn('Failed to read frame dimensions, using defaults:', error)
        }
      }

      // Initialize video_layout_config table
      db.prepare(`
        INSERT INTO video_layout_config (
          id,
          frame_width,
          frame_height,
          crop_left,
          crop_top,
          crop_right,
          crop_bottom,
          selection_left,
          selection_top,
          selection_right,
          selection_bottom,
          selection_mode,
          vertical_position,
          vertical_std,
          box_height,
          box_height_std,
          anchor_type,
          anchor_position,
          crop_bounds_version
        ) VALUES (
          1,
          ?, ?, ?, ?, ?, ?,
          NULL, NULL, NULL, NULL,
          'hard',
          ?, ?, ?, ?,
          ?, ?,
          1
        )
      `).run(
        frameWidth,
        frameHeight,
        analysisData.crop_bounds[0],  // crop_left
        analysisData.crop_bounds[1],  // crop_top
        analysisData.crop_bounds[2],  // crop_right
        analysisData.crop_bounds[3],  // crop_bottom
        analysisData.vertical_position_mode,
        analysisData.vertical_position_std,
        analysisData.height_mode,
        analysisData.height_std,
        analysisData.anchor_type,
        analysisData.anchor_position
      )

      console.log('Initialized video_layout_config from subtitle_analysis.txt')

      // Reload config
      layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig
    }

    // Load frames from caption_layout OCR.jsonl
    const captionLayoutPath = resolve(
      process.cwd(),
      '..',
      '..',
      'local',
      'data',
      ...videoId.split('/'),
      'caption_layout',
      'OCR.jsonl'
    )

    if (!existsSync(captionLayoutPath)) {
      db.close()
      return new Response(JSON.stringify({
        error: 'caption_layout OCR.jsonl not found. Run caption_layout analysis first.'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Parse OCR.jsonl to get frame indices and annotations
    const { readFileSync } = await import('fs')
    const ocrLines = readFileSync(captionLayoutPath, 'utf-8').trim().split('\n')

    console.log(`Found ${ocrLines.length} frames in caption_layout OCR.jsonl`)

    // Calculate caption box count for each frame
    const frameInfos: FrameInfo[] = ocrLines.map(line => {
      const ocrData = JSON.parse(line)

      // Extract frame_index from image_path (e.g., "full_frames/frame_0000000100.jpg" → 100)
      const match = ocrData.image_path.match(/frame_(\d+)\.jpg/)
      const frameIndex = match ? parseInt(match[1], 10) : 0

      const ocrAnnotations = ocrData.annotations || []
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

      // Check if frame has any box annotations in database
      const hasAnnotations = db.prepare(`
        SELECT COUNT(*) as count
        FROM ocr_box_annotations
        WHERE frame_index = ? AND annotation_source = 'user'
      `).get(frameIndex) as { count: number }

      return {
        frameIndex,
        totalBoxCount,
        captionBoxCount,
        hasAnnotations: hasAnnotations.count > 0,
        imageUrl: `/api/full-frames/${encodeURIComponent(videoId)}/${frameIndex}.jpg`
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
      subtitleAnalysisUrl: `/api/images/${encodeURIComponent(videoId)}/caption_layout/subtitle_analysis.png`
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
