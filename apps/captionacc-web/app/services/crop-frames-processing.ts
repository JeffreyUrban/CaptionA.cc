/**
 * Crop Frames Processing Service
 *
 * Manages queued processing of frame cropping jobs (user-initiated)
 * Coordinates with ProcessingCoordinator to respect global resource limits
 */

import { spawn } from 'child_process'
import { resolve } from 'path'
import Database from 'better-sqlite3'
import { existsSync, readdirSync } from 'fs'
import { getDbPath, getVideoDir } from '~/utils/video-paths'
import { tryStartProcessing, finishProcessing, registerQueueProcessor } from './processing-coordinator'

interface CropFramesJob {
  videoId: string         // UUID or display path
  videoPath: string       // Display path for logging
  cropBounds: {
    left: number
    top: number
    right: number
    bottom: number
  }
}

// Processing queue
const cropFramesQueue: CropFramesJob[] = []

/**
 * Queue a crop_frames job
 * Called when user approves layout annotation or during auto-recovery
 */
export function queueCropFramesProcessing(job: CropFramesJob): void {
  console.log(`[CropFramesQueue] Queuing ${job.videoPath} (queue size: ${cropFramesQueue.length})`)

  // Immediately create status record so badge system shows "Queued" state
  const dbPath = getDbPath(job.videoId)
  if (dbPath && existsSync(dbPath)) {
    try {
      const db = new Database(dbPath)
      try {
        // Ensure crop_frames_status table exists
        db.prepare(`
          CREATE TABLE IF NOT EXISTS crop_frames_status (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            status TEXT NOT NULL DEFAULT 'queued',
            processing_started_at TEXT,
            processing_completed_at TEXT,
            current_job_id TEXT,
            error_message TEXT,
            error_details TEXT,
            error_occurred_at TEXT
          )
        `).run()

        // Set status to 'queued' (don't overwrite if already exists with different status)
        db.prepare(`
          INSERT OR IGNORE INTO crop_frames_status (id, status)
          VALUES (1, 'queued')
        `).run()
      } finally {
        db.close()
      }
    } catch (error) {
      console.error(`[CropFramesQueue] Failed to create status record for ${job.videoPath}:`, error)
    }
  }

  cropFramesQueue.push(job)
  tryProcessNext()
}

/**
 * Try to process next job in queue
 * Called by processing coordinator when capacity becomes available
 */
function tryProcessNext(): void {
  if (cropFramesQueue.length === 0) {
    return
  }

  // Check if we have capacity
  if (!tryStartProcessing()) {
    console.log(`[CropFramesQueue] At capacity, waiting... (${cropFramesQueue.length} queued)`)
    return
  }

  // Dequeue and process
  const job = cropFramesQueue.shift()!
  console.log(`[CropFramesQueue] Starting ${job.videoPath} (${cropFramesQueue.length} remaining)`)

  processCropFramesJob(job)
    .catch(error => {
      console.error(`[CropFramesQueue] Error processing ${job.videoPath}:`, error)
    })
    .finally(() => {
      finishProcessing() // This will trigger tryProcessNext for all queues
    })
}

/**
 * Process a single crop_frames job
 */
