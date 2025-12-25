import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'
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

interface BoxAnnotation {
  box_index: number
  box_text: string
  box_left: number
  box_top: number
  box_right: number
  box_bottom: number
  label: 'in' | 'out'
  annotation_source: 'user' | 'model'
  predicted_label: 'in' | 'out' | null
  predicted_confidence: number | null
}

interface BoxData {
  boxIndex: number
  text: string
  // Original (non-cropped) pixel coords
  originalBounds: { left: number; top: number; right: number; bottom: number }
  // Display bounds (for frontend, fractional [0-1] in cropped space)
  displayBounds: { left: number; top: number; right: number; bottom: number }
  predictedLabel: 'in' | 'out'
  predictedConfidence: number
  userLabel: 'in' | 'out' | null
  colorCode: string
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
 * Simple heuristic prediction for box labels.
 * Full prediction will use Python model with Bayesian priors.
 */
function predictBoxLabel(
  boxBounds: { left: number; top: number; right: number; bottom: number },
  layoutConfig: VideoLayoutConfig
): { label: 'in' | 'out'; confidence: number } {
  const { crop_left, crop_top, crop_right, crop_bottom } = layoutConfig

  // Check if box is inside crop bounds
  const insideCrop = (
    boxBounds.left >= crop_left &&
    boxBounds.top >= crop_top &&
    boxBounds.right <= crop_right &&
    boxBounds.bottom <= crop_bottom
  )

  if (!insideCrop) {
    // Outside crop bounds → definitely "out"
    return { label: 'out', confidence: 0.95 }
  }

  // Inside crop bounds - check alignment with layout params
  if (layoutConfig.vertical_position !== null && layoutConfig.box_height !== null) {
    const boxCenterY = (boxBounds.top + boxBounds.bottom) / 2
    const boxHeight = boxBounds.bottom - boxBounds.top

    const verticalDistance = Math.abs(boxCenterY - layoutConfig.vertical_position)
    const heightDifference = Math.abs(boxHeight - layoutConfig.box_height)

    const verticalStd = layoutConfig.vertical_std || 15
    const heightStd = layoutConfig.box_height_std || 5

    // Z-scores
    const verticalZScore = verticalDistance / verticalStd
    const heightZScore = heightDifference / heightStd

    // Good alignment if within ~2 std deviations
    if (verticalZScore < 2 && heightZScore < 2) {
      return { label: 'in', confidence: 0.7 + (1 - Math.min(verticalZScore, 2) / 2) * 0.2 }
    } else if (verticalZScore > 4 || heightZScore > 4) {
      return { label: 'out', confidence: 0.7 }
    } else {
      // Uncertain
      return { label: 'in', confidence: 0.5 }
    }
  }

  // Default: inside crop → probably caption
  return { label: 'in', confidence: 0.6 }
}

/**
 * Convert original pixel coords to display bounds (fractional in cropped space).
 */
function originalToCroppedDisplay(
  boxBounds: { left: number; top: number; right: number; bottom: number },
  cropBounds: { left: number; top: number; right: number; bottom: number },
  frameWidth: number,
  frameHeight: number
): { left: number; top: number; right: number; bottom: number } {
  const cropWidth = cropBounds.right - cropBounds.left
  const cropHeight = cropBounds.bottom - cropBounds.top

  // Clamp to crop region
  const clampedLeft = Math.max(boxBounds.left, cropBounds.left)
  const clampedTop = Math.max(boxBounds.top, cropBounds.top)
  const clampedRight = Math.min(boxBounds.right, cropBounds.right)
  const clampedBottom = Math.min(boxBounds.bottom, cropBounds.bottom)

  // Convert to fractional in cropped space
  return {
    left: (clampedLeft - cropBounds.left) / cropWidth,
    top: (clampedTop - cropBounds.top) / cropHeight,
    right: (clampedRight - cropBounds.left) / cropWidth,
    bottom: (clampedBottom - cropBounds.top) / cropHeight,
  }
}

/**
 * Determine color code based on prediction and user annotation.
 */
function getColorCode(
  predictedLabel: 'in' | 'out',
  predictedConfidence: number,
  userLabel: 'in' | 'out' | null
): string {
  // User annotation takes precedence
  if (userLabel !== null) {
    return userLabel === 'in' ? 'annotated_in' : 'annotated_out'
  }

  // Predicted
  if (predictedLabel === 'in') {
    if (predictedConfidence >= 0.75) return 'predicted_in_high'
    if (predictedConfidence >= 0.5) return 'predicted_in_medium'
    return 'predicted_in_low'
  } else {
    if (predictedConfidence >= 0.75) return 'predicted_out_high'
    if (predictedConfidence >= 0.5) return 'predicted_out_medium'
    return 'predicted_out_low'
  }
}

// GET - Fetch boxes for a frame with predictions and annotations
export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId, frameIndex: frameIndexStr } = params

  if (!encodedVideoId || !frameIndexStr) {
    return new Response(JSON.stringify({ error: 'Missing videoId or frameIndex' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)
  const frameIndex = parseInt(frameIndexStr)

  try {
    const db = getDatabase(videoId)

    // Get frame OCR data
    const frameOCR = db.prepare('SELECT * FROM frames_ocr WHERE frame_index = ?').get(frameIndex) as FrameOCR | undefined

    if (!frameOCR) {
      db.close()
      return new Response(JSON.stringify({ error: 'Frame OCR not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get layout config
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Parse OCR annotations
    let ocrAnnotations: any[] = []
    try {
      ocrAnnotations = JSON.parse(frameOCR.ocr_annotations || '[]')
    } catch (e) {
      console.error(`Failed to parse OCR annotations for frame ${frameIndex}:`, e)
    }

    // Get user annotations for this frame
    const userAnnotations = db.prepare(`
      SELECT box_index, label
      FROM ocr_box_annotations
      WHERE frame_index = ? AND annotation_source = 'user'
    `).all(frameIndex) as Array<{ box_index: number; label: 'in' | 'out' }>

    const userAnnotationMap = new Map<number, 'in' | 'out'>()
    userAnnotations.forEach(ann => {
      userAnnotationMap.set(ann.box_index, ann.label)
    })

    // Process boxes
    const boxes: BoxData[] = ocrAnnotations.map((annotation, boxIndex) => {
      // OCR annotation format: [text, confidence, [x, y, width, height]]
      // Coordinates are fractional [0-1]
      const [text, _conf, [x, y, width, height]] = annotation

      // Convert fractional to pixels (original frame coords)
      const boxLeft = Math.floor(x * layoutConfig.frame_width)
      const boxTop = Math.floor(y * layoutConfig.frame_height)
      const boxRight = boxLeft + Math.floor(width * layoutConfig.frame_width)
      const boxBottom = boxTop + Math.floor(height * layoutConfig.frame_height)

      const originalBounds = { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom }

      // Predict label
      const prediction = predictBoxLabel(originalBounds, layoutConfig)

      // Get user annotation (if exists)
      const userLabel = userAnnotationMap.get(boxIndex) || null

      // Calculate display bounds (fractional in cropped space)
      const displayBounds = originalToCroppedDisplay(
        originalBounds,
        {
          left: layoutConfig.crop_left,
          top: layoutConfig.crop_top,
          right: layoutConfig.crop_right,
          bottom: layoutConfig.crop_bottom,
        },
        layoutConfig.frame_width,
        layoutConfig.frame_height
      )

      // Determine color code
      const colorCode = getColorCode(prediction.label, prediction.confidence, userLabel)

      return {
        boxIndex,
        text,
        originalBounds,
        displayBounds,
        predictedLabel: prediction.label,
        predictedConfidence: prediction.confidence,
        userLabel,
        colorCode,
      }
    })

    const response = {
      frameIndex,
      imageUrl: `/api/full-frames/${encodeURIComponent(videoId)}/${frameIndex}.jpg`,
      cropBounds: {
        left: layoutConfig.crop_left,
        top: layoutConfig.crop_top,
        right: layoutConfig.crop_right,
        bottom: layoutConfig.crop_bottom,
      },
      frameWidth: layoutConfig.frame_width,
      frameHeight: layoutConfig.frame_height,
      boxes,
    }

    db.close()

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in frame boxes API:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

// PUT - Save box annotations
export async function action({ params, request }: ActionFunctionArgs) {
  const { videoId: encodedVideoId, frameIndex: frameIndexStr } = params

  if (!encodedVideoId || !frameIndexStr) {
    return new Response(JSON.stringify({ error: 'Missing videoId or frameIndex' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)
  const frameIndex = parseInt(frameIndexStr)

  try {
    const body = await request.json()
    const { annotations } = body as {
      annotations: Array<{ boxIndex: number; label: 'in' | 'out' }>
    }

    if (!annotations || !Array.isArray(annotations)) {
      return new Response(JSON.stringify({ error: 'Invalid annotations format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const db = getDatabase(videoId)

    // Get frame OCR to load box data
    const frameOCR = db.prepare('SELECT ocr_annotations FROM frames_ocr WHERE frame_index = ?').get(frameIndex) as { ocr_annotations: string } | undefined

    if (!frameOCR) {
      db.close()
      return new Response(JSON.stringify({ error: 'Frame OCR not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get layout config for frame dimensions
    const layoutConfig = db.prepare('SELECT frame_width, frame_height FROM video_layout_config WHERE id = 1').get() as { frame_width: number; frame_height: number } | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Parse OCR annotations to get box bounds
    const ocrAnnotations = JSON.parse(frameOCR.ocr_annotations || '[]')

    // Prepare insert/update statement
    const upsert = db.prepare(`
      INSERT INTO ocr_box_annotations (
        frame_index, box_index, box_text, box_left, box_top, box_right, box_bottom,
        label, annotation_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user')
      ON CONFLICT(frame_index, box_index) DO UPDATE SET
        label = excluded.label,
        annotated_at = datetime('now')
    `)

    // Save each annotation
    for (const annotation of annotations) {
      const { boxIndex, label } = annotation

      if (boxIndex >= ocrAnnotations.length) {
        console.warn(`Box index ${boxIndex} out of range for frame ${frameIndex}`)
        continue
      }

      // Get box data from OCR
      const [text, _conf, [x, y, width, height]] = ocrAnnotations[boxIndex]

      // Convert fractional to pixels
      const boxLeft = Math.floor(x * layoutConfig.frame_width)
      const boxTop = Math.floor(y * layoutConfig.frame_height)
      const boxRight = boxLeft + Math.floor(width * layoutConfig.frame_width)
      const boxBottom = boxTop + Math.floor(height * layoutConfig.frame_height)

      upsert.run(frameIndex, boxIndex, text, boxLeft, boxTop, boxRight, boxBottom, label)
    }

    // TODO: Trigger model retrain after N annotations

    db.close()

    return new Response(JSON.stringify({
      success: true,
      annotatedCount: annotations.length,
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error saving box annotations:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
