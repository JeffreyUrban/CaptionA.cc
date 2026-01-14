import { useState, useEffect, useRef } from 'react'

/**
 * Processing status from the API.
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
 * Hook to track background processing status (streaming updates, full retrains).
 *
 * Polls the processing status API and returns current state.
 * Automatically stops polling when processing completes.
 *
 * @param videoId - Video identifier
 * @param pollInterval - Polling interval in milliseconds (default: 1000ms)
 * @returns Current processing status
 */
export function useProcessingStatus(
  videoId: string | undefined,
  pollInterval = 1000
): ProcessingStatus {
  const [status, setStatus] = useState<ProcessingStatus>({
    isProcessing: false,
    type: null,
    startedAt: null,
    estimatedCompletionAt: null,
    progress: null,
  })

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const wasProcessingRef = useRef(false)

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

    const checkStatus = async () => {
      try {
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/processing-status`
        )

        if (!response.ok) {
          console.error('Failed to check processing status:', response.statusText)
          return
        }

        const data: ProcessingStatus = await response.json()
        setStatus(data)

        // Track transitions
        if (wasProcessingRef.current && !data.isProcessing) {
          console.log('[useProcessingStatus] Processing completed')
        } else if (!wasProcessingRef.current && data.isProcessing) {
          console.log('[useProcessingStatus] Processing started:', data.type)
        }

        wasProcessingRef.current = data.isProcessing

        // Stop polling if no longer processing
        if (!data.isProcessing && intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      } catch (error) {
        console.error('[useProcessingStatus] Error checking status:', error)
      }
    }

    // Initial check
    void checkStatus()

    // Set up polling
    if (!intervalRef.current) {
      intervalRef.current = setInterval(() => void checkStatus(), pollInterval)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [videoId, pollInterval])

  return status
}
