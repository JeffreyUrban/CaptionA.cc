/**
 * In-memory tracker for background processing operations.
 *
 * Tracks when server-side prediction calculation is in progress
 * to provide status indicators in the UI.
 */

interface ProcessingStatus {
  /** When the operation started */
  startedAt: Date
  /** Estimated completion time (for UI progress indication) */
  estimatedCompletionAt: Date
  /** Optional progress message */
  message?: string
}

/**
 * Global in-memory processing status by video ID.
 * Key: videoId, Value: current processing status
 */
const processingStatus = new Map<string, ProcessingStatus>()

/**
 * Start tracking a model training/prediction calculation operation.
 *
 * @param videoId - Video identifier
 */
export function startFullRetrain(videoId: string): void {
  const now = new Date()
  const estimatedDuration = 15000 // 15 seconds typical duration

  processingStatus.set(videoId, {
    startedAt: now,
    estimatedCompletionAt: new Date(now.getTime() + estimatedDuration),
    message: 'Calculating predictions...',
  })

  console.log(`[ProcessingStatus] Started processing for ${videoId}`)
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
    console.log(`[ProcessingStatus] Completed processing for ${videoId} in ${duration}ms`)
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
