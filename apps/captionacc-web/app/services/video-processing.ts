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
import { getDbPath, getVideoDir, getAllVideos } from '~/utils/video-paths'
import { tryStartProcessing, finishProcessing, registerQueueProcessor } from './processing-coordinator'
import { recoverStalledCropFrames } from './crop-frames-processing'

interface ProcessingOptions {
  videoPath: string  // Display path (user-facing) like "show_name/video_name"
  videoFile: string  // Full path to uploaded video file
  videoId?: string   // UUID for this video (optional for backward compat)
}

// Processing queue management
const processingQueue: ProcessingOptions[] = []

/**
 * Add video to processing queue and start processing if capacity available
 */
export function queueVideoProcessing(options: ProcessingOptions): void {
  console.log(`[FullFramesQueue] Queuing ${options.videoPath} (queue size: ${processingQueue.length})`)
  processingQueue.push(options)
  processNextInQueue()
}

/**
 * Process next video in queue if under concurrency limit
 * Called by processing coordinator when capacity becomes available
 */
function processNextInQueue(): void {
  if (processingQueue.length === 0) {
    return
  }

  // Check if we have capacity (coordinator manages global limit)
  if (!tryStartProcessing()) {
    console.log(`[FullFramesQueue] At capacity, waiting... (${processingQueue.length} queued)`)
    return
  }

  const nextVideo = processingQueue.shift()!
  console.log(`[FullFramesQueue] Starting ${nextVideo.videoPath} (${processingQueue.length} remaining)`)

  triggerVideoProcessing(nextVideo)
    .catch(error => {
      console.error(`[FullFramesQueue] Error processing ${nextVideo.videoPath}:`, error)
    })
    .finally(() => {
      finishProcessing() // This will trigger processNextInQueue for all queues
    })
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
  const { videoPath, videoFile, videoId } = options

  console.log(`[VideoProcessing] Starting processing for: ${videoPath}`)

  // Resolve to actual storage paths (prefer videoId if available)
  const pathOrId = videoId || videoPath
  const dbPath = getDbPath(pathOrId)
  const videoDir = getVideoDir(pathOrId)

  if (!dbPath || !videoDir) {
    throw new Error(`Video not found: ${videoPath} (videoId: ${videoId})`)
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

  // Return a Promise that resolves when the process completes
  return new Promise<void>((resolve) => {
    fullFramesCmd.on('close', (code) => {
      // Skip status update if video was deleted during processing
      if (!existsSync(dbPath)) {
        console.log(`[VideoProcessing] Video ${videoPath} was deleted during processing, skipping status update`)
        resolve()
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

      resolve()
    })

    fullFramesCmd.on('error', (error) => {
      console.error(`[VideoProcessing] Failed to start processing: ${error.message}`)

      // Skip status update if video was deleted
      if (!existsSync(dbPath)) {
        console.log(`[VideoProcessing] Video ${videoPath} was deleted, skipping error status update`)
        resolve()
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

      resolve()
    })
  })
}

/**
 * Get processing status for a video
 */
export function getProcessingStatus(videoPath: string) {
  const dbPath = getDbPath(videoPath)

  if (!dbPath) {
    return null
  }

  const db = new Database(dbPath, { readonly: true })
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

  // Get all videos and check for stalled processing
  const allVideos = getAllVideos()

  for (const video of allVideos) {
    const dbPath = getDbPath(video.videoId)
    if (dbPath) {
      // Check both full_frames and crop_frames processing
      checkAndRecoverVideo(dbPath, video.displayPath, video.videoId)
      recoverStalledCropFrames(video.videoId, video.displayPath)
    }
  }
}

/**
 * Check a single video for stalled processing and recover if needed
 */
function checkAndRecoverVideo(dbPath: string, videoPath: string, videoId: string) {
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

      // Handle videos queued for processing (lost from in-memory queue)
      if (status.status === 'upload_complete') {
        console.log(`[VideoProcessing] Requeuing ${videoPath} (was queued when server restarted)`)

        // Find the video file
        const videoDir = getVideoDir(videoId)
        if (!videoDir) {
          console.error(`[VideoProcessing] Video directory not found for ${videoPath}`)
          return
        }

        const videoFiles = readdirSync(videoDir).filter(f =>
          f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.avi') || f.endsWith('.mov')
        )

        if (videoFiles.length === 0) {
          console.error(`[VideoProcessing] Video file not found in ${videoDir}`)

          // Mark as error since we can't requeue without a video file
          db.prepare(`
            UPDATE processing_status
            SET status = 'error',
                error_message = 'Video file not found (cannot requeue)',
                error_occurred_at = datetime('now')
            WHERE id = 1
          `).run()
          return
        }

        const videoFile = resolve(videoDir, videoFiles[0])

        // Requeue for processing
        queueVideoProcessing({
          videoPath: videoPath,
          videoFile,
          videoId
        })
        return
      }

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

// Register with coordinator (crop_frames has priority, so register full_frames second)
registerQueueProcessor(processNextInQueue)
