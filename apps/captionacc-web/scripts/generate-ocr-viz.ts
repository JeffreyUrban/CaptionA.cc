#!/usr/bin/env tsx
/**
 * Generate OCR visualizations for all videos using the original implementation.
 */

import Database from 'better-sqlite3'
import { glob } from 'glob'

import {
  generateOCRVisualization,
  type LayoutAnalysisBox,
  type CropBounds,
} from '../app/services/layout-analysis-service'

// Type for minimal box data needed for visualization
type VisualizationBox = Pick<LayoutAnalysisBox, 'predictedLabel' | 'originalBounds'>

interface LayoutConfig {
  frame_width: number
  frame_height: number
  crop_left: number
  crop_top: number
  crop_right: number
  crop_bottom: number
  anchor_type: 'left' | 'center' | 'right' | null
  anchor_position: number | null
  vertical_position: number | null
}

interface OCRBox {
  x: number
  y: number
  width: number
  height: number
  predicted_label: string
}

async function processVideo(
  dbPath: string
): Promise<{ processed?: boolean; skipped?: boolean; reason?: string; boxCount?: number }> {
  const db = new Database(dbPath)

  try {
    // Check if already has visualization
    const existing = db
      .prepare(
        'SELECT ocr_visualization_image IS NOT NULL as has_viz FROM video_layout_config WHERE id = 1'
      )
      .get() as { has_viz: number } | undefined
    if (existing?.has_viz) {
      return { skipped: true, reason: 'already_exists' }
    }

    // Get classified boxes
    const boxes = db
      .prepare(
        `
      SELECT x, y, width, height, predicted_label
      FROM full_frame_ocr
      WHERE predicted_label = 'in'
    `
      )
      .all() as OCRBox[]

    if (boxes.length === 0) {
      return { skipped: true, reason: 'no_boxes' }
    }

    // Get crop bounds and layout params
    const layoutConfig = db.prepare('SELECT * FROM video_layout_config WHERE id = 1').get() as
      | LayoutConfig
      | undefined
    if (!layoutConfig) {
      return { skipped: true, reason: 'no_config' }
    }

    const cropBounds: CropBounds = {
      left: layoutConfig.crop_left,
      top: layoutConfig.crop_top,
      right: layoutConfig.crop_right,
      bottom: layoutConfig.crop_bottom,
    }

    const layoutParams = layoutConfig.anchor_type
      ? {
          anchorType: layoutConfig.anchor_type,
          anchorPosition: layoutConfig.anchor_position!,
          verticalPosition: layoutConfig.vertical_position!,
        }
      : undefined

    // Transform boxes to analysisBoxes format
    // Note: OCR boxes are stored in normalized coordinates (0-1 range)
    // and need to be converted to pixel coordinates
    const analysisBoxes: VisualizationBox[] = boxes.map(box => {
      // Convert from normalized to pixel coordinates
      const left = Math.floor(box.x * layoutConfig.frame_width)
      const bottom = Math.floor((1 - box.y) * layoutConfig.frame_height)
      const boxWidth = Math.floor(box.width * layoutConfig.frame_width)
      const boxHeight = Math.floor(box.height * layoutConfig.frame_height)

      return {
        predictedLabel: box.predicted_label as 'in' | 'out',
        originalBounds: {
          left,
          top: bottom - boxHeight,
          right: left + boxWidth,
          bottom,
        },
      }
    })

    // Generate visualization using the original function
    const vizData = await generateOCRVisualization(
      analysisBoxes,
      cropBounds,
      layoutConfig.frame_width,
      layoutConfig.frame_height,
      layoutParams
    )

    // Save to database
    db.prepare(
      `
      UPDATE video_layout_config
      SET ocr_visualization_image = ?,
          updated_at = datetime('now')
      WHERE id = 1
    `
    ).run(vizData)

    return { processed: true, boxCount: boxes.length }
  } finally {
    db.close()
  }
}

async function main() {
  const dataDir = process.argv[2] || '../../local/data'

  console.log(`Searching for video databases in: ${dataDir}`)

  // Find all video databases
  const videoDbs = await glob(`${dataDir}/**/captions.db`)
  console.log(`Found ${videoDbs.length} video databases\n`)

  let processed = 0
  let skipped = 0

  for (const dbPath of videoDbs) {
    const result = await processVideo(dbPath)
    if (result.processed) {
      processed++
      if (processed % 10 === 0) {
        console.log(`Processed ${processed}/${videoDbs.length}...`)
      }
    } else {
      skipped++
    }
  }

  console.log('\n✓ Complete!')
  console.log(`  Processed: ${processed}`)
  console.log(`  Skipped: ${skipped}`)
}

main().catch(console.error)
