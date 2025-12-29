import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type LoaderFunctionArgs } from 'react-router'

import { getDbPath } from '~/utils/video-paths'

interface FrameOCR {
  frame_index: number
  ocr_text: string
  ocr_annotations: string // JSON: [[text, conf, [x, y, w, h]], ...]
  ocr_confidence: number
}

// Python OCR annotation format: [text, confidence, [x, y, width, height]]
type PythonOCRAnnotation = [string, number, [number, number, number, number]]

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
  captionBoxCount: number // Estimated using simple heuristics
  minConfidence: number // Lowest OCR confidence among all boxes in frame
  hasAnnotations: boolean
  hasUnannotatedBoxes: boolean // Whether frame has boxes that haven't been annotated
  imageUrl: string
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

/**
 * Simple heuristic to estimate caption box count.
 * Uses crop bounds to filter boxes - boxes inside crop region are likely captions.
 */
function estimateCaptionBoxCount(
  ocrAnnotations: PythonOCRAnnotation[],
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
    const insideCrop =
      boxLeft >= cropBounds.left &&
      boxTop >= cropBounds.top &&
      boxRight <= cropBounds.right &&
      boxBottom <= cropBounds.bottom

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
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const db = getDatabase(videoId)
    if (db instanceof Response) return db

    // Check processing status first
    const processingStatus = db
      .prepare('SELECT status FROM processing_status WHERE id = 1')
      .get() as { status: string } | undefined

    if (!processingStatus) {
      db.close()
      return new Response(
        JSON.stringify({
          error: 'Processing status not found',
          processingStatus: 'unknown',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Block access if processing is not complete
    if (processingStatus.status !== 'processing_complete') {
      db.close()
      return new Response(
        JSON.stringify({
          error: 'Video is still processing. Please wait for processing to complete.',
          processingStatus: processingStatus.status,
        }),
        {
          status: 425, // Too Early
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Get layout config from database
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfig
      | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(
        JSON.stringify({
          error: 'Layout config not found. Run full_frames analysis first.',
          processingStatus: processingStatus.status,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Load frames from full_frame_ocr table
    const frames = db
      .prepare(
        `
      SELECT DISTINCT frame_index FROM full_frame_ocr ORDER BY frame_index
    `
      )
      .all() as Array<{ frame_index: number }>

    if (frames.length === 0) {
      db.close()
      return new Response(
        JSON.stringify({
          error: 'No OCR data found in database. Run full_frames analysis first.',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    console.log(`Found ${frames.length} frames in full_frame_ocr table`)

    // Calculate caption box count for each frame
    const frameInfos: FrameInfo[] = frames.map(({ frame_index: frameIndex }) => {
      // Get all OCR boxes for this frame with cached predictions
      const ocrAnnotations = db
        .prepare(
          `
        SELECT box_index, text, confidence, x, y, width, height, predicted_confidence
        FROM full_frame_ocr
        WHERE frame_index = ?
        ORDER BY box_index
      `
        )
        .all(frameIndex) as Array<{
        box_index: number
        text: string
        confidence: number
        x: number
        y: number
        width: number
        height: number
        predicted_confidence: number | null
      }>

      // Convert to annotation format for estimateCaptionBoxCount
      const annotationsArray: PythonOCRAnnotation[] = ocrAnnotations.map(box => [
        box.text,
        box.confidence,
        [box.x, box.y, box.width, box.height],
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
        (
          db
            .prepare(
              `
          SELECT box_index
          FROM full_frame_box_labels
          WHERE frame_index = ? AND label_source = 'user'
        `
            )
            .all(frameIndex) as Array<{ box_index: number }>
        ).map(row => row.box_index)
      )

      // Get minimum predicted confidence among unannotated boxes (use cached values)
      const unannotatedPredictions: number[] = ocrAnnotations
        .filter(box => !annotatedBoxIndices.has(box.box_index))
        .map(box => box.predicted_confidence ?? 0.5) // Use cached prediction or default

      const minConfidence =
        unannotatedPredictions.length > 0 ? Math.min(...unannotatedPredictions) : 1.0 // All boxes annotated - push to end of queue

      // Check if frame has any box annotations in database
      const hasAnnotations = annotatedBoxIndices.size > 0

      // Track whether frame has any unannotated boxes
      const hasUnannotatedBoxes = unannotatedPredictions.length > 0

      return {
        frameIndex,
        totalBoxCount,
        captionBoxCount,
        minConfidence,
        hasAnnotations,
        hasUnannotatedBoxes,
        imageUrl: `/api/full-frames/${encodeURIComponent(videoId)}/${frameIndex}.jpg`,
      }
    })

    // Filter out frames with no unannotated boxes, then sort by minimum confidence
    const framesWithUnannotatedBoxes = frameInfos.filter(f => f.hasUnannotatedBoxes)
    const topFrames = framesWithUnannotatedBoxes
      .sort((a, b) => a.minConfidence - b.minConfidence)
      .slice(0, 11)

    console.log(
      `Filtered ${frameInfos.length} total frames → ${framesWithUnannotatedBoxes.length} with unannotated boxes → selected top ${topFrames.length}`
    )
    console.log(
      `Top frames by minConfidence:`,
      topFrames.map(f => `${f.frameIndex}(${f.minConfidence.toFixed(3)})`).join(', ')
    )

    // Check if layout has been approved
    let layoutApproved = false
    try {
      const prefs = db
        .prepare(`SELECT layout_approved FROM video_preferences WHERE id = 1`)
        .get() as { layout_approved: number } | undefined
      layoutApproved = (prefs?.layout_approved ?? 0) === 1
    } catch {
      // Table or column doesn't exist
      layoutApproved = false
    }

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
      layoutApproved,
    }

    db.close()

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error in layout queue API:', error)
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
