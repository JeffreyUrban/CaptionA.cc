/**
 * Background video processing service
 *
 * Triggers full_frames pipeline after video upload completes
 *
 * Processing Queue:
 * - Limits concurrent processing to avoid overwhelming system resources
 * - Processes videos in FIFO order
 * - Auto-processes next video when one completes
 */

import { spawn } from 'child_process'
import { resolve } from 'path'
import Database from 'better-sqlite3'
import { existsSync, readdirSync } from 'fs'

interface ProcessingOptions {
  videoPath: string  // Relative path like "show_name/video_name"
  videoFile: string  // Full path to uploaded video file
}

// Processing queue management
const MAX_CONCURRENT_PROCESSING = 2  // Process at most 2 videos simultaneously
const processingQueue: ProcessingOptions[] = []
let activeProcessingCount = 0

/**
 * Add video to processing queue and start processing if capacity available
 */
export function queueVideoProcessing(options: ProcessingOptions): void {
  console.log(`[ProcessingQueue] Queuing ${options.videoPath} (queue size: ${processingQueue.length}, active: ${activeProcessingCount})`)
  processingQueue.push(options)
  processNextInQueue()
}

/**
 * Process next video in queue if under concurrency limit
 */
async function processNextInQueue(): Promise<void> {
  if (activeProcessingCount >= MAX_CONCURRENT_PROCESSING) {
    console.log(`[ProcessingQueue] At max capacity (${MAX_CONCURRENT_PROCESSING}), waiting...`)
    return
  }

  const nextVideo = processingQueue.shift()
  if (!nextVideo) {
    console.log(`[ProcessingQueue] Queue empty`)
    return
  }

  activeProcessingCount++
  console.log(`[ProcessingQueue] Starting ${nextVideo.videoPath} (${activeProcessingCount}/${MAX_CONCURRENT_PROCESSING} active, ${processingQueue.length} queued)`)

  try {
    await triggerVideoProcessing(nextVideo)
  } catch (error) {
    console.error(`[ProcessingQueue] Error processing ${nextVideo.videoPath}:`, error)
  } finally {
    activeProcessingCount--
    console.log(`[ProcessingQueue] Completed ${nextVideo.videoPath} (${activeProcessingCount}/${MAX_CONCURRENT_PROCESSING} active, ${processingQueue.length} queued)`)

    // Process next video in queue
    processNextInQueue()
  }
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
    // Video file not found - likely renamed or deleted
    // Mark as failed gracefully instead of throwing
    console.error(`[VideoProcessing] Video file not found: ${videoFile}`)

    const db = new Database(dbPath)
    try {
      db.prepare(`
        UPDATE processing_status
        SET status = 'error',
            error_message = 'Video file not found (may have been renamed or deleted)',
            error_details = ?,
            error_occurred_at = datetime('now')
        WHERE id = 1
      `).run(JSON.stringify({
        reason: 'file_not_found',
        videoFile,
        videoPath
      }))
    } finally {
      db.close()
    }

    console.log(`[VideoProcessing] Marked ${videoPath} as failed (file not found)`)
    return
  }

  // Update status to processing
  const db = new Database(dbPath)
  try {
    db.prepare(`
      UPDATE processing_status
      SET status = 'extracting_frames',
          processing_started_at = datetime('now'),
          processing_attempts = processing_attempts + 1
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

  // Store PID for potential cancellation
  const pid = fullFramesCmd.pid
  if (pid) {
    const db2 = new Database(dbPath)
    try {
      db2.prepare(`
        UPDATE processing_status
        SET current_job_id = ?
        WHERE id = 1
      `).run(pid.toString())
    } finally {
      db2.close()
    }
  }

  let stdout = ''
  let stderr = ''

  fullFramesCmd.stdout?.on('data', (data) => {
    stdout += data.toString()
    console.log(`[full_frames] ${data.toString().trim()}`)

    // Update heartbeat on any output to detect stalled processing
    try {
      if (existsSync(dbPath)) {
        const db = new Database(dbPath)
        try {
          db.prepare(`
            UPDATE processing_status
            SET last_heartbeat_at = datetime('now')
            WHERE id = 1
          `).run()
        } finally {
          db.close()
        }
      }
    } catch (error) {
      console.log(`[VideoProcessing] Failed to update heartbeat: ${error}`)
    }

    // Parse progress from output (if available)
    // Example: "Step 2/3: Running OCR (42/100 frames)"
    const progressMatch = data.toString().match(/\((\d+)\/(\d+)\s+frames\)/)
    if (progressMatch) {
      const current = parseInt(progressMatch[1])
      const total = parseInt(progressMatch[2])
      const progress = current / total

      // Update progress in database (skip if video was deleted during processing)
      try {
        if (existsSync(dbPath)) {
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
      } catch (error) {
        // Video may have been deleted during processing - ignore
        console.log(`[VideoProcessing] Failed to update progress (video may be deleted): ${error}`)
      }
    }
  })

  fullFramesCmd.stderr?.on('data', (data) => {
    stderr += data.toString()
    console.error(`[full_frames] ${data.toString().trim()}`)
  })

  fullFramesCmd.on('close', (code) => {
    // Skip status update if video was deleted during processing
    if (!existsSync(dbPath)) {
      console.log(`[VideoProcessing] Video ${videoPath} was deleted during processing, skipping status update`)
      return
    }

    try {
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
    } catch (error) {
      console.error(`[VideoProcessing] Failed to update status for ${videoPath}:`, error)
    }
  })

  fullFramesCmd.on('error', (error) => {
    console.error(`[VideoProcessing] Failed to start processing: ${error.message}`)

    // Skip status update if video was deleted
    if (!existsSync(dbPath)) {
      console.log(`[VideoProcessing] Video ${videoPath} was deleted, skipping error status update`)
      return
    }

    try {
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
    } catch (dbError) {
      console.error(`[VideoProcessing] Failed to update error status for ${videoPath}:`, dbError)
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

/**
 * Recover stalled processing jobs on server startup
 * Detects jobs that were interrupted by server restart
 */
export function recoverStalledProcessing() {
  console.log('[VideoProcessing] Checking for stalled processing jobs...')

  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')
  if (!existsSync(dataDir)) {
    return
  }

  // Scan all video directories for stalled processing
  const scanDirectory = (dirPath: string, relativePath: string = '') => {
    const entries = readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const newRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name
        const subPath = resolve(dirPath, entry.name)

        // Check if this directory has an annotations.db
        const dbPath = resolve(subPath, 'annotations.db')
        if (existsSync(dbPath)) {
          checkAndRecoverVideo(dbPath, newRelativePath)
        }

        // Recursively scan subdirectories
        scanDirectory(subPath, newRelativePath)
      }
    }
  }

  scanDirectory(dataDir)
}

/**
 * Check a single video for stalled processing and recover if needed
 */
function checkAndRecoverVideo(dbPath: string, videoPath: string) {
  try {
    const db = new Database(dbPath)
    try {
      const status = db.prepare(`
        SELECT status, current_job_id, processing_started_at, last_heartbeat_at
        FROM processing_status WHERE id = 1
      `).get() as {
        status: string
        current_job_id: string | null
        processing_started_at: string | null
        last_heartbeat_at: string | null
      } | undefined

      if (!status) return

      // Check if processing is in an active state
      const activeStates = ['extracting_frames', 'running_ocr', 'analyzing_layout']
      if (!activeStates.includes(status.status)) return

      // Check if process is still running
      const pid = status.current_job_id ? parseInt(status.current_job_id) : null
      let processRunning = false

      if (pid) {
        try {
          // Check if process exists (doesn't kill it)
          process.kill(pid, 0)
          processRunning = true
        } catch {
          processRunning = false
        }
      }

      if (!processRunning) {
        // Process is not running - mark as failed
        console.log(`[VideoProcessing] Recovering stalled processing for ${videoPath} (PID ${pid} not running)`)

        db.prepare(`
          UPDATE processing_status
          SET status = 'error',
              error_message = 'Processing interrupted (server restart or process crash)',
              error_details = ?,
              error_occurred_at = datetime('now')
          WHERE id = 1
        `).run(JSON.stringify({
          reason: 'stalled_process',
          pid,
          lastHeartbeat: status.last_heartbeat_at,
          processingStarted: status.processing_started_at
        }))
      }
    } finally {
      db.close()
    }
  } catch (error) {
    console.error(`[VideoProcessing] Error checking ${videoPath}:`, error)
  }
}
