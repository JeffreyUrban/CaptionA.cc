/**
 * Hook for opportunistic image regeneration
 *
 * Triggers background image regeneration during natural workflow pauses
 * to keep images up-to-date without blocking the UI.
 */

import { useEffect, useRef } from 'react'

interface UseImageRegenerationOptions {
  videoId: string
  /** Enable automatic regeneration (default: true) */
  enabled?: boolean
  /** Delay before starting regeneration after workflow pause (ms, default: 2000) */
  idleDelay?: number
  /** Maximum images to process per batch (default: 5) */
  maxBatch?: number
}

/**
 * Opportunistically process pending image regenerations.
 *
 * Waits for user to pause their workflow (no saves for idleDelay ms),
 * then processes a small batch of pending regenerations in the background.
 */
export function useImageRegeneration({
  videoId,
  enabled = true,
  idleDelay = 2000,
  maxBatch = 5,
}: UseImageRegenerationOptions) {
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isProcessingRef = useRef(false)

  useEffect(() => {
    if (!enabled || !videoId) return

    const processQueue = async () => {
      if (isProcessingRef.current) return
      isProcessingRef.current = true

      try {
        const encodedVideoId = encodeURIComponent(videoId)
        const response = await fetch(
          `/api/annotations/${encodedVideoId}/process-regen-queue?maxBatch=${maxBatch}`,
          { method: 'POST' }
        )

        if (response.ok) {
          const data = await response.json()
          if (data.processed > 0) {
            console.log(
              `[ImageRegen] Processed ${data.processed} images, ${data.remaining} remaining`
            )
          }
        }
      } catch (error) {
        console.error('[ImageRegen] Failed to process queue:', error)
      } finally {
        isProcessingRef.current = false
      }
    }

    // Start idle timer on mount
    const startIdleTimer = () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
      idleTimerRef.current = setTimeout(() => {
        void processQueue()
      }, idleDelay)
    }

    startIdleTimer()

    // Reset timer on user activity (navigation, save, etc.)
    const resetTimer = () => {
      startIdleTimer()
    }

    // Listen for custom events that signal workflow activity
    window.addEventListener('annotation-saved', resetTimer)
    window.addEventListener('annotation-navigated', resetTimer)

    // Cleanup
    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
      window.removeEventListener('annotation-saved', resetTimer)
      window.removeEventListener('annotation-navigated', resetTimer)
    }
  }, [videoId, enabled, idleDelay, maxBatch])
}
