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
import { existsSync, readdirSync } from 'fs'
import { resolve } from 'path'

import Database from 'better-sqlite3'

import { recoverStalledCropFrames } from './crop-frames-processing'
import {
  tryStartProcessing,
  finishProcessing,
  registerQueueProcessor,
} from './processing-coordinator'

import { migrateDatabase } from '~/db/migrate'
import { getCaptionsDbPath, getVideoDir, getAllVideos } from '~/utils/video-paths'

interface ProcessingOptions {
  videoPath: string // Display path (user-facing) like "show_name/video_name"
  videoFile: string // Full path to uploaded video file
  videoId?: string // UUID for this video (optional for backward compat)
}

// Processing queue management
const processingQueue: ProcessingOptions[] = []

/**
 * Add video to processing queue and start processing if capacity available
 */
export function queueVideoProcessing(options: ProcessingOptions): void {
  console.log(
    `[FullFramesQueue] Queuing ${options.videoPath} (queue size: ${processingQueue.length})`
  )
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

  const nextVideo = processingQueue.shift()
  if (!nextVideo) {
    finishProcessing()
    return
  }
  console.log(
    `[FullFramesQueue] Starting ${nextVideo.videoPath} (${processingQueue.length} remaining)`
  )

  triggerVideoProcessing(nextVideo)
    .catch(error => {
      console.error(`[FullFramesQueue] Error processing ${nextVideo.videoPath}:`, error)
    })
    .finally(() => {
      finishProcessing() // This will trigger processNextInQueue for all queues
    })
}

// ============================================================================
// Database Helper Functions for triggerVideoProcessing
// ============================================================================

/**
 * Mark a video as having an error during processing
 * Updates status to 'error' with message and details
 *
 * @param dbPath - Path to the video's captions.db
 * @param message - Human-readable error message
 * @param details - Additional error details (will be JSON stringified)
 */
function markVideoAsError(dbPath: string, message: string, details: object): void {
  if (!existsSync(dbPath)) return

  const db = new Database(dbPath)
  try {
    db.prepare(
      `
      UPDATE processing_status
      SET status = 'error',
          error_message = ?,
          error_details = ?,
          error_occurred_at = datetime('now')
      WHERE id = 1
    `
    ).run(message, JSON.stringify(details))
  } finally {
    db.close()
  }
}

/**
 * Mark a video as starting processing
 * Updates status to 'extracting_frames', increments attempts, sets start time
 *
 * @param dbPath - Path to the video's captions.db
 */
function markVideoAsProcessing(dbPath: string): void {
  const db = new Database(dbPath)
  try {
    db.prepare(
      `
      UPDATE processing_status
      SET status = 'extracting_frames',
          processing_started_at = datetime('now'),
          processing_attempts = processing_attempts + 1
      WHERE id = 1
    `
    ).run()
  } finally {
    db.close()
  }
}

/**
 * Mark a video as having completed processing successfully
 * Updates status to 'processing_complete' and sets all progress to 1.0
 *
 * @param dbPath - Path to the video's captions.db
 */
function markVideoAsComplete(dbPath: string): void {
  if (!existsSync(dbPath)) return

  const db = new Database(dbPath)
  try {
    db.prepare(
      `
      UPDATE processing_status
      SET status = 'processing_complete',
          processing_completed_at = datetime('now'),
          frame_extraction_progress = 1.0,
          ocr_progress = 1.0,
          layout_analysis_progress = 1.0
      WHERE id = 1
    `
    ).run()
  } finally {
    db.close()
  }
}

/**
 * Update heartbeat timestamp to detect stalled processing
 * Silently handles errors (video may have been deleted during processing)
 *
 * @param dbPath - Path to the video's captions.db
 */
function updateVideoHeartbeat(dbPath: string): void {
  if (!existsSync(dbPath)) return

  try {
    const db = new Database(dbPath)
    try {
      db.prepare(
        `
        UPDATE processing_status
        SET last_heartbeat_at = datetime('now')
        WHERE id = 1
      `
      ).run()
    } finally {
      db.close()
    }
  } catch (error) {
    console.log(`[VideoProcessing] Failed to update heartbeat: ${error}`)
  }
}

/**
 * Update OCR progress in the database
 * Silently handles errors (video may have been deleted during processing)
 *
 * @param dbPath - Path to the video's captions.db
 * @param progress - Progress ratio (0.0 to 1.0)
 */
function updateVideoProgress(dbPath: string, progress: number): void {
  if (!existsSync(dbPath)) return

  try {
    const db = new Database(dbPath)
    try {
      db.prepare(
        `
        UPDATE processing_status
        SET ocr_progress = ?
        WHERE id = 1
      `
      ).run(progress)
    } finally {
      db.close()
    }
  } catch (error) {
    console.log(`[VideoProcessing] Failed to update progress (video may be deleted): ${error}`)
  }
}

