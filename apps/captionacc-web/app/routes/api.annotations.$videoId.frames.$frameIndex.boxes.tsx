import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'
import { getDbPath } from '~/utils/video-paths'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { predictBoxLabel } from '~/utils/box-prediction'
import { triggerModelTraining } from '~/services/model-training'

type PythonOCRAnnotation = [string, number, [number, number, number, number]]

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
    if (db instanceof Response) return db

    // Get layout config
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Load frame OCR from full_frame_ocr table
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

    if (ocrBoxes.length === 0) {
      db.close()
      return new Response(JSON.stringify({
        error: `Frame ${frameIndex} not found in OCR data. Run full_frames analysis first.`
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Convert to annotation format: [text, confidence, [x, y, width, height]]
    const ocrAnnotations: PythonOCRAnnotation[] = ocrBoxes.map(box => [
      box.text,
      box.confidence,
      [box.x, box.y, box.width, box.height]
    ])

    // Get user annotations for this frame
    const userAnnotations = db.prepare(`
      SELECT box_index, label
      FROM full_frame_box_labels
      WHERE frame_index = ? AND label_source = 'user'
    `).all(frameIndex) as Array<{ box_index: number; label: 'in' | 'out' }>

    const userAnnotationMap = new Map<number, 'in' | 'out'>()
    userAnnotations.forEach(ann => {
      userAnnotationMap.set(ann.box_index, ann.label)
    })

    // Convert all boxes to bounds for feature extraction
    const allBoxBounds = ocrAnnotations.map(annotation => {
      const [_text, _conf, [x, y, width, height]] = annotation
      const boxLeft = Math.floor(x * layoutConfig.frame_width)
      const boxBottom = Math.floor((1 - y) * layoutConfig.frame_height)
      const boxTop = boxBottom - Math.floor(height * layoutConfig.frame_height)
      const boxRight = boxLeft + Math.floor(width * layoutConfig.frame_width)
      return { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom }
    })

    // Process boxes
    const boxes: BoxData[] = ocrAnnotations.map((annotation, boxIndex) => {
      // OCR annotation format: [text, confidence, [x, y, width, height]]
      // Coordinates are fractional [0-1]
      // IMPORTANT: y is measured from BOTTOM of image, not top
      const [text, _conf, [x, y, width, height]] = annotation

      // Convert fractional to pixels (original frame coords)
      const boxLeft = Math.floor(x * layoutConfig.frame_width)
      // Convert y from bottom-referenced to top-referenced
      const boxBottom = Math.floor((1 - y) * layoutConfig.frame_height)
      const boxTop = boxBottom - Math.floor(height * layoutConfig.frame_height)
      const boxRight = boxLeft + Math.floor(width * layoutConfig.frame_width)

      const originalBounds = { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom }

      // Predict label (with Bayesian model if available)
      const prediction = predictBoxLabel(originalBounds, layoutConfig, allBoxBounds, db)

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
    if (db instanceof Response) return db

    // Get layout config for frame dimensions
    const layoutConfig = db.prepare('SELECT frame_width, frame_height FROM video_layout_config WHERE id = 1').get() as { frame_width: number; frame_height: number } | undefined

    if (!layoutConfig) {
      db.close()
      return new Response(JSON.stringify({ error: 'Layout config not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Load frame OCR from full_frame_ocr table
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

    if (ocrBoxes.length === 0) {
      db.close()
      return new Response(JSON.stringify({
        error: `Frame ${frameIndex} not found in OCR data`
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Convert to annotation format: [text, confidence, [x, y, width, height]]
    const ocrAnnotations: PythonOCRAnnotation[] = ocrBoxes.map(box => [
      box.text,
      box.confidence,
      [box.x, box.y, box.width, box.height]
    ])

    // Get layout config for predictions
    const fullLayoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as VideoLayoutConfig | undefined

    // Get model version if available
    const modelInfo = db.prepare('SELECT model_version FROM box_classification_model WHERE id = 1').get() as { model_version: string } | undefined
    const modelVersion = modelInfo?.model_version || null

    // Convert all boxes to bounds for feature extraction
    const allBoxBounds = ocrAnnotations.map(annotation => {
      const [_text, _conf, [x, y, width, height]] = annotation
      const boxLeft = Math.floor(x * layoutConfig.frame_width)
      const boxBottom = Math.floor((1 - y) * layoutConfig.frame_height)
      const boxTop = boxBottom - Math.floor(height * layoutConfig.frame_height)
      const boxRight = boxLeft + Math.floor(width * layoutConfig.frame_width)
      return { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom }
    })

    // Prepare insert/update statement
    const upsert = db.prepare(`
      INSERT INTO full_frame_box_labels (
        annotation_source, frame_index, box_index, box_text, box_left, box_top, box_right, box_bottom,
        label, label_source, predicted_label, predicted_confidence, model_version, labeled_at
      ) VALUES ('full_frame', ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, datetime('now'))
      ON CONFLICT(annotation_source, frame_index, box_index) DO UPDATE SET
        label = excluded.label,
        labeled_at = datetime('now')
    `)

    // Save each annotation
    for (const annotation of annotations) {
      const { boxIndex, label } = annotation

      if (boxIndex >= ocrAnnotations.length) {
        console.warn(`Box index ${boxIndex} out of range for frame ${frameIndex}`)
        continue
      }

      // Get box data from OCR
      // IMPORTANT: y is measured from BOTTOM of image, not top
      const ocrAnnotation = ocrAnnotations[boxIndex]
      if (!ocrAnnotation) {
        console.warn(`Annotation not found at index ${boxIndex}`)
        continue
      }
      const [text, _conf, [x, y, width, height]] = ocrAnnotation

      // Convert fractional to pixels
      const boxLeft = Math.floor(x * layoutConfig.frame_width)
      // Convert y from bottom-referenced to top-referenced
      const boxBottom = Math.floor((1 - y) * layoutConfig.frame_height)
      const boxTop = boxBottom - Math.floor(height * layoutConfig.frame_height)
      const boxRight = boxLeft + Math.floor(width * layoutConfig.frame_width)

      const originalBounds = { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom }

      // Get prediction for this box (to save alongside user label)
      let predictedLabel: 'in' | 'out' = 'out'
      let predictedConfidence: number = 0.5

      if (fullLayoutConfig) {
        const prediction = predictBoxLabel(originalBounds, fullLayoutConfig, allBoxBounds, db)
        predictedLabel = prediction.label
        predictedConfidence = prediction.confidence
      }

      upsert.run(
        frameIndex, boxIndex, text, boxLeft, boxTop, boxRight, boxBottom,
        label, predictedLabel, predictedConfidence, modelVersion
      )
    }

    // Check if automatic retraining threshold reached
    const annotationStats = db.prepare(`
      SELECT
        COUNT(*) as total_annotations,
        COALESCE((SELECT n_training_samples FROM box_classification_model WHERE id = 1), 0) as last_model_count
      FROM full_frame_box_labels
      WHERE label_source = 'user'
    `).get() as { total_annotations: number; last_model_count: number }

    const newAnnotationsSinceLastTrain = annotationStats.total_annotations - annotationStats.last_model_count

    db.close()

    // Auto-retrain after every 20 new annotations
    if (newAnnotationsSinceLastTrain >= 20) {
      console.log(`[Auto-retrain] Triggering model training: ${newAnnotationsSinceLastTrain} new annotations since last train`)
      triggerModelTraining(videoId)
    }

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
