/**
 * Prefect Flow Queue Client
 *
 * Queues video processing workflows to Prefect orchestrator.
 * Replaces direct pipeline spawning with durable flow queuing.
 */

import { spawn } from 'child_process'
import { resolve as pathResolve } from 'path'
import { appendFileSync } from 'fs'

const logFile = pathResolve(process.cwd(), '..', '..', 'local', 'prefect-queue.log')

function log(message: string) {
  const timestamp = new Date().toISOString()
  const logMessage = `${timestamp} ${message}\n`
  console.log(message)
  try {
    appendFileSync(logFile, logMessage)
  } catch (e) {
    console.error('Failed to write to log file:', e)
  }
}

interface QueueFlowOptions {
  videoId: string
  videoPath: string
  dbPath: string
  outputDir: string
  frameRate?: number
  cropBounds?: {
    left: number
    top: number
    right: number
    bottom: number
  }
  cropBoundsVersion?: number
}

interface QueueFlowResult {
  flowRunId: string
  status: string
  priority: string
}

/**
 * Queue a Prefect flow by spawning the queue_flow.py CLI
 *
 * This mimics the existing pattern of spawning Python processes,
 * but queues to Prefect instead of running directly.
 */
function queueFlow(
  flowType: 'full-frames' | 'crop-frames',
  options: QueueFlowOptions
): Promise<QueueFlowResult> {
  return new Promise((resolve, reject) => {
    const args = [flowType, options.videoId, options.videoPath, options.dbPath, options.outputDir]

    // Add optional frame rate for full-frames as named option
    if (
      flowType === 'full-frames' &&
      options.frameRate !== undefined &&
      options.frameRate !== 0.1
    ) {
      args.push('--frame-rate', options.frameRate.toString())
    }

    // Add crop bounds for crop-frames
    if (flowType === 'crop-frames') {
      if (!options.cropBounds) {
        reject(new Error('cropBounds required for crop-frames flow'))
        return
      }
      args.push(JSON.stringify(options.cropBounds))
      if (options.cropBoundsVersion !== undefined) {
        args.push(options.cropBoundsVersion.toString())
      }
    }

    const projectRoot = pathResolve(process.cwd(), '..', '..')
    log(`[Prefect] Spawning queue_flow.py from ${projectRoot}`)
    log(`[Prefect] Command: uv run python services/orchestrator/queue_flow.py ${args.join(' ')}`)

    const cmd = spawn('uv', ['run', 'python', 'services/orchestrator/queue_flow.py', ...args], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    cmd.stdout?.on('data', data => {
      stdout += data.toString()
    })

    cmd.stderr?.on('data', data => {
      stderr += data.toString()
    })

    cmd.on('close', code => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout) as QueueFlowResult
          log(`[Prefect] ✅ Flow queued successfully: ${result.flowRunId}`)
          resolve(result)
        } catch (e) {
          const errorMsg = `Failed to parse queue response: ${stdout}`
          log(`[Prefect] ❌ ${errorMsg}`)
          reject(new Error(errorMsg))
        }
      } else {
        const error = stderr || stdout || 'Unknown error'
        const errorMsg = `Failed to queue flow (exit ${code}): ${error}`
        log(`[Prefect] ❌ ${errorMsg}`)
        reject(new Error(errorMsg))
      }
    })

    cmd.on('error', error => {
      const errorMsg = `Failed to spawn queue command: ${error.message}`
      log(`[Prefect] ❌ ${errorMsg}`)
      reject(new Error(errorMsg))
    })
  })
}

/**
 * Queue full frames processing (background job after upload)
 *
 * Replaces: queueVideoProcessing() from video-processing.ts
 */
export async function queueFullFramesProcessing(options: {
  videoId: string
  videoPath: string
  dbPath: string
  outputDir: string
  frameRate?: number
}): Promise<QueueFlowResult> {
  log(`[Prefect] Queuing full frames processing for ${options.videoId}`)

  const result = await queueFlow('full-frames', {
    ...options,
    frameRate: options.frameRate ?? 0.1,
  })

  log(`[Prefect] Full frames flow queued: ${result.flowRunId} (status: ${result.status})`)
  return result
}

/**
 * Queue crop frames processing (user-initiated after layout approval)
 *
 * Replaces: queueCropFramesProcessing() from crop-frames-processing.ts
 */
export async function queueCropFramesProcessing(options: {
  videoId: string
  videoPath: string
  dbPath: string
  outputDir: string
  cropBounds: {
    left: number
    top: number
    right: number
    bottom: number
  }
  cropBoundsVersion?: number
}): Promise<QueueFlowResult> {
  log(`[Prefect] Queuing crop frames processing for ${options.videoId}`)

  const result = await queueFlow('crop-frames', {
    ...options,
    cropBoundsVersion: options.cropBoundsVersion ?? 1,
  })

  log(`[Prefect] Crop frames flow queued: ${result.flowRunId} (status: ${result.status})`)
  return result
}
