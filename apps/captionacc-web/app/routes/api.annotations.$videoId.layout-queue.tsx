import { type LoaderFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { calculateDistributionParams } from '~/utils/layout-distribution'
import { predictBoxLabel } from '~/utils/box-prediction'

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
  vertical_position: number | null
  vertical_std: number | null
  box_height: number | null
  box_height_std: number | null
  anchor_type: 'left' | 'center' | 'right' | null
  anchor_position: number | null
  top_edge_std: number | null
  bottom_edge_std: number | null
  horizontal_std_slope: number | null
  horizontal_std_intercept: number | null
  crop_bounds_version: number
}

interface FrameInfo {
  frameIndex: number
  totalBoxCount: number
  captionBoxCount: number  // Estimated using simple heuristics
  minConfidence: number  // Lowest OCR confidence among all boxes in frame
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

      // Calculate distribution parameters from caption boxes inside crop bounds
      // (using heuristic: boxes inside crop bounds are likely captions)
      const captionBoxes: Array<{
        left: number
        top: number
        right: number
        bottom: number
      }> = []

      // Load OCR boxes from database
      const ocrBoxes = db.prepare(`
        SELECT frame_index, box_index, text, confidence, x, y, width, height
        FROM full_frame_ocr
        ORDER BY frame_index, box_index
      `).all() as Array<{
        frame_index: number
        box_index: number
        text: string
        confidence: number
        x: number
        y: number
        width: number
        height: number
      }>

      for (const box of ocrBoxes) {
        // Coordinates are fractional [0-1], y is bottom-referenced
        const { x, y, width, height } = box

        // Convert to absolute pixel coords (top-referenced)
        const boxLeft = Math.floor(x * frameWidth)
        const boxBottom = Math.floor((1 - y) * frameHeight)
        const boxTop = boxBottom - Math.floor(height * frameHeight)
        const boxRight = boxLeft + Math.floor(width * frameWidth)

        // Check if box is inside crop bounds
        const insideCrop =
          boxLeft >= analysisData.crop_bounds[0] &&
          boxTop >= analysisData.crop_bounds[1] &&
          boxRight <= analysisData.crop_bounds[2] &&
          boxBottom <= analysisData.crop_bounds[3]

        if (insideCrop) {
          captionBoxes.push({
            left: boxLeft,
            top: boxTop,
            right: boxRight,
            bottom: boxBottom,
          })
        }
      }

      console.log(`Found ${captionBoxes.length} caption boxes for distribution calculation`)

      // Calculate distribution parameters
      const distributionParams = calculateDistributionParams(captionBoxes, {
        anchor_type: analysisData.anchor_type,
        anchor_position: analysisData.anchor_position,
        vertical_position: analysisData.vertical_position_mode,
        box_height: analysisData.height_mode,
      })

