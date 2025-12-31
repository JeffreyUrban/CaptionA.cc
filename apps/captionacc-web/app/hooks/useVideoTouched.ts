import { useEffect } from 'react'

/**
 * Marks a video as "touched" (worked on) in localStorage.
 * This is used by the Videos page to highlight recently worked-on videos.
 *
 * @param videoId - The ID of the video to mark as touched
 */
export function useVideoTouched(videoId: string | null | undefined) {
  useEffect(() => {
    if (!videoId || typeof window === 'undefined') return

    const touchedVideos = new Set(
      JSON.parse(localStorage.getItem('touched-videos') ?? '[]') as string[]
    )
    touchedVideos.add(videoId)
    localStorage.setItem('touched-videos', JSON.stringify(Array.from(touchedVideos)))
  }, [videoId])
}
