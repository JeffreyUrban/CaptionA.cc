/**
 * Hook for subscribing to real-time video updates via Supabase Realtime.
 *
 * Connects to Supabase realtime channel and triggers stats refetch when video records are updated.
 */

import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { supabase, supabaseSchema } from '~/services/supabase-client'

interface UseVideoStatsRealtimeOptions {
  /** Callback when a video is updated */
  onUpdate: (videoId: string) => void
  /** Whether realtime subscription is enabled (default: true) */
  enabled?: boolean
  /** Optional tenant ID to filter updates (if not provided, listens to all videos) */
  tenantId?: string
}

/**
 * Subscribe to real-time video updates via Supabase Realtime.
 *
 * When a video record is updated in the database (e.g., after processing completes),
 * this hook triggers a refetch for the affected video.
 */
export function useVideoStatsSSE({
  onUpdate,
  enabled = true,
  tenantId,
}: UseVideoStatsRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttemptsRef = useRef(0)

  useEffect(() => {
    if (!enabled) return

    // Only run on client side
    if (typeof window === 'undefined') return

    // Prevent duplicate subscriptions
    if (channelRef.current) {
      console.log('[Realtime] Already subscribed, skipping duplicate subscription')
      return
    }

    const subscribe = () => {
      console.log('[Realtime] Subscribing to video updates...')

      // Build filter for tenant-scoped updates if tenantId is provided
      const filter: {
        event: 'UPDATE'
        schema: string
        table: 'videos'
        filter?: string
      } = {
        event: 'UPDATE',
        schema: supabaseSchema,
        table: 'videos',
      }

      if (tenantId) {
        filter.filter = `tenant_id=eq.${tenantId}`
      }

      const channel = supabase
        .channel('video-stats-updates')
        .on('postgres_changes', filter, payload => {
          const newRecord = payload.new as Record<string, unknown> | undefined
          const videoId = newRecord?.['id'] as string | undefined
          if (videoId) {
            console.log('[Realtime] Video updated:', videoId)
            onUpdate(videoId)
            // Reset reconnect attempts on successful message
            reconnectAttemptsRef.current = 0
          }
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            console.log('[Realtime] Subscribed to video updates')
            reconnectAttemptsRef.current = 0
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('[Realtime] Subscription error:', status)
            handleReconnect()
          } else if (status === 'CLOSED') {
            console.log('[Realtime] Channel closed')
          }
        })

      channelRef.current = channel
    }

    const handleReconnect = () => {
      // Clean up existing channel
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }

      // Exponential backoff reconnect (1s, 2s, 4s, 8s, max 30s)
      const attempts = reconnectAttemptsRef.current
      const delay = Math.min(1000 * Math.pow(2, attempts), 30000)

      console.log(`[Realtime] Reconnecting in ${delay}ms (attempt ${attempts + 1})...`)

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectAttemptsRef.current++
        subscribe()
      }, delay)
    }

    subscribe()

    // Cleanup on unmount
    return () => {
      console.log('[Realtime] Unsubscribing from video updates...')
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }
  }, [enabled, onUpdate, tenantId])
}
