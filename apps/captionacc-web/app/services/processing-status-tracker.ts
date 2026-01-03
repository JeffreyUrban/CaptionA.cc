/**
 * In-memory tracker for background processing operations.
 *
 * Tracks streaming updates and full retrains to provide status
 * indicators in the UI without blocking annotation workflow.
 */

interface ProcessingStatus {
  /** Type of processing operation */
  type: 'streaming_update' | 'full_retrain'
  /** When the operation started */
  startedAt: Date
  /** Estimated completion time (for UI progress indication) */
  estimatedCompletionAt: Date
  /** Optional progress information */
  progress?: {
    processed?: number
    total?: number
    message?: string
  }
}

/**
 * Global in-memory processing status by video ID.
 * Key: videoId, Value: current processing status
 */
const processingStatus = new Map<string, ProcessingStatus>()

/**
 * Start tracking a streaming update operation.
 *
 * @param videoId - Video identifier
 */
export function startStreamingUpdate(videoId: string): void {
  const now = new Date()
  const estimatedDuration = 2000 // 2 seconds typical duration

  processingStatus.set(videoId, {
    type: 'streaming_update',
    startedAt: now,
    estimatedCompletionAt: new Date(now.getTime() + estimatedDuration),
    progress: {
      message: 'Updating predictions...',
    },
  })

  console.log(`[ProcessingStatus] Started streaming update for ${videoId}`)
}

/**
 * Start tracking a full retrain operation.
 *
 * @param videoId - Video identifier
 */
export function startFullRetrain(videoId: string): void {
  const now = new Date()
  const estimatedDuration = 15000 // 15 seconds typical duration

  processingStatus.set(videoId, {
    type: 'full_retrain',
    startedAt: now,
    estimatedCompletionAt: new Date(now.getTime() + estimatedDuration),
    progress: {
      message: 'Retraining model...',
    },
  })

  console.log(`[ProcessingStatus] Started full retrain for ${videoId}`)
}

/**
 * Update progress information for an ongoing operation.
 *
 * @param videoId - Video identifier
 * @param progress - Progress information
 */
export function updateProgress(
  videoId: string,
  progress: { processed?: number; total?: number; message?: string }
): void {
  const status = processingStatus.get(videoId)
  if (status) {
    status.progress = { ...status.progress, ...progress }
    console.log(`[ProcessingStatus] Updated progress for ${videoId}:`, progress)
  }
}

/**
 * Mark a processing operation as complete.
 *
 * @param videoId - Video identifier
 */
export function completeProcessing(videoId: string): void {
  const status = processingStatus.get(videoId)
  if (status) {
    const duration = Date.now() - status.startedAt.getTime()
    console.log(`[ProcessingStatus] Completed ${status.type} for ${videoId} in ${duration}ms`)
    processingStatus.delete(videoId)
  }
}

/**
 * Get current processing status for a video.
 *
 * @param videoId - Video identifier
 * @returns Current processing status, or null if not processing
 */
export function getProcessingStatus(videoId: string): ProcessingStatus | null {
  const status = processingStatus.get(videoId)
  if (!status) {
    return null
  }

  // Auto-cleanup stale entries (processing took longer than 5 minutes)
  const age = Date.now() - status.startedAt.getTime()
  const maxAge = 5 * 60 * 1000 // 5 minutes

  if (age > maxAge) {
    console.warn(`[ProcessingStatus] Stale entry for ${videoId} (${age}ms old), cleaning up`)
    processingStatus.delete(videoId)
    return null
  }

  return status
}

/**
 * Check if a video is currently being processed.
 *
 * @param videoId - Video identifier
 * @returns True if processing is in progress
 */
export function isProcessing(videoId: string): boolean {
  return getProcessingStatus(videoId) !== null
}

/**
 * Get all videos currently being processed.
 *
 * @returns Array of video IDs with active processing
 */
export function getActiveProcessing(): Array<{ videoId: string; status: ProcessingStatus }> {
  const active: Array<{ videoId: string; status: ProcessingStatus }> = []

  for (const [videoId, status] of processingStatus.entries()) {
    // Check for stale entries
    const age = Date.now() - status.startedAt.getTime()
    const maxAge = 5 * 60 * 1000

    if (age <= maxAge) {
      active.push({ videoId, status })
    } else {
      // Cleanup stale entry
      processingStatus.delete(videoId)
    }
  }

  return active
}