/**
 * Store the process PID for potential cancellation
 *
 * @param dbPath - Path to the video's captions.db
 * @param pid - Process ID of the spawned pipeline
 */
function storeProcessPid(dbPath: string, pid: number): void {
  const db = new Database(dbPath)
  try {
    db.prepare(
      `
      UPDATE processing_status
      SET current_job_id = ?
      WHERE id = 1
    `
    ).run(pid.toString())
  } finally {
    db.close()
  }
}

/**
 * Parse progress from pipeline output
 * Extracts frame progress from format: "(42/100 frames)"
 *
 * @param data - Output string from pipeline
 * @returns Progress ratio (0.0 to 1.0), or null if no progress found
 */
function parseProgressFromOutput(data: string): number | null {
  const progressMatch = data.match(/\((\d+)\/(\d+)\s+frames\)/)
  if (!progressMatch) return null

  // Destructure with default to satisfy TypeScript (regex guarantees 2 capture groups)
  const [, currentStr = '0', totalStr = '1'] = progressMatch
  const current = parseInt(currentStr)
  const total = parseInt(totalStr)
  return current / total
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Trigger background processing for an uploaded video
 *
 * This runs the full_frames pipeline which:
 * 1. Extracts frames at 0.1Hz (10x sampling)
 * 2. Runs OCR on all frames
 * 3. Analyzes subtitle region layout
 * 4. Writes results to captions.db
 */
export async function triggerVideoProcessing(options: ProcessingOptions): Promise<void> {
  const { videoPath, videoFile, videoId } = options

  console.log(`[VideoProcessing] Starting processing for: ${videoPath}`)

  // Resolve to actual storage paths (prefer videoId if available)
  const pathOrId = videoId ?? videoPath
  const dbPath = await getCaptionsDbPath(pathOrId)
  const videoDir = await getVideoDir(pathOrId)

  if (!dbPath || !videoDir) {
    throw new Error(`Video not found: ${videoPath} (videoId: ${videoId})`)
  }

  // Check video file exists
  if (!existsSync(videoFile)) {
    console.error(`[VideoProcessing] Video file not found: ${videoFile}`)
    markVideoAsError(dbPath, 'Video file not found (may have been renamed or deleted)', {
      reason: 'file_not_found',
      videoFile,
      videoPath,
    })
    console.log(`[VideoProcessing] Marked ${videoPath} as failed (file not found)`)
    return
  }

  // Mark as processing
  markVideoAsProcessing(dbPath)

  // Spawn full_frames pipeline
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
      '0.1', // 0.1Hz = 10x sampling
    ],
    {
      cwd: resolve(process.cwd(), '..', '..', 'data-pipelines', 'full_frames'),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  // Store PID for potential cancellation
  if (fullFramesCmd.pid) {
    storeProcessPid(dbPath, fullFramesCmd.pid)
  }

  // Setup output handlers
  let stdout = ''
  let stderr = ''

  fullFramesCmd.stdout?.on('data', data => {
    stdout += data.toString()
    console.log(`[full_frames] ${data.toString().trim()}`)

    // Update heartbeat on any output to detect stalled processing
    updateVideoHeartbeat(dbPath)

    // Parse and update progress if available
    const progress = parseProgressFromOutput(data.toString())
    if (progress !== null) {
      updateVideoProgress(dbPath, progress)
    }
  })

  fullFramesCmd.stderr?.on('data', data => {
    stderr += data.toString()
    console.error(`[full_frames] ${data.toString().trim()}`)
  })

  // Return a Promise that resolves when the process completes
  return new Promise<void>(promiseResolve => {
    fullFramesCmd.on('close', code => {
      // Skip status update if video was deleted during processing
      if (!existsSync(dbPath)) {
        console.log(
          `[VideoProcessing] Video ${videoPath} was deleted during processing, skipping status update`
        )
        promiseResolve()
        return
      }

      if (code === 0) {
        markVideoAsComplete(dbPath)
        console.log(`[VideoProcessing] Processing complete: ${videoPath}`)
      } else {
        markVideoAsError(dbPath, `full_frames pipeline failed with code ${code}`, {
          code,
          stdout,
          stderr,
        })
        console.error(`[VideoProcessing] Processing failed: ${videoPath} (exit code: ${code})`)
      }

      promiseResolve()
    })

    fullFramesCmd.on('error', error => {
      console.error(`[VideoProcessing] Failed to start processing: ${error.message}`)

      // Skip status update if video was deleted
      if (!existsSync(dbPath)) {
        console.log(
          `[VideoProcessing] Video ${videoPath} was deleted, skipping error status update`
        )
        promiseResolve()
        return
      }

      markVideoAsError(dbPath, `Failed to start processing: ${error.message}`, {
        error: error.message,
        stack: error.stack,
      })

      promiseResolve()
    })
  })
}

/**
 * Get processing status for a video
 */
export async function getProcessingStatus(videoPath: string) {
  const dbPath = await getCaptionsDbPath(videoPath)

  if (!dbPath) {
    return null
  }

  const db = new Database(dbPath, { readonly: true })
  try {
    const status = db
      .prepare(
        `
      SELECT * FROM processing_status WHERE id = 1
    `
      )
      .get()
    return status
  } finally {
    db.close()
  }
}

/**
 * Recover stalled processing jobs on server startup
 * Detects jobs that were interrupted by server restart
 */
export async function recoverStalledProcessing() {
  console.log('[VideoProcessing] Checking for stalled processing jobs...')

  // Get all videos and check for stalled processing
  const allVideos = await getAllVideos()

  for (const video of allVideos) {
    const dbPath = await getCaptionsDbPath(video.videoId)
    if (dbPath) {
      // Run migrations (idempotent - safe to run multiple times)
      try {
        migrateDatabase(dbPath)
      } catch (error) {
        console.error(`[VideoProcessing] Failed to migrate ${video.displayPath}:`, error)
      }

      // Check both full_frames and crop_frames processing
      await checkAndRecoverVideo(dbPath, video.displayPath, video.videoId)
      recoverStalledCropFrames(video.videoId, video.displayPath)
    }
  }
}

// ============================================================================
// Helper Functions for Video Recovery
// ============================================================================

/**
 * Find the video file in a video directory
 * Consolidates duplicated video file lookup logic
 *
 * @param videoId - The video UUID
 * @returns Full path to video file, or null if not found
 */
async function findVideoFile(videoId: string): Promise<string | null> {
  const { readdirSync } = await import('fs')
  const { resolve } = await import('path')

  const videoDir = await getVideoDir(videoId)
  if (!videoDir) return null

  const videoFiles = readdirSync(videoDir).filter(
    f => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.avi') || f.endsWith('.mov')
  )

  const firstVideoFile = videoFiles[0]
  if (!firstVideoFile) return null

  return resolve(videoDir, firstVideoFile)
}

/**
 * Check if an error is recoverable and should be auto-retried
 *
 * @param errorMessage - The error message from processing_status
 * @param errorDetails - The error details from processing_status
 * @returns true if error can be auto-retried
 */
function isRecoverableError(errorMessage: string | null, errorDetails: string | null): boolean {
  const isOcrFailure = errorDetails?.includes('OCR') && errorDetails?.includes('failed')
  const isInterrupted = errorMessage?.includes('Processing interrupted')
  const isDuplicateFrame = errorDetails?.includes(
    'UNIQUE constraint failed: full_frames.frame_index'
  )

  return Boolean(isOcrFailure) || Boolean(isInterrupted) || Boolean(isDuplicateFrame)
}

/**
 * Check if a process is still running
 *
 * @param pid - Process ID to check, or null
 * @returns true if process is running, false otherwise
 */
function isProcessRunning(pid: number | null): boolean {
  if (!pid) return false

  try {
    process.kill(pid, 0) // Check if process exists (doesn't kill it)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Recovery Strategy Functions
// ============================================================================

/**
 * Requeue a video that was pending when server restarted
 * Handles videos with 'upload_complete' status
 *
 * @param db - Database connection
 * @param videoId - Video UUID
 * @param videoPath - Display path for logging
 */
async function requeuePendingVideo(
  db: Database.Database,
  videoId: string,
  videoPath: string
): Promise<void> {
  console.log(`[VideoProcessing] Requeuing ${videoPath} (was queued when server restarted)`)

  const videoFile = await findVideoFile(videoId)
  if (!videoFile) {
    console.error(`[VideoProcessing] Video file not found for ${videoPath}`)

    // Mark as error since we can't requeue without a video file
    db.prepare(
      `
      UPDATE processing_status
      SET status = 'error',
          error_message = 'Video file not found (cannot requeue)',
          error_occurred_at = datetime('now')
      WHERE id = 1
    `
    ).run()
    return
  }

  queueVideoProcessing({
    videoPath,
    videoFile,
    videoId,
  })
}

/**
 * Retry a video that failed with a recoverable error
 * Handles auto-retry for OCR failures, interruptions, and duplicate frames
 *
 * @param db - Database connection
 * @param videoId - Video UUID
 * @param videoPath - Display path for logging
 * @param errorMessage - The error message from processing_status
 * @param errorDetails - The error details from processing_status
 */
async function retryRecoverableError(
  db: Database.Database,
  videoId: string,
  videoPath: string,
  errorMessage: string | null,
  errorDetails: string | null
): Promise<void> {
  if (!isRecoverableError(errorMessage, errorDetails)) {
    return // Not recoverable, leave as error
  }

  const isDuplicateFrame = errorDetails?.includes(
    'UNIQUE constraint failed: full_frames.frame_index'
  )
  const errorType = isDuplicateFrame ? 'duplicate frames' : 'recoverable error'
  console.log(`[VideoProcessing] Auto-retrying ${videoPath} (${errorType}: ${errorMessage})`)

  // Clear existing full_frames if duplicate error
  if (isDuplicateFrame) {
    try {
      const deleteResult = db.prepare(`DELETE FROM full_frames`).run()
      console.log(`[VideoProcessing] Cleared ${deleteResult.changes} existing frames from database`)
    } catch (error) {
      console.error(`[VideoProcessing] Failed to clear frames for ${videoPath}:`, error)
      return
    }
  }

  const videoFile = await findVideoFile(videoId)
  if (!videoFile) {
    console.error(`[VideoProcessing] Cannot retry ${videoPath}: video file not found`)
    return
  }

  // Reset to upload_complete
  db.prepare(
    `
    UPDATE processing_status
    SET status = 'upload_complete',
        error_message = NULL,
        error_details = NULL,
        error_occurred_at = NULL
    WHERE id = 1
  `
  ).run()

  // Queue for reprocessing
  queueVideoProcessing({
    videoPath,
    videoFile,
    videoId,
  })
}

/**
 * Recover a stalled active processing job
 * Handles jobs that were interrupted (process not running)
 *
 * @param db - Database connection
 * @param videoId - Video UUID
 * @param videoPath - Display path for logging
 * @param currentJobId - The PID string from processing_status
 */
async function recoverStalledJob(
  db: Database.Database,
  videoId: string,
  videoPath: string,
  currentJobId: string | null
): Promise<void> {
  const pid = currentJobId ? parseInt(currentJobId) : null

  if (isProcessRunning(pid)) {
    // Process still running, no recovery needed
    return
  }

  console.log(
    `[VideoProcessing] Auto-retrying interrupted processing for ${videoPath} (PID ${pid} not running)`
  )

  // Reset to upload_complete to allow reprocessing
  db.prepare(
    `
    UPDATE processing_status
    SET status = 'upload_complete',
        error_message = NULL,
        error_details = NULL,
        error_occurred_at = NULL
    WHERE id = 1
  `
  ).run()

  const videoFile = await findVideoFile(videoId)
  if (!videoFile) {
    console.error(`[VideoProcessing] Cannot retry ${videoPath}: video file not found`)
    return
  }

  // Queue for reprocessing after DB is closed
  setTimeout(() => {
    queueVideoProcessing({
      videoPath,
      videoFile,
      videoId,
    })
  }, 0)
}

// ============================================================================
// Main Recovery Function
// ============================================================================

/**
 * Check a single video for stalled processing and recover if needed
 * Dispatches to appropriate recovery strategy based on status
 */
async function checkAndRecoverVideo(
  dbPath: string,
  videoPath: string,
  videoId: string
): Promise<void> {
  if (!existsSync(dbPath)) return

  let db: Database.Database
  try {
    db = new Database(dbPath)
  } catch (error) {
    console.error(`[VideoProcessing] Error opening database for ${videoPath}:`, error)
    return
  }

  try {
    const status = db
      .prepare(
        `
      SELECT status, current_job_id, processing_started_at, last_heartbeat_at
      FROM processing_status WHERE id = 1
    `
      )
      .get() as
      | {
          status: string
          current_job_id: string | null
          processing_started_at: string | null
          last_heartbeat_at: string | null
        }
      | undefined

    if (!status) return

    // Handle videos queued for processing (lost from in-memory queue)
    if (status.status === 'upload_complete') {
      await requeuePendingVideo(db, videoId, videoPath)
      return
    }

    // Auto-retry recoverable errors
    if (status.status === 'error') {
      const errorInfo = db
        .prepare(
          `
        SELECT error_message, error_details FROM processing_status WHERE id = 1
      `
        )
        .get() as { error_message: string; error_details: string } | undefined

      if (errorInfo) {
        await retryRecoverableError(
          db,
          videoId,
          videoPath,
          errorInfo.error_message,
          errorInfo.error_details
        )
      }
      return
    }

    // Check for stalled active processing
    const activeStates = ['extracting_frames', 'analyzing_layout']
    if (activeStates.includes(status.status)) {
      await recoverStalledJob(db, videoId, videoPath, status.current_job_id)
    }
  } finally {
    db.close()
  }
}

// Register with coordinator (crop_frames has priority, so register full_frames second)
registerQueueProcessor(processNextInQueue)