async function processCropFramesJob(job: CropFramesJob): Promise<void> {
  const { videoId, videoPath, cropBounds } = job

  console.log(`[CropFrames] Starting crop_frames for ${videoPath}`)

  // Get database path
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    throw new Error(`Database not found for ${videoPath}`)
  }

  // Get video directory
  const videoDir = getVideoDir(videoId)
  if (!videoDir) {
    throw new Error(`Video directory not found for ${videoPath}`)
  }

  // Find video file
  const videoFiles = readdirSync(videoDir).filter(f =>
    f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.avi') || f.endsWith('.mov')
  )

  if (videoFiles.length === 0) {
    throw new Error(`No video file found in ${videoDir}`)
  }

  const videoFile = resolve(videoDir, videoFiles[0])
  const outputDir = resolve(videoDir, 'crop_frames')

  // Format crop bounds as "left,top,right,bottom"
  const cropBoundsStr = `${cropBounds.left},${cropBounds.top},${cropBounds.right},${cropBounds.bottom}`

  // Get crop_bounds_version from database
  let cropBoundsVersion = 1
  const db = new Database(dbPath)
  try {
    const layoutConfig = db.prepare(`
      SELECT crop_bounds_version FROM video_layout_config WHERE id = 1
    `).get() as { crop_bounds_version?: number } | undefined

    if (layoutConfig?.crop_bounds_version) {
      cropBoundsVersion = layoutConfig.crop_bounds_version
    }
  } finally {
    db.close()
  }

  // Update database: mark as processing
  const db2 = new Database(dbPath)
  try {
    // Ensure crop_frames_status table exists (if not already created by schema)
    db2.prepare(`
      CREATE TABLE IF NOT EXISTS crop_frames_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status TEXT NOT NULL DEFAULT 'queued',
        processing_started_at TEXT,
        processing_completed_at TEXT,
        current_job_id TEXT,
        error_message TEXT,
        error_details TEXT,
        error_occurred_at TEXT
      )
    `).run()

    db2.prepare(`
      INSERT OR REPLACE INTO crop_frames_status (id, status, processing_started_at)
      VALUES (1, 'processing', datetime('now'))
    `).run()
  } finally {
    db2.close()
  }

  // Run crop_frames pipeline
  const pipelinePath = resolve(process.cwd(), '..', '..', 'data-pipelines', 'crop_frames')

  const cropFramesCmd = spawn(
    'uv',
    [
      'run',
      'crop_frames',
      'extract-frames',
      videoFile,
      outputDir,
      '--crop',
      cropBoundsStr,
      '--rate',
      '10.0',
      '--write-to-db',
      '--crop-bounds-version',
      cropBoundsVersion.toString()
    ],
    {
      cwd: pipelinePath,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  // Store PID for tracking
  const pid = cropFramesCmd.pid
  if (pid) {
    const db2 = new Database(dbPath)
    try {
      db2.prepare(`
        UPDATE crop_frames_status
        SET current_job_id = ?
        WHERE id = 1
      `).run(pid.toString())
    } finally {
      db2.close()
    }
  }

  let stdout = ''
  let stderr = ''

  cropFramesCmd.stdout?.on('data', (data) => {
    stdout += data.toString()
    console.log(`[crop_frames] ${data.toString().trim()}`)
  })

  cropFramesCmd.stderr?.on('data', (data) => {
    stderr += data.toString()
    console.error(`[crop_frames] ${data.toString().trim()}`)
  })

  // Return a Promise that resolves when the process completes
  return new Promise<void>((resolve) => {
    cropFramesCmd.on('close', (code) => {
      // Skip status update if video was deleted during processing
      if (!existsSync(dbPath)) {
        console.log(`[CropFrames] Video ${videoPath} was deleted during processing, skipping status update`)
        resolve()
        return
      }

      try {
        const db = new Database(dbPath)
        try {
          if (code === 0) {
            // Success
            db.prepare(`
              UPDATE crop_frames_status
              SET status = 'complete',
                  processing_completed_at = datetime('now')
              WHERE id = 1
            `).run()

            console.log(`[CropFrames] Processing complete: ${videoPath}`)
          } else {
            // Error
            db.prepare(`
              UPDATE crop_frames_status
              SET status = 'error',
                  error_message = ?,
                  error_details = ?,
                  error_occurred_at = datetime('now')
              WHERE id = 1
            `).run(
              `crop_frames pipeline failed with code ${code}`,
              JSON.stringify({ code, stdout, stderr })
            )

            console.error(`[CropFrames] Processing failed: ${videoPath} (exit code: ${code})`)
          }
        } finally {
          db.close()
        }
      } catch (error) {
        console.error(`[CropFrames] Failed to update status for ${videoPath}:`, error)
      }

      resolve()
    })

    cropFramesCmd.on('error', (error) => {
      console.error(`[CropFrames] Failed to start processing: ${error.message}`)

      if (!existsSync(dbPath)) {
        console.log(`[CropFrames] Video ${videoPath} was deleted, skipping error status update`)
        resolve()
        return
      }

      try {
        const db = new Database(dbPath)
        try {
          db.prepare(`
            UPDATE crop_frames_status
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
        console.error(`[CropFrames] Failed to update error status for ${videoPath}:`, dbError)
      }

      resolve()
    })
  })
}

/**
 * Recover stalled crop_frames jobs on server startup
 * Also auto-triggers processing if layout approved but crop_frames never started
 */
export function recoverStalledCropFrames(videoId: string, videoPath: string): void {
  const dbPath = getDbPath(videoId)
  if (!dbPath || !existsSync(dbPath)) {
    return
  }

  try {
    const db = new Database(dbPath)
    try {
      // Check if layout is approved by checking for video_layout_config
      const layoutConfig = db.prepare(`
        SELECT crop_left, crop_top, crop_right, crop_bottom
        FROM video_layout_config WHERE id = 1
      `).get() as {
        crop_left: number
        crop_top: number
        crop_right: number
        crop_bottom: number
      } | undefined

      // If no layout config, layout not approved yet
      if (!layoutConfig) {
        return
      }

      // Check if crop_frames_status table exists
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='crop_frames_status'
      `).get()

      // Auto-trigger processing if layout approved but crop_frames never started
      if (!tableExists) {
        console.log(`[CropFrames] Auto-triggering crop_frames for ${videoPath} (layout approved but processing never started)`)

        // Queue the processing
        queueCropFramesProcessing({
          videoId,
          videoPath,
          cropBounds: {
            left: layoutConfig.crop_left,
            top: layoutConfig.crop_top,
            right: layoutConfig.crop_right,
            bottom: layoutConfig.crop_bottom
          }
        })
        return
      }

      const status = db.prepare(`
        SELECT status, current_job_id
        FROM crop_frames_status WHERE id = 1
      `).get() as {
        status: string
        current_job_id: string | null
      } | undefined

      // Auto-trigger if layout approved but no status record
      if (!status) {
        console.log(`[CropFrames] Auto-triggering crop_frames for ${videoPath} (layout approved but no status record)`)

        queueCropFramesProcessing({
          videoId,
          videoPath,
          cropBounds: {
            left: layoutConfig.crop_left,
            top: layoutConfig.crop_top,
            right: layoutConfig.crop_right,
            bottom: layoutConfig.crop_bottom
          }
        })
        return
      }

      // Only check for stalled processing if status is 'processing'
      if (status.status !== 'processing') {
        return
      }

      // Check if process is still running
      const pid = status.current_job_id ? parseInt(status.current_job_id) : null
      let processRunning = false

      if (pid) {
        try {
          process.kill(pid, 0)
          processRunning = true
        } catch {
          processRunning = false
        }
      }

      if (!processRunning) {
        // Mark as error - user can retry from UI
        console.log(`[CropFrames] Recovering stalled job for ${videoPath} (PID ${pid} not running)`)

        db.prepare(`
          UPDATE crop_frames_status
          SET status = 'error',
              error_message = 'Processing interrupted (server restart or process crash)',
              error_details = ?,
              error_occurred_at = datetime('now')
          WHERE id = 1
        `).run(JSON.stringify({
          reason: 'stalled_process',
          pid
        }))
      }
    } finally {
      db.close()
    }
  } catch (error) {
    console.error(`[CropFrames] Error checking ${videoPath}:`, error)
  }
}

// Register with coordinator (will be called when capacity available)
registerQueueProcessor(tryProcessNext)
