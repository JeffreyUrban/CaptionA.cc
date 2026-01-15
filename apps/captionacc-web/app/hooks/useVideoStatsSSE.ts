/**
 * Hook for subscribing to real-time video stats updates via Server-Sent Events (SSE).
 *
 * Connects to the SSE endpoint and triggers stats refetch when updates are received.
 */

import { useEffect, useRef } from 'react'

interface VideoStatsUpdateEvent {
  videoId: string
  flowName: string
  status: 'complete' | 'error'
  timestamp: string
}

interface UseVideoStatsSSEOptions {
  /** Callback when a video stats update is received */
  onUpdate: (videoId: string) => void
  /** Whether SSE is enabled (default: true) */
  enabled?: boolean
}

/**
 * Subscribe to real-time video stats updates via SSE.
 *
 * When a Prefect flow completes, the webhook broadcasts an event,
 * and this hook triggers a refetch for the affected video.
 */
export function useVideoStatsSSE({ onUpdate, enabled = true }: UseVideoStatsSSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const isConnectingRef = useRef(false)

  useEffect(() => {
    if (!enabled) return

    // Only run on client side
    if (typeof window === 'undefined') return

    // Prevent duplicate connections (React StrictMode causes double-mount in dev)
    if (isConnectingRef.current || eventSourceRef.current) {
      console.log('[SSE] Already connected or connecting, skipping duplicate connection')
      return
    }

    const connect = () => {
      // Prevent concurrent connection attempts
      if (isConnectingRef.current) return

      isConnectingRef.current = true
      console.log('[SSE] Connecting to video stats updates...')

      const eventSource = new EventSource('/api/events/video-stats')
      eventSourceRef.current = eventSource

      eventSource.addEventListener('video-stats-updated', event => {
        try {
          const data = JSON.parse(event.data) as VideoStatsUpdateEvent
          console.log('[SSE] Video stats updated:', data)

          // Trigger refetch for this video
          onUpdate(data.videoId)

          // Reset reconnect attempts on successful message
          reconnectAttemptsRef.current = 0
        } catch (error) {
          console.error('[SSE] Failed to parse event data:', error)
        }
      })

      eventSource.onopen = () => {
        console.log('[SSE] Connected')
        reconnectAttemptsRef.current = 0
        isConnectingRef.current = false
      }

      eventSource.onerror = error => {
        console.error('[SSE] Connection error:', error)
        eventSource.close()
        isConnectingRef.current = false

        // Exponential backoff reconnect (1s, 2s, 4s, 8s, max 30s)
        const attempts = reconnectAttemptsRef.current
        const delay = Math.min(1000 * Math.pow(2, attempts), 30000)

        console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${attempts + 1})...`)

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++
          connect()
        }, delay)
      }
    }

    connect()

    // Cleanup on unmount
    return () => {
      console.log('[SSE] Disconnecting...')
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      isConnectingRef.current = false
    }
  }, [enabled, onUpdate])
}
