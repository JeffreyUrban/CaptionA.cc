/**
 * Processing Coordinator
 *
 * Coordinates concurrency between different processing pipelines:
 * - full_frames (background video upload processing)
 * - crop_frames (user-initiated frame cropping after layout approval)
 *
 * Ensures total system resource usage stays within limits and prevents crashes
 * from too many concurrent video processing jobs.
 */

import { MAX_TOTAL_CONCURRENT_PROCESSING } from '~/config/processing'

// Current number of active processing jobs
let activeTotalProcessing = 0

// Callbacks to try processing next job in each queue
// Priority order: crop_frames (user-initiated) first, then full_frames (background)
const queueProcessors: Array<() => void> = []

/**
 * Register a queue processor that will be called when capacity becomes available
 * Processors are called in registration order (register crop_frames first for priority)
 */
export function registerQueueProcessor(processor: () => void): void {
  queueProcessors.push(processor)
}

/**
 * Try to start a new processing job
 * Returns true if capacity is available, false if at limit
 */
export function tryStartProcessing(): boolean {
  if (activeTotalProcessing >= MAX_TOTAL_CONCURRENT_PROCESSING) {
    return false
  }

  activeTotalProcessing++
  console.log(`[ProcessingCoordinator] Job started (${activeTotalProcessing}/${MAX_TOTAL_CONCURRENT_PROCESSING} active)`)
  return true
}

/**
 * Mark a processing job as finished
 * Triggers next job in queue (if any) with priority order
 */
export function finishProcessing(): void {
  if (activeTotalProcessing > 0) {
    activeTotalProcessing--
  }

  console.log(`[ProcessingCoordinator] Job finished (${activeTotalProcessing}/${MAX_TOTAL_CONCURRENT_PROCESSING} active)`)

  // Try to start next job in priority order
  processNext()
}

/**
 * Try to process next job from any queue in priority order
 */
export function processNext(): void {
  if (activeTotalProcessing >= MAX_TOTAL_CONCURRENT_PROCESSING) {
    return
  }

  // Call each queue processor in priority order until one starts a job
  for (const processor of queueProcessors) {
    processor()

    // If processor started a job, we're done (check counter increased)
    if (activeTotalProcessing >= MAX_TOTAL_CONCURRENT_PROCESSING) {
      break
    }
  }
}

/**
 * Get current processing stats for debugging
 */
export function getProcessingStats() {
  return {
    active: activeTotalProcessing,
    capacity: MAX_TOTAL_CONCURRENT_PROCESSING,
    available: MAX_TOTAL_CONCURRENT_PROCESSING - activeTotalProcessing
  }
}
