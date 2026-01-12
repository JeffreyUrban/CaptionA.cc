/**
 * Prefect Flow Queue Client
 *
 * Queues video processing workflows to Prefect orchestrator via REST API.
 * Direct HTTP calls to Prefect server - no subprocess spawning needed.
 */

const PREFECT_API_URL = process.env['PREFECT_API_URL'] || 'https://prefect-service.fly.dev/api'

function log(message: string) {
  const timestamp = new Date().toISOString()
  console.log(`${timestamp} ${message}`)
}

interface QueueFlowOptions {
  videoId?: string
  videoPath?: string
  virtualPath?: string
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
  filename?: string
  fileSize?: number
  tenantId?: string
  uploadedByUserId?: string
  triggerCropRegen?: boolean
}

interface QueueFlowResult {
  flowRunId: string
  status: string
  priority: string
}

/**
 * Deployment name mapping for flow types
 */
const DEPLOYMENT_NAMES: Record<string, string> = {
  'full-frames': 'process-video-initial/production',
  'crop-frames': 'crop-video-frames/production',
  caption_ocr: 'process-caption_ocr/production',
  'update-base-model': 'update-base-model-globally/production',
  'retrain-video-model': 'retrain-video-model/production',
  'upload-and-process': 'upload-and-process-video/production',
  'crop-frames-to-webm': 'crop-frames-to-webm/production',
  'download-for-layout-annotation': 'download-for-layout-annotation/production',
  'upload-layout-db': 'upload-layout-db/production',
  'download-for-caption-annotation': 'download-for-caption-annotation/production',
  'upload-captions-db': 'upload-captions-db/production',
}

/**
 * Queue a Prefect flow via REST API
 *
 * Makes a direct HTTP call to the Prefect server to create a flow run.
 */
