import { useState, useEffect, useRef, useCallback } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'

import { supabase, supabaseSchema } from '~/services/supabase-client'

/**
 * Processing status from the API and Supabase realtime.
 */
export interface ProcessingStatus {
  isProcessing: boolean
  type: 'streaming_update' | 'full_retrain' | null
  startedAt: string | null
  estimatedCompletionAt: string | null
  progress: {
    processed?: number
    total?: number
    message?: string
  } | null
}

/**
 * Video record fields relevant for processing status
 */
interface VideoRecord {
  id: string
  status: string | null
  prefect_flow_run_id: string | null
}

/**
 * Determine processing status from video record status field.
 * Maps Supabase video status to ProcessingStatus.
 */
function mapVideoStatusToProcessingStatus(
  videoStatus: string | null,
  flowRunId: string | null
): ProcessingStatus {
  // Processing states from the video status field
  const processingStatuses = ['processing', 'extracting', 'uploading', 'queued']
  const isProcessing = videoStatus !== null && processingStatuses.includes(videoStatus)

  // Determine processing type based on status
  let type: ProcessingStatus['type'] = null
  if (isProcessing) {
    // If there's a flow run, it's likely a full retrain; otherwise streaming update
    type = flowRunId ? 'full_retrain' : 'streaming_update'
  }

  return {
    isProcessing,
    type,
    startedAt: isProcessing ? new Date().toISOString() : null,
    estimatedCompletionAt: isProcessing
      ? new Date(Date.now() + (type === 'full_retrain' ? 15000 : 2000)).toISOString()
      : null,
    progress: isProcessing
      ? {
          message: type === 'full_retrain' ? 'Retraining model...' : 'Updating predictions...',
        }
      : null,
  }
}

/**
 * Hook to track background processing status via Supabase Realtime.
 *
 * Subscribes to changes on the videos table for a specific video ID
 * and updates local state when processing status changes.
 *
 * Falls back to initial API fetch to get current status, then uses
 * realtime for subsequent updates.
 *
 * @param videoId - Video identifier
 * @returns Current processing status
 */
export function useProcessingStatus(videoId: string | undefined): ProcessingStatus {
  const [status, setStatus] = useState<ProcessingStatus>({
    isProcessing: false,
    type: null,
    startedAt: null,
    estimatedCompletionAt: null,
    progress: null,
  })

  const channelRef = useRef<RealtimeChannel | null>(null)
  const wasProcessingRef = useRef(false)

  // Fetch initial status from API
  const fetchInitialStatus = useCallback(async () => {
    if (!videoId) return

    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(videoId)}/processing-status`
      )

      if (!response.ok) {
        console.error('[useProcessingStatus] Failed to fetch initial status:', response.statusText)
        return
      }

      const data: ProcessingStatus = await response.json()
      setStatus(data)
      wasProcessingRef.current = data.isProcessing
    } catch (error) {
      console.error('[useProcessingStatus] Error fetching initial status:', error)
    }
  }, [videoId])

  useEffect(() => {
    if (!videoId) {
      // No videoId, reset status
      setStatus({
        isProcessing: false,
        type: null,
        startedAt: null,
        estimatedCompletionAt: null,
        progress: null,
      })
      return
    }

    // Only run on client side
    if (typeof window === 'undefined') return

    // Fetch initial status
    fetchInitialStatus()

    // Clean up existing subscription before creating new one
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }

    console.log(`[useProcessingStatus] Subscribing to changes for video ${videoId}`)

    // Subscribe to changes on this specific video
    const channel = supabase
      .channel(`video-processing-${videoId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: supabaseSchema,
          table: 'videos',
          filter: `id=eq.${videoId}`,
        },
        payload => {
          const newRecord = payload.new as VideoRecord
          console.log(`[useProcessingStatus] Video ${videoId} updated:`, newRecord.status)

          const newStatus = mapVideoStatusToProcessingStatus(
            newRecord.status,
            newRecord.prefect_flow_run_id
          )

          // Track transitions for logging
          if (wasProcessingRef.current && !newStatus.isProcessing) {
            console.log('[useProcessingStatus] Processing completed')
          } else if (!wasProcessingRef.current && newStatus.isProcessing) {
            console.log('[useProcessingStatus] Processing started:', newStatus.type)
          }

          wasProcessingRef.current = newStatus.isProcessing
          setStatus(newStatus)
        }
      )
      .subscribe(subscriptionStatus => {
        if (subscriptionStatus === 'SUBSCRIBED') {
          console.log(`[useProcessingStatus] Subscribed to video ${videoId}`)
        } else if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
          console.error('[useProcessingStatus] Subscription error:', subscriptionStatus)
        }
      })

    channelRef.current = channel

    // Cleanup on unmount or videoId change
    return () => {
      console.log(`[useProcessingStatus] Unsubscribing from video ${videoId}`)
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [videoId, fetchInitialStatus])

  return status
}