      console.log('Distribution params:', distributionParams)

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
          vertical_position,
          vertical_std,
          box_height,
          box_height_std,
          anchor_type,
          anchor_position,
          top_edge_std,
          bottom_edge_std,
          horizontal_std_slope,
          horizontal_std_intercept,
          crop_bounds_version
        ) VALUES (
          1,
          ?, ?, ?, ?, ?, ?,
          NULL, NULL, NULL, NULL,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?,
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
        analysisData.anchor_position,
        distributionParams.top_edge_std,
        distributionParams.bottom_edge_std,
        distributionParams.horizontal_std_slope,
        distributionParams.horizontal_std_intercept
      )

      console.log('Initialized video_layout_config from subtitle_analysis.txt with distribution params')

      // Reload config
      layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig
    }

    // Load frames from full_frame_ocr table
    const frames = db.prepare(`
      SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index
    `).all() as Array<{ frame_index: number }>

    if (frames.length === 0) {
      db.close()
      return new Response(JSON.stringify({
        error: 'No OCR data found in database. Run caption_layout analysis first.'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    console.log(`Found ${frames.length} frames in full_frame_ocr table`)

    // Calculate caption box count for each frame
    const frameInfos: FrameInfo[] = frames.map(({ frame_index: frameIndex }) => {
      // Get all OCR boxes for this frame
      const ocrAnnotations = db.prepare(`
        SELECT text, confidence, x, y, width, height
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `).all(frameIndex) as Array<{
        text: string
        confidence: number
        x: number
        y: number
        width: number
        height: number
      }>

      // Convert to annotation format for estimateCaptionBoxCount
      const annotationsArray = ocrAnnotations.map(box => [
        box.text,
        box.confidence,
        [box.x, box.y, box.width, box.height]
      ])

      const totalBoxCount = ocrAnnotations.length
      const captionBoxCount = estimateCaptionBoxCount(
        annotationsArray,
        layoutConfig!.frame_width,
        layoutConfig!.frame_height,
        {
          left: layoutConfig!.crop_left,
          top: layoutConfig!.crop_top,
          right: layoutConfig!.crop_right,
          bottom: layoutConfig!.crop_bottom,
        }
      )

      // Get annotated box indices for this frame
      const annotatedBoxIndices = new Set(
        (db.prepare(`
          SELECT box_index
          FROM full_frame_box_labels
          WHERE frame_index = ? AND label_source = 'user'
        `).all(frameIndex) as Array<{ box_index: number }>).map(row => row.box_index)
      )

      // Calculate minimum predicted confidence among unannotated boxes
      const unannotatedPredictions: number[] = []

      ocrAnnotations.forEach((box, idx) => {
        // Skip annotated boxes
        if (annotatedBoxIndices.has(idx)) return

        // Convert fractional coordinates to pixel bounds (top-referenced)
        const boxLeft = Math.floor(box.x * layoutConfig!.frame_width)
        const boxBottom = Math.floor((1 - box.y) * layoutConfig!.frame_height)
        const boxTop = boxBottom - Math.floor(box.height * layoutConfig!.frame_height)
        const boxRight = boxLeft + Math.floor(box.width * layoutConfig!.frame_width)

        const bounds = { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom }

        // Get predicted confidence from Bayesian model (if available, otherwise heuristic)
        const prediction = predictBoxLabel(bounds, layoutConfig!, db)
        unannotatedPredictions.push(prediction.confidence)
      })

      const minConfidence = unannotatedPredictions.length > 0
        ? Math.min(...unannotatedPredictions)
        : 1.0  // All boxes annotated - push to end of queue

      console.log(`Frame ${frameIndex}: ${totalBoxCount} total boxes, ${annotatedBoxIndices.size} annotated, ${unannotatedPredictions.length} unannotated, minConfidence=${minConfidence.toFixed(3)}`)

      // Check if frame has any box annotations in database
      const hasAnnotations = annotatedBoxIndices.size > 0

      return {
        frameIndex,
        totalBoxCount,
        captionBoxCount,
        minConfidence,
        hasAnnotations: hasAnnotations.count > 0,
        imageUrl: `/api/full-frames/${encodeURIComponent(videoId)}/${frameIndex}.jpg`
      }
    })

    // Sort by minimum confidence (ascending - lowest confidence first) and select top 10
    const topFrames = frameInfos
      .sort((a, b) => a.minConfidence - b.minConfidence)
      .slice(0, 10)

    console.log(`Selected ${topFrames.length} top frames by minConfidence:`, topFrames.map(f => `${f.frameIndex}(${f.minConfidence.toFixed(3)})`).join(', '))

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
        verticalPosition: layoutConfig.vertical_position,
        verticalStd: layoutConfig.vertical_std,
        boxHeight: layoutConfig.box_height,
        boxHeightStd: layoutConfig.box_height_std,
        anchorType: layoutConfig.anchor_type,
        anchorPosition: layoutConfig.anchor_position,
        topEdgeStd: layoutConfig.top_edge_std,
        bottomEdgeStd: layoutConfig.bottom_edge_std,
        horizontalStdSlope: layoutConfig.horizontal_std_slope,
        horizontalStdIntercept: layoutConfig.horizontal_std_intercept,
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
