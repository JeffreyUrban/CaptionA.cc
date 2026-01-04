/**
 * Mark a video as "touched" for UI refresh
 *
 * When a video is touched, the video list will force-refresh its stats
 * on the next render, ensuring the UI shows the latest state.
 */
export function markVideoTouched(videoId: string): void {
  if (typeof window === 'undefined') return

  try {
    const touchedList = localStorage.getItem('touched-videos')
    const touched = touchedList ? new Set(JSON.parse(touchedList)) : new Set<string>()
    touched.add(videoId)
    localStorage.setItem('touched-videos', JSON.stringify(Array.from(touched)))
    console.log(`[VideoTouched] Marked ${videoId} as touched for UI refresh`)
  } catch (e) {
    console.error('[VideoTouched] Failed to mark video as touched:', e)
  }
}

/**
 * Check response headers for X-Video-Touched and mark if present
 *
 * Usage:
 *   const response = await fetch(...)
 *   handleVideoTouchedHeader(response)
 */
export function handleVideoTouchedHeader(response: Response): void {
  const videoId = response.headers.get('X-Video-Touched')
  if (videoId) {
    markVideoTouched(videoId)
  }
}

/**
 * Fetch wrapper that automatically handles X-Video-Touched header
 *
 * Usage:
 *   const response = await fetchWithVideoTouch('/api/...')
 */
export async function fetchWithVideoTouch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, init)
  handleVideoTouchedHeader(response)
  return response
}
