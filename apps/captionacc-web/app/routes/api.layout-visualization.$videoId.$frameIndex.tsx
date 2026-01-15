import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type LoaderFunctionArgs } from 'react-router'
import sharp from 'sharp'

import { getDbPath } from '~/utils/video-paths'

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

interface OCRBox {
  text: string
  confidence: number
  bounds: {
    left: number
    top: number
    right: number
    bottom: number
  }
  predictedLabel: 'in' | 'out'
  predictedConfidence: number
  userLabel: 'in' | 'out' | null
}

async function getDatabase(videoId: string): Promise<Database.Database | Response> {
  const dbPath = await getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

/**
 * Simple heuristic prediction: boxes inside selection rectangle are "in"
 * This is a placeholder until we have actual ML model predictions
 */
function predictBoxLabel(
  box: { left: number; top: number; right: number; bottom: number },
  selectionRect: { left: number; top: number; right: number; bottom: number } | null
): { label: 'in' | 'out'; confidence: number } {
  if (!selectionRect) {
    // No selection rectangle - predict "out" with low confidence
    return { label: 'out', confidence: 0.5 }
  }

  // Check if box is inside selection rectangle
  const inside =
    box.left >= selectionRect.left &&
    box.top >= selectionRect.top &&
    box.right <= selectionRect.right &&
    box.bottom <= selectionRect.bottom

  return {
    label: inside ? 'in' : 'out',
    confidence: inside ? 0.85 : 0.9,
  }
}

/**
 * Get color for box based on prediction/annotation
 */
function getBoxColor(
  predictedLabel: 'in' | 'out',
  predictedConfidence: number,
  userLabel: 'in' | 'out' | null
): { stroke: string; fill: string; lineWidth: number } {
  // User annotations take precedence
  if (userLabel === 'in') {
    return {
      stroke: '#14b8a6', // Teal
      fill: 'rgba(20, 184, 166, 0.25)',
      lineWidth: 3,
    }
  }

  if (userLabel === 'out') {
    return {
      stroke: '#dc2626', // Dark red
      fill: 'rgba(220, 38, 38, 0.25)',
      lineWidth: 3,
    }
  }

  // Model predictions - color by confidence
  if (predictedLabel === 'in') {
    if (predictedConfidence >= 0.75) {
      return {
        stroke: '#10b981', // Green
        fill: 'rgba(16, 185, 129, 0.15)',
        lineWidth: 2,
      }
    } else if (predictedConfidence >= 0.5) {
      return {
        stroke: '#34d399', // Light green
        fill: 'rgba(52, 211, 153, 0.1)',
        lineWidth: 2,
      }
    } else {
      return {
        stroke: '#6ee7b7', // Very light green
        fill: 'rgba(110, 231, 183, 0.08)',
        lineWidth: 2,
      }
    }
  } else {
    // predictedLabel === 'out'
    if (predictedConfidence >= 0.75) {
      return {
        stroke: '#ef4444', // Red
        fill: 'rgba(239, 68, 68, 0.15)',
        lineWidth: 2,
      }
    } else if (predictedConfidence >= 0.5) {
      return {
        stroke: '#f87171', // Light red
        fill: 'rgba(248, 113, 113, 0.1)',
        lineWidth: 2,
      }
    } else {
      return {
        stroke: '#fca5a5', // Very light red
        fill: 'rgba(252, 165, 165, 0.08)',
        lineWidth: 2,
      }
    }
  }
}

/**
 * Generate SVG overlay for layout visualization
 */
function generateLayoutVisualizationSVG(
  frameWidth: number,
  frameHeight: number,
  boxes: OCRBox[],
  layoutConfig: VideoLayoutConfig
): string {
  const elements: string[] = []

  // Draw OCR boxes
  for (const box of boxes) {
    const color = getBoxColor(box.predictedLabel, box.predictedConfidence, box.userLabel)

    const boxWidth = box.bounds.right - box.bounds.left
    const boxHeight = box.bounds.bottom - box.bounds.top

    // Rectangle with fill and stroke
    elements.push(`
      <rect
        x="${box.bounds.left}"
        y="${box.bounds.top}"
        width="${boxWidth}"
        height="${boxHeight}"
        fill="${color.fill}"
        stroke="${color.stroke}"
        stroke-width="${color.lineWidth}"
      />
    `)

    // Draw text if box is large enough
    if (boxWidth > 15 && boxHeight > 15) {
      const fontSize = Math.min(boxHeight * 0.8, 16)
      const textX = (box.bounds.left + box.bounds.right) / 2
      const textY = (box.bounds.top + box.bounds.bottom) / 2

      elements.push(`
        <text
          x="${textX}"
          y="${textY}"
          font-size="${fontSize}"
          font-family="sans-serif"
          text-anchor="middle"
          dominant-baseline="middle"
          fill="#000000"
        >${box.text}</text>
      `)
    }
  }

  // Draw selection rectangle (if exists)
  if (
    layoutConfig.selection_left !== null &&
    layoutConfig.selection_top !== null &&
    layoutConfig.selection_right !== null &&
    layoutConfig.selection_bottom !== null
  ) {
    elements.push(`
      <rect
        x="${layoutConfig.selection_left}"
        y="${layoutConfig.selection_top}"
        width="${layoutConfig.selection_right - layoutConfig.selection_left}"
        height="${layoutConfig.selection_bottom - layoutConfig.selection_top}"
        fill="none"
        stroke="#3b82f6"
        stroke-width="3"
        stroke-dasharray="10,5"
      />
    `)
  }

  // Draw vertical center line (if exists)
  if (layoutConfig.vertical_position !== null) {
    elements.push(`
      <line
        x1="0"
        y1="${layoutConfig.vertical_position}"
        x2="${frameWidth}"
        y2="${layoutConfig.vertical_position}"
        stroke="#8b5cf6"
        stroke-width="2"
        stroke-dasharray="5,3"
      />
    `)
  }

  // Draw anchor line (if exists)
  if (layoutConfig.anchor_type !== null && layoutConfig.anchor_position !== null) {
    elements.push(`
      <line
        x1="${layoutConfig.anchor_position}"
        y1="0"
        x2="${layoutConfig.anchor_position}"
        y2="${frameHeight}"
        stroke="#f59e0b"
        stroke-width="2"
        stroke-dasharray="5,3"
      />
    `)
  }

  // Draw crop bounds
  elements.push(`
    <rect
      x="${layoutConfig.crop_left}"
      y="${layoutConfig.crop_top}"
      width="${layoutConfig.crop_right - layoutConfig.crop_left}"
      height="${layoutConfig.crop_bottom - layoutConfig.crop_top}"
      fill="none"
      stroke="#ef4444"
      stroke-width="2"
      stroke-dasharray="15,5"
    />
  `)

  return `
    <svg width="${frameWidth}" height="${frameHeight}" xmlns="http://www.w3.org/2000/svg">
      ${elements.join('\n')}
    </svg>
  `
}

// GET - Generate layout visualization for a specific frame
export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId, frameIndex: frameIndexStr } = params

  if (!encodedVideoId || !frameIndexStr) {
    return new Response('Missing videoId or frameIndex', { status: 400 })
  }

  const videoId = decodeURIComponent(encodedVideoId)
  const frameIndex = parseInt(frameIndexStr, 10)

  if (isNaN(frameIndex)) {
    return new Response('Invalid frameIndex', { status: 400 })
  }

  try {
    const db = await getDatabase(videoId)
    if (db instanceof Response) return db

    // Get layout config
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | VideoLayoutConfig
      | undefined

    if (!layoutConfig) {
      db.close()
      return new Response('Layout config not found', { status: 404 })
    }

    // Load frame image from database
    const frameRow = db
      .prepare(
        `
      SELECT image_data
      FROM full_frames
      WHERE frame_index = ?
    `
      )
      .get(frameIndex) as { image_data: Buffer } | undefined

    if (!frameRow) {
      db.close()
      return new Response('Frame image not found', { status: 404 })
    }

    // Load OCR data for this frame from full_frame_ocr table
    const ocrBoxes = db
      .prepare(
        `
      SELECT box_index, text, confidence, x, y, width, height
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
    }>

    if (ocrBoxes.length === 0) {
      db.close()
      return new Response('OCR data not found for this frame', { status: 404 })
    }

    // Load user annotations for this frame
    const userAnnotations = db
      .prepare(
        `
      SELECT box_index, label FROM full_frame_box_labels
      WHERE frame_index = ? AND label_source = 'user'
    `
      )
      .all(frameIndex) as Array<{ box_index: number; label: 'in' | 'out' }>

    const userAnnotationMap = new Map(userAnnotations.map(a => [a.box_index, a.label]))

    // Convert OCR boxes to box format
    const boxes: OCRBox[] = ocrBoxes.map((box, index) => {
      const { text, confidence, x, y, width, height } = box

      // Convert fractional to pixels (top-referenced)
      const boxLeft = Math.floor(x * layoutConfig.frame_width)
      const boxBottom = Math.floor((1 - y) * layoutConfig.frame_height)
      const boxTop = boxBottom - Math.floor(height * layoutConfig.frame_height)
      const boxRight = boxLeft + Math.floor(width * layoutConfig.frame_width)

      // Get prediction
      const selectionRect =
        layoutConfig.selection_left !== null &&
        layoutConfig.selection_top !== null &&
        layoutConfig.selection_right !== null &&
        layoutConfig.selection_bottom !== null
          ? {
              left: layoutConfig.selection_left,
              top: layoutConfig.selection_top,
              right: layoutConfig.selection_right,
              bottom: layoutConfig.selection_bottom,
            }
          : null

      const prediction = predictBoxLabel(
        { left: boxLeft, top: boxTop, right: boxRight, bottom: boxBottom },
        selectionRect
      )

      return {
        text,
        confidence,
        bounds: {
          left: boxLeft,
          top: boxTop,
          right: boxRight,
          bottom: boxBottom,
        },
        predictedLabel: prediction.label,
        predictedConfidence: prediction.confidence,
        userLabel: userAnnotationMap.get(index) ?? null,
      }
    })

    // Generate SVG overlay
    const svg = generateLayoutVisualizationSVG(
      layoutConfig.frame_width,
      layoutConfig.frame_height,
      boxes,
      layoutConfig
    )

    // Composite SVG overlay on top of frame image using sharp
    const buffer = await sharp(frameRow.image_data)
      .composite([
        {
          input: Buffer.from(svg),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer()

    db.close()

    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error('Error generating layout visualization:', error)
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
