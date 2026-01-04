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
  videoId?: string
  videoPath?: string
  dbPath?: string
  outputDir?: string
  videoDir?: string
  dataDir?: string
  frameRate?: number
  cropBounds?: {
    left: number
    top: number
    right: number
    bottom: number
  }
  cropBoundsVersion?: number
  captionIds?: number[]
  language?: string
  trainingSource?: string
  retrainVideos?: boolean
  updatePredictions?: boolean
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
  flowType:
    | 'full-frames'
    | 'crop-frames'
    | 'caption-median-ocr'
    | 'update-base-model'
    | 'retrain-video-model',
  options: QueueFlowOptions
): Promise<QueueFlowResult> {
  return new Promise((resolve, reject) => {
    let args: string[] = []

    if (flowType === 'caption-median-ocr') {
      // caption-median-ocr has different argument structure
      if (!options.videoDir) {
        reject(new Error('videoDir required for caption-median-ocr flow'))
        return
      }
      if (!options.captionIds || options.captionIds.length === 0) {
        reject(new Error('captionIds required for caption-median-ocr flow'))
        return
      }
      args = [
        flowType,
        options.videoId!,
        options.dbPath!,
        options.videoDir!,
        JSON.stringify(options.captionIds!),
      ]
      if (options.language) {
        args.push(options.language)
      }
    } else if (flowType === 'update-base-model') {
      // update-base-model has different argument structure
      if (!options.dataDir) {
        reject(new Error('dataDir required for update-base-model flow'))
        return
      }
      args = [flowType, options.dataDir]
      if (options.trainingSource) {
        args.push(options.trainingSource)
      }
      if (options.retrainVideos !== undefined) {
        args.push(options.retrainVideos.toString())
      }
    } else if (flowType === 'retrain-video-model') {
      // retrain-video-model has different argument structure
      if (!options.videoId || !options.dbPath) {
        reject(new Error('videoId and dbPath required for retrain-video-model flow'))
        return
      }
      args = [flowType, options.videoId, options.dbPath]
      if (options.updatePredictions !== undefined) {
        args.push(options.updatePredictions.toString())
      }
    } else {
      // full-frames and crop-frames have the original structure
      if (!options.videoPath || !options.outputDir || !options.videoId || !options.dbPath) {
        reject(new Error('videoId, videoPath, dbPath, and outputDir required for this flow type'))
        return
      }
      args = [flowType, options.videoId, options.videoPath, options.dbPath, options.outputDir]

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

/**
 * Queue caption median OCR processing (user-initiated after boundary changes)
 *
 * Replaces: synchronous OCR in api.annotations.$videoId.$id.text.tsx
 */
export async function queueCaptionMedianOcrProcessing(options: {
  videoId: string
  dbPath: string
  videoDir: string
  captionIds: number[]
  language?: string
}): Promise<QueueFlowResult> {
  log(
    `[Prefect] Queuing caption median OCR for ${options.videoId}, captions: ${options.captionIds.join(', ')}`
  )

  const result = await queueFlow('caption-median-ocr', {
    ...options,
    language: options.language ?? 'zh-Hans',
  })

  log(`[Prefect] Caption median OCR flow queued: ${result.flowRunId} (status: ${result.status})`)
  return result
}

/**
 * Queue base model update (admin/maintenance task)
 *
 * Updates global base model and optionally retrains all video models.
 * This is a manual or scheduled task for model maintenance.
 */
export async function queueBaseModelUpdate(options: {
  dataDir: string
  trainingSource?: string
  retrainVideos?: boolean
}): Promise<QueueFlowResult> {
  log(`[Prefect] Queuing base model update from: ${options.dataDir}`)

  const result = await queueFlow('update-base-model', {
    ...options,
    trainingSource: options.trainingSource ?? 'all_videos',
    retrainVideos: options.retrainVideos ?? true,
  })

  log(`[Prefect] Base model update flow queued: ${result.flowRunId} (status: ${result.status})`)
  return result
}

/**
 * Queue video model retrain (user-initiated or batch)
 *
 * Retrains a single video's model with current base model + video's labels.
 * Can be triggered manually from UI or as part of base model update batch.
 */
export async function queueVideoModelRetrain(options: {
  videoId: string
  dbPath: string
  updatePredictions?: boolean
}): Promise<QueueFlowResult> {
  log(`[Prefect] Queuing video model retrain for: ${options.videoId}`)

  const result = await queueFlow('retrain-video-model', {
    ...options,
    updatePredictions: options.updatePredictions ?? true,
  })

  log(`[Prefect] Video model retrain flow queued: ${result.flowRunId} (status: ${result.status})`)
  return result
}
