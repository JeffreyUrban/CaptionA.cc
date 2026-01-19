/**
 * API functions for the Layout annotation workflow.
 * Now uses CR-SQLite instead of REST API.
 *
 * NOTE: These functions require the layout database to be initialized first
 * via useLayoutDatabase hook. They delegate to the LayoutSyncService.
 */

import type { FrameInfo, LayoutQueueResponse, FrameBoxesData } from '~/types/layout'

/**
 * Fetch layout queue data from CR-SQLite database
 *
 * NOTE: Requires layout database to be initialized via useLayoutDatabase
 */
export async function fetchLayoutQueue(videoId: string): Promise<LayoutQueueResponse> {
  const { getLayoutSyncService } = await import('~/services/layout-sync-service')
  const service = getLayoutSyncService(videoId, videoId)

  if (!service.isReady) {
    throw new Error('Layout database not ready. Initialize with useLayoutDatabase first.')
  }

  return service.fetchLayoutQueue()
}

/**
 * Fetch analysis boxes for all frames
 *
 * NOTE: This now uses CR-SQLite instead of REST API.
 * The layout database should already be initialized via useLayoutDatabase.
 */
export async function fetchAnalysisBoxes(
  videoId: string
): Promise<{ boxes: import('~/types/layout').BoxData[] }> {
  // Get the layout sync service (should already be initialized)
  const { getLayoutSyncService } = await import('~/services/layout-sync-service')
  const service = getLayoutSyncService(videoId, videoId) // tenant ID defaults to video ID

  if (!service.isReady) {
    throw new Error('Layout database not ready. Initialize with useLayoutDatabase first.')
  }

  return service.fetchAnalysisBoxes()
}

/**
 * Fetch boxes for a specific frame from CR-SQLite
 */
export async function fetchFrameBoxes(
  videoId: string,
  frameIndex: number
): Promise<FrameBoxesData> {
  const { getLayoutSyncService } = await import('~/services/layout-sync-service')
  const service = getLayoutSyncService(videoId, videoId)

  if (!service.isReady) {
    throw new Error('Layout database not ready. Initialize with useLayoutDatabase first.')
  }

  return service.fetchFrameBoxes(frameIndex)
}

/**
 * Save box annotations for a frame to CR-SQLite
 */
export async function saveBoxAnnotations(
  videoId: string,
  frameIndex: number,
  annotations: Array<{ boxIndex: number; label: 'in' | 'out' }>
): Promise<void> {
  const { getLayoutSyncService } = await import('~/services/layout-sync-service')
  const service = getLayoutSyncService(videoId, videoId)

  if (!service.isReady) {
    throw new Error('Layout database not ready. Initialize with useLayoutDatabase first.')
  }

  return service.saveBoxAnnotations(frameIndex, annotations)
}

/**
 * Recalculate predictions (server-side operation via API)
 */
export async function recalculatePredictions(videoId: string): Promise<void> {
  const { getLayoutSyncService } = await import('~/services/layout-sync-service')
  const service = getLayoutSyncService(videoId, videoId)

  if (!service.isReady) {
    throw new Error('Layout database not ready. Initialize with useLayoutDatabase first.')
  }

  return service.recalculatePredictions()
}

/**
 * Reset crop bounds based on current annotations (server-side operation)
 */
export async function resetCropBounds(
  videoId: string
): Promise<{ success: boolean; message?: string }> {
  const { getLayoutSyncService } = await import('~/services/layout-sync-service')
  const service = getLayoutSyncService(videoId, videoId)

  if (!service.isReady) {
    throw new Error('Layout database not ready. Initialize with useLayoutDatabase first.')
  }

  return service.resetCropRegion()
}

/**
 * Clear all annotations for a video
 */
export async function clearAllAnnotations(videoId: string): Promise<{ deletedCount: number }> {
  const { getLayoutSyncService } = await import('~/services/layout-sync-service')
  const service = getLayoutSyncService(videoId, videoId)

  if (!service.isReady) {
    throw new Error('Layout database not ready. Initialize with useLayoutDatabase first.')
  }

  return service.clearAllAnnotations()
}

/**
 * Bulk annotate boxes across all frames
 */
export async function bulkAnnotateAll(
  videoId: string,
  rectangle: { left: number; top: number; right: number; bottom: number },
  action: 'clear' | 'mark_out'
): Promise<{ newlyAnnotatedBoxes?: number; error?: string }> {
  const { getLayoutSyncService } = await import('~/services/layout-sync-service')
  const service = getLayoutSyncService(videoId, videoId)

  if (!service.isReady) {
    throw new Error('Layout database not ready. Initialize with useLayoutDatabase first.')
  }

  return service.bulkAnnotateAll(rectangle, action)
}

/**
 * Run Bayesian layout analysis on OCR boxes
 *
 * Calls API server to analyze OCR box positions and calculate
 * layout parameters (vertical position, anchor type, etc.)
 */
export async function analyzeLayout(videoId: string): Promise<{
  success: boolean
  boxesAnalyzed: number
  processingTimeMs: number
}> {
  const { API_CONFIG } = await import('~/config')
  const { supabase } = await import('~/services/supabase-client')

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('User not authenticated')
  }

  const response = await fetch(
    `${API_CONFIG.PYTHON_API_URL}/videos/${videoId}/actions/analyze-layout`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(error.detail || `HTTP ${response.status}`)
  }

  return response.json()
}

/**
 * Calculate predictions for all OCR boxes
 *
 * Calls API server to run Bayesian prediction on all boxes.
 * This should be called before layout annotation is available to populate
 * predicted_label and predicted_confidence for all boxes.
 */
export async function calculatePredictions(videoId: string): Promise<{
  success: boolean
  predictionsGenerated: number
  modelVersion: string
}> {
  const { API_CONFIG } = await import('~/config')
  const { supabase } = await import('~/services/supabase-client')

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('User not authenticated')
  }

  const response = await fetch(
    `${API_CONFIG.PYTHON_API_URL}/videos/${videoId}/actions/calculate-predictions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(error.detail || `HTTP ${response.status}`)
  }

  return response.json()
}

/**
 * Prefetch frame boxes for multiple frames
 */
export async function prefetchFrameBoxes(
  videoId: string,
  frames: FrameInfo[],
  cache: Map<number, FrameBoxesData>
): Promise<void> {
  console.log(`[Prefetch] Starting prefetch for ${frames.length} frames`)

  const prefetchPromises = frames.map(async frame => {
    if (cache.has(frame.frameIndex)) {
      return
    }

    try {
      console.log(`[Prefetch] Fetching frame ${frame.frameIndex}`)
      const data = await fetchFrameBoxes(videoId, frame.frameIndex)
      cache.set(frame.frameIndex, data)
      console.log(`[Prefetch] Cached frame ${frame.frameIndex}`)
    } catch (err) {
      console.warn(`[Prefetch] Failed to prefetch frame ${frame.frameIndex}:`, err)
    }
  })

  await Promise.all(prefetchPromises)
  console.log(`[Prefetch] Completed`)
}