async function queueFlow(
  flowType:
    | 'full-frames'
    | 'crop-frames'
    | 'caption_ocr'
    | 'update-base-model'
    | 'retrain-video-model'
    | 'upload-and-process'
    | 'crop-frames-to-webm'
    | 'download-for-layout-annotation'
    | 'upload-layout-db'
    | 'download-for-caption-annotation'
    | 'upload-captions-db',
  options: QueueFlowOptions
): Promise<QueueFlowResult> {
  // Build parameters based on flow type
  let parameters: Record<string, unknown> = {}
  let tags: string[] = []

  if (flowType === 'caption_ocr') {
    if (!options.videoDir || !options.captionIds || options.captionIds.length === 0) {
      throw new Error('videoDir and captionIds required for caption_ocr flow')
    }
    parameters = {
      video_id: options.videoId!,
      db_path: options.dbPath!,
      video_dir: options.videoDir!,
      caption_ids: options.captionIds!,
      language: options.language ?? 'zh-Hans',
    }
    tags = ['user-initiated', 'high-priority']
  } else if (flowType === 'update-base-model') {
    if (!options.dataDir) {
      throw new Error('dataDir required for update-base-model flow')
    }
    parameters = {
      data_dir: options.dataDir,
      training_source: options.trainingSource ?? 'all_videos',
      retrain_videos: options.retrainVideos ?? true,
    }
    tags = ['admin', 'base-model', 'low-priority']
  } else if (flowType === 'retrain-video-model') {
    if (!options.videoId || !options.dbPath) {
      throw new Error('videoId and dbPath required for retrain-video-model flow')
    }
    parameters = {
      video_id: options.videoId,
      db_path: options.dbPath,
      update_predictions: options.updatePredictions ?? true,
    }
    tags = ['model-retrain', 'medium-priority']
  } else if (flowType === 'upload-and-process') {
    if (!options.videoPath || !options.videoId || !options.filename || !options.fileSize) {
      throw new Error(
        'videoPath, videoId, filename, and fileSize required for upload-and-process flow'
      )
    }
    parameters = {
      local_video_path: options.videoPath,
      virtual_path: options.virtualPath,
      video_id: options.videoId,
      filename: options.filename,
      file_size: options.fileSize,
      tenant_id: options.tenantId ?? '00000000-0000-0000-0000-000000000001',
      frame_rate: options.frameRate ?? 0.1,
    }
    if (options.uploadedByUserId) {
      parameters['uploaded_by_user_id'] = options.uploadedByUserId
    }
    tags = ['upload', 'processing', 'high-priority']
  } else if (flowType === 'crop-frames-to-webm') {
    if (!options.videoId || !options.cropBounds) {
      throw new Error('videoId and cropBounds required for crop-frames-to-webm flow')
    }
    parameters = {
      video_id: options.videoId,
      tenant_id: options.tenantId ?? '00000000-0000-0000-0000-000000000001',
      crop_bounds: options.cropBounds,
      frame_rate: options.frameRate ?? 10.0,
    }
    if (options.filename) {
      parameters['filename'] = options.filename
    }
    if (options.uploadedByUserId) {
      parameters['created_by_user_id'] = options.uploadedByUserId
    }
    tags = ['crop-frames', 'webm', 'user-initiated', 'high-priority']
  } else if (flowType === 'download-for-layout-annotation') {
    if (!options.videoId || !options.outputDir) {
      throw new Error('videoId and outputDir required for download-for-layout-annotation flow')
    }
    parameters = {
      video_id: options.videoId,
      output_dir: options.outputDir,
      tenant_id: options.tenantId ?? '00000000-0000-0000-0000-000000000001',
    }
    tags = ['download', 'layout-annotation', 'user-initiated']
  } else if (flowType === 'upload-layout-db') {
    if (!options.videoId || !options.dbPath) {
      throw new Error('videoId and dbPath required for upload-layout-db flow')
    }
    parameters = {
      video_id: options.videoId,
      layout_db_path: options.dbPath,
      tenant_id: options.tenantId ?? '00000000-0000-0000-0000-000000000001',
      trigger_crop_regen: options.triggerCropRegen ?? true,
    }
    tags = ['upload', 'layout-annotation', 'user-initiated', 'high-priority']
  } else if (flowType === 'download-for-caption-annotation') {
    if (!options.videoId || !options.outputDir) {
      throw new Error('videoId and outputDir required for download-for-caption-annotation flow')
    }
    parameters = {
      video_id: options.videoId,
      output_dir: options.outputDir,
      tenant_id: options.tenantId ?? '00000000-0000-0000-0000-000000000001',
    }
    tags = ['download', 'caption-annotation', 'user-initiated']
  } else if (flowType === 'upload-captions-db') {
    if (!options.videoId || !options.dbPath) {
      throw new Error('videoId and dbPath required for upload-captions-db flow')
    }
    parameters = {
      video_id: options.videoId,
      captions_db_path: options.dbPath,
      tenant_id: options.tenantId ?? '00000000-0000-0000-0000-000000000001',
    }
    tags = ['upload', 'caption-annotation', 'user-initiated', 'high-priority']
  } else if (flowType === 'full-frames') {
    if (!options.videoPath || !options.outputDir || !options.videoId || !options.dbPath) {
      throw new Error('videoId, videoPath, dbPath, and outputDir required for full-frames flow')
    }
    parameters = {
      video_id: options.videoId,
      video_path: options.videoPath,
      db_path: options.dbPath,
      output_dir: options.outputDir,
      frame_rate: options.frameRate ?? 0.1,
    }
    tags = ['background', 'full-frames']
  } else if (flowType === 'crop-frames') {
    if (
      !options.videoPath ||
      !options.outputDir ||
      !options.videoId ||
      !options.dbPath ||
      !options.cropBounds
    ) {
      throw new Error(
        'videoId, videoPath, dbPath, outputDir, and cropBounds required for crop-frames flow'
      )
    }
    parameters = {
      video_id: options.videoId,
      video_path: options.videoPath,
      db_path: options.dbPath,
      output_dir: options.outputDir,
      crop_bounds: options.cropBounds,
      crop_bounds_version: options.cropBoundsVersion ?? 1,
      frame_rate: 10.0,
    }
    tags = ['user-initiated', 'crop-frames']
  }

  // Get deployment name
  const deploymentName = DEPLOYMENT_NAMES[flowType]
  if (!deploymentName) {
    throw new Error(`Unknown flow type: ${flowType}`)
  }

  // Step 1: Get deployment metadata to get flow_id and deployment_id
  log(`[Prefect] Getting deployment metadata for ${deploymentName}`)
  const deploymentUrl = `${PREFECT_API_URL}/deployments/name/${deploymentName}`
  const deploymentResponse = await fetch(deploymentUrl)

  if (!deploymentResponse.ok) {
    const error = await deploymentResponse.text()
    throw new Error(`Failed to get deployment: ${deploymentResponse.status} ${error}`)
  }

  const deployment = await deploymentResponse.json()

  // Step 2: Create flow run
  log(`[Prefect] Creating flow run for ${deploymentName}`)
  const flowRunUrl = `${PREFECT_API_URL}/flow_runs/`

  const response = await fetch(flowRunUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      deployment_id: deployment.id,
      flow_id: deployment.flow_id,
      parameters,
      tags,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to queue flow: ${response.status} ${error}`)
  }

  const flowRun = await response.json()

  const result: QueueFlowResult = {
    flowRunId: flowRun.id,
    status: 'queued',
    priority: tags.includes('high-priority')
      ? 'high'
      : tags.includes('medium-priority')
        ? 'medium'
        : 'low',
  }

  log(`[Prefect] ✅ Flow queued successfully: ${result.flowRunId}`)
  return result
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
export async function queueCaptionOcrProcessing(options: {
  videoId: string
  dbPath: string
  videoDir: string
  captionIds: number[]
  language?: string
}): Promise<QueueFlowResult> {
  log(
    `[Prefect] Queuing caption median OCR for ${options.videoId}, captions: ${options.captionIds.join(', ')}`
  )

  const result = await queueFlow('caption_ocr', {
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

/**
 * Queue upload and processing flow (Wasabi-based workflow with split databases)
 *
 * Handles complete video upload pipeline:
 * - Upload video to Wasabi
 * - Extract full frames → video.db → upload to Wasabi
 * - Run OCR → fullOCR.db → upload to Wasabi
 * - Create Supabase catalog entry
 * - Index OCR content for search
 *
 * Later workflows (user-initiated):
 * - Layout annotation → layout.db
 * - Crop frames → WebM chunks
 * - Caption annotation → captions.db
 */
export async function queueUploadAndProcessing(options: {
  videoPath: string
  virtualPath?: string
  videoId: string
  filename: string
  fileSize: number
  tenantId?: string
  frameRate?: number
  uploadedByUserId?: string
}): Promise<QueueFlowResult> {
  log(`[Prefect] Queuing upload and processing for ${options.videoId}`)

  const result = await queueFlow('upload-and-process', {
    ...options,
    frameRate: options.frameRate ?? 0.1,
  })

  log(`[Prefect] Upload and processing flow queued: ${result.flowRunId} (status: ${result.status})`)
  return result
}

/**
 * Queue cropped frames WebM chunking flow (versioned frameset generation)
 *
 * Generates versioned cropped frames as VP9/WebM chunks:
 * - Download video and layout.db from Wasabi
 * - Extract cropped frames at 10Hz
 * - Encode frames as VP9/WebM chunks
 * - Upload chunks to Wasabi with version number
 * - Activate new version (archives previous version)
 *
 * The app always uses the latest "active" version for annotation workflows.
 * Previous versions are archived but retained for ML training reproducibility.
 */
export async function queueCropFramesToWebm(options: {
  videoId: string
  cropBounds: {
    left: number
    top: number
    right: number
    bottom: number
  }
  tenantId?: string
  filename?: string
  frameRate?: number
  createdByUserId?: string
}): Promise<QueueFlowResult> {
  log(`[Prefect] Queuing cropped frames WebM chunking for ${options.videoId}`)

  const result = await queueFlow('crop-frames-to-webm', {
    videoId: options.videoId,
    cropBounds: options.cropBounds,
    tenantId: options.tenantId,
    filename: options.filename,
    frameRate: options.frameRate ?? 10.0,
    uploadedByUserId: options.createdByUserId,
  })

  log(`[Prefect] Crop frames to WebM flow queued: ${result.flowRunId} (status: ${result.status})`)
  return result
}

/**
 * Queue download of files needed for layout annotation
 *
 * Downloads from Wasabi:
 * - video.db (full frames for annotation UI)
 * - fullOCR.db (OCR results for suggested regions)
 * - layout.db (if exists - to continue previous annotations)
 */
export async function queueDownloadForLayoutAnnotation(options: {
  videoId: string
  outputDir: string
  tenantId?: string
}): Promise<QueueFlowResult> {
  log(`[Prefect] Queuing download for layout annotation: ${options.videoId}`)

  const result = await queueFlow('download-for-layout-annotation', {
    videoId: options.videoId,
    outputDir: options.outputDir,
    tenantId: options.tenantId,
  })

  log(
    `[Prefect] Download for layout annotation flow queued: ${result.flowRunId} (status: ${result.status})`
  )
  return result
}

/**
 * Queue upload of annotated layout.db to Wasabi
 *
 * Uploads layout.db and optionally triggers cropped frames regeneration
 * if crop bounds have changed.
 */
export async function queueUploadLayoutDb(options: {
  videoId: string
  layoutDbPath: string
  tenantId?: string
  triggerCropRegen?: boolean
}): Promise<QueueFlowResult> {
  log(`[Prefect] Queuing upload of layout.db for ${options.videoId}`)

  const result = await queueFlow('upload-layout-db', {
    videoId: options.videoId,
    dbPath: options.layoutDbPath,
    tenantId: options.tenantId,
    triggerCropRegen: options.triggerCropRegen,
  })

  log(`[Prefect] Upload layout.db flow queued: ${result.flowRunId} (status: ${result.status})`)
  return result
}

/**
 * Queue download of captions.db for caption annotation
 */
export async function queueDownloadForCaptionAnnotation(options: {
  videoId: string
  outputDir: string
  tenantId?: string
}): Promise<QueueFlowResult> {
  log(`[Prefect] Queuing download for caption annotation: ${options.videoId}`)

  const result = await queueFlow('download-for-caption-annotation', {
    videoId: options.videoId,
    outputDir: options.outputDir,
    tenantId: options.tenantId,
  })

  log(
    `[Prefect] Download for caption annotation flow queued: ${result.flowRunId} (status: ${result.status})`
  )
  return result
}

/**
 * Queue upload of annotated captions.db to Wasabi
 */
export async function queueUploadCaptionsDb(options: {
  videoId: string
  captionsDbPath: string
  tenantId?: string
}): Promise<QueueFlowResult> {
  log(`[Prefect] Queuing upload of captions.db for ${options.videoId}`)

  const result = await queueFlow('upload-captions-db', {
    videoId: options.videoId,
    dbPath: options.captionsDbPath,
    tenantId: options.tenantId,
  })

  log(`[Prefect] Upload captions.db flow queued: ${result.flowRunId} (status: ${result.status})`)
  return result
}
