/**
 * API functions for the Layout annotation workflow.
 * Handles server communication for layout data and annotations.
 */

import type { FrameInfo, LayoutQueueResponse, FrameBoxesData } from '~/types/layout'

/**
 * Fetch layout queue data from the server
 */
export async function fetchLayoutQueue(videoId: string): Promise<LayoutQueueResponse> {
  const response = await fetch(`/api/annotations/${encodeURIComponent(videoId)}/layout-queue`)

  if (!response.ok) {
    const errorData = await response.json()
    if (response.status === 425 && errorData.processingStatus) {
      throw new Error(`Processing: ${errorData.processingStatus}`)
    }
    throw new Error(errorData.error ?? 'Failed to load layout queue')
  }

  return response.json()
}

/**
 * Fetch analysis boxes for all frames
 */
export async function fetchAnalysisBoxes(
  videoId: string
): Promise<{ boxes: import('~/types/layout').BoxData[] }> {
  const response = await fetch(
    `/api/annotations/${encodeURIComponent(videoId)}/layout-analysis-boxes`
  )
  if (!response.ok) {
    const errorText = await response.text()
    console.error('Failed to load analysis boxes:', response.status, errorText)
    throw new Error('Failed to load analysis boxes')
  }
  return response.json()
}

/**
 * Fetch boxes for a specific frame
 */
export async function fetchFrameBoxes(
  videoId: string,
  frameIndex: number
): Promise<FrameBoxesData> {
  const response = await fetch(
    `/api/annotations/${encodeURIComponent(videoId)}/frames/${frameIndex}/boxes`
  )
  if (!response.ok) throw new Error('Failed to load frame boxes')
  return response.json()
}

/**
 * Save box annotations for a frame
 */
export async function saveBoxAnnotations(
  videoId: string,
  frameIndex: number,
  annotations: Array<{ boxIndex: number; label: 'in' | 'out' }>
): Promise<void> {
  const response = await fetch(
    `/api/annotations/${encodeURIComponent(videoId)}/frames/${frameIndex}/boxes`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotations }),
    }
  )
  if (!response.ok) {
    throw new Error('Failed to save annotation')
  }
}

/**
 * Recalculate predictions for the video
 */
export async function recalculatePredictions(videoId: string): Promise<void> {
  const response = await fetch(
    `/api/annotations/${encodeURIComponent(videoId)}/calculate-predictions`,
    { method: 'POST' }
  )
  if (response.ok) {
    const result = await response.json()
    console.log('[Layout] Predictions updated:', result)
  } else {
    console.warn('[Layout] Failed to update predictions, continuing anyway')
  }
}

/**
 * Reset crop bounds based on current annotations
 */
export async function resetCropBounds(
  videoId: string
): Promise<{ success: boolean; message?: string }> {
  const response = await fetch(
    `/api/annotations/${encodeURIComponent(videoId)}/reset-crop-bounds`,
    { method: 'POST' }
  )

  const result = await response.json()

  if (!response.ok) {
    return {
      success: false,
      message: result.message ?? result.error ?? 'Failed to recalculate crop bounds',
    }
  }

  console.log('[Layout] Crop bounds recalculated:', result)
  return { success: true }
}

/**
 * Clear all annotations for a video
 */
export async function clearAllAnnotations(videoId: string): Promise<{ deletedCount: number }> {
  const response = await fetch(`/api/annotations/${encodeURIComponent(videoId)}/clear-all`, {
    method: 'POST',
  })
  if (!response.ok) throw new Error('Failed to clear annotations')
  return response.json()
}

/**
 * Bulk annotate boxes across all frames
 */
export async function bulkAnnotateAll(
  videoId: string,
  rectangle: { left: number; top: number; right: number; bottom: number },
  action: 'clear' | 'mark_out'
): Promise<{ newlyAnnotatedBoxes?: number; error?: string }> {
  const response = await fetch(
    `/api/annotations/${encodeURIComponent(videoId)}/bulk-annotate-all`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rectangle, action }),
    }
  )

  const result = await response.json()

  if (!response.ok || result.error) {
    console.error('Bulk annotate all failed:', result.error ?? `HTTP ${response.status}`)
    throw new Error(result.error ?? 'Failed to bulk annotate')
  }

  return result
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
