/**
 * Background video processing service
 *
 * Triggers full_frames pipeline after video upload completes
 */

import { spawn } from 'child_process'
import { resolve } from 'path'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'

interface ProcessingOptions {
  videoPath: string  // Relative path like "show_name/video_name"
  videoFile: string  // Full path to uploaded video file
}

/**
 * Trigger background processing for an uploaded video
 *
 * This runs the full_frames pipeline which:
 * 1. Extracts frames at 0.1Hz (10x sampling)
 * 2. Runs OCR on all frames
 * 3. Analyzes subtitle region layout
 * 4. Writes results to annotations.db
 */
export async function triggerVideoProcessing(options: ProcessingOptions): Promise<void> {
  const { videoPath, videoFile } = options

  console.log(`[VideoProcessing] Starting processing for: ${videoPath}`)

  // Get database path
  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
  const videoDir = resolve(dataDir, ...videoPath.split('/'))
  const dbPath = resolve(videoDir, 'annotations.db')

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`)
  }

  if (!existsSync(videoFile)) {
    throw new Error(`Video file not found: ${videoFile}`)
  }

  // Update status to processing
  const db = new Database(dbPath)
  try {
    db.prepare(`
      UPDATE processing_status
      SET status = 'extracting_frames',
          processing_started_at = datetime('now')
      WHERE id = 1
    `).run()
  } finally {
    db.close()
  }

  // Run full_frames pipeline
  // Output directory: videoDir/full_frames
  const outputDir = resolve(videoDir, 'full_frames')

  const fullFramesCmd = spawn(
    'uv',
    [
      'run',
      'python',
      '-m',
      'full_frames',
      'analyze',
      videoFile,
      '--output-dir',
      outputDir,
      '--frame-rate',
      '0.1'  // 0.1Hz = 10x sampling
    ],
    {
      cwd: resolve(process.cwd(), '..', '..', 'data-pipelines', 'full_frames'),
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  let stdout = ''
  let stderr = ''

  fullFramesCmd.stdout?.on('data', (data) => {
    stdout += data.toString()
    console.log(`[full_frames] ${data.toString().trim()}`)

    // Parse progress from output (if available)
    // Example: "Step 2/3: Running OCR (42/100 frames)"
    const progressMatch = data.toString().match(/\((\d+)\/(\d+)\s+frames\)/)
    if (progressMatch) {
      const current = parseInt(progressMatch[1])
      const total = parseInt(progressMatch[2])
      const progress = current / total

      // Update progress in database
      const db = new Database(dbPath)
      try {
        db.prepare(`
          UPDATE processing_status
          SET ocr_progress = ?
          WHERE id = 1
        `).run(progress)
      } finally {
        db.close()
      }
    }
  })

  fullFramesCmd.stderr?.on('data', (data) => {
    stderr += data.toString()
    console.error(`[full_frames] ${data.toString().trim()}`)
  })

  fullFramesCmd.on('close', (code) => {
    const db = new Database(dbPath)
    try {
      if (code === 0) {
        // Success - mark as complete
        db.prepare(`
          UPDATE processing_status
          SET status = 'processing_complete',
              processing_completed_at = datetime('now'),
              frame_extraction_progress = 1.0,
              ocr_progress = 1.0,
              layout_analysis_progress = 1.0
          WHERE id = 1
        `).run()

        console.log(`[VideoProcessing] Processing complete: ${videoPath}`)
      } else {
        // Error - mark as failed
        db.prepare(`
          UPDATE processing_status
          SET status = 'error',
              error_message = ?,
              error_details = ?,
              error_occurred_at = datetime('now')
          WHERE id = 1
        `).run(
          `full_frames pipeline failed with code ${code}`,
          JSON.stringify({ code, stdout, stderr })
        )

        console.error(`[VideoProcessing] Processing failed: ${videoPath} (exit code: ${code})`)
      }
    } finally {
      db.close()
    }
  })

  fullFramesCmd.on('error', (error) => {
    console.error(`[VideoProcessing] Failed to start processing: ${error.message}`)

    const db = new Database(dbPath)
    try {
      db.prepare(`
        UPDATE processing_status
        SET status = 'error',
            error_message = ?,
            error_details = ?,
            error_occurred_at = datetime('now')
        WHERE id = 1
      `).run(
        `Failed to start processing: ${error.message}`,
        JSON.stringify({ error: error.message, stack: error.stack })
      )
    } finally {
      db.close()
    }
  })
}

/**
 * Get processing status for a video
 */
export function getProcessingStatus(videoPath: string) {
  const dbPath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoPath.split('/'),
    'annotations.db'
  )

  if (!existsSync(dbPath)) {
    return null
  }

  const db = new Database(dbPath)
  try {
    const status = db.prepare(`
      SELECT * FROM processing_status WHERE id = 1
    `).get()
    return status
  } finally {
    db.close()
  }
}
