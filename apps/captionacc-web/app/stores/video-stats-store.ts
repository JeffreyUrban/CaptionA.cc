/**
 * Video Stats Store - Centralized video statistics with localStorage persistence
 *
 * This store manages video statistics (annotations, processing status, etc.) for all videos.
 *
 * Benefits over component-level polling:
 * - Centralized state shared across all pages
 * - Optimistic updates when we know status changed
 * - Efficient polling only for genuinely processing videos
 * - localStorage persistence (survives refresh)
 *
 * Usage:
 * - Videos page displays stats from store
 * - Upload completion updates store directly (no polling needed)
 * - Background polling only for videos in active processing states
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import type { VideoStats } from '~/utils/video-tree'

// ============================================================================
// Types
// ============================================================================

export interface VideoStatsStore {
  // State
  stats: Record<string, VideoStats>
  lastFetch: Record<string, number> // Timestamp of last fetch per video

  // Actions
  setStats: (videoId: string, stats: VideoStats) => void
  removeStats: (videoId: string) => void
  clearAll: () => void

  // Fetch from API
  fetchStats: (videoId: string, force?: boolean) => Promise<VideoStats | null>

  // SSE connection management
  connectSSE: () => void
  disconnectSSE: () => void

  // Callback for when new videos are detected
  onNewVideo: ((videoId: string) => void) | null
  setOnNewVideo: (callback: ((videoId: string) => void) | null) => void
}

// ============================================================================
// Configuration
// ============================================================================

const CACHE_VERSION = 'v1'
const STORAGE_KEY = `video-stats-${CACHE_VERSION}`

// Cache duration: 5 minutes (don't refetch if recently fetched)
const CACHE_DURATION_MS = 5 * 60 * 1000

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate video ID (only reject empty strings)
 */
function isValidVideoId(videoId: string): boolean {
  return Boolean(videoId && videoId.trim().length > 0)
}

// ============================================================================
// Store Implementation
// ============================================================================

// Global SSE connection (singleton, persists across component unmounts)
let sseConnection: EventSource | null = null
let reconnectTimeout: NodeJS.Timeout | null = null
let reconnectAttempts = 0

export const useVideoStatsStore = create<VideoStatsStore>()(
  persist(
    (set, get) => ({
      // Initial state
      stats: {},
      lastFetch: {},
      onNewVideo: null,

      // Set stats for a video
      setStats: (videoId, stats) => {
        if (!isValidVideoId(videoId)) {
          console.warn(`[VideoStatsStore] Invalid video ID: ${videoId}`)
          return
        }

        set(state => ({
          stats: {
            ...state.stats,
            [videoId]: stats,
          },
          lastFetch: {
            ...state.lastFetch,
            [videoId]: Date.now(),
          },
        }))
      },

      // Remove stats for a video (e.g., after deletion)
      removeStats: videoId => {
        set(state => {
          const { [videoId]: _removedStats, ...remainingStats } = state.stats
          const { [videoId]: _removedFetch, ...remainingFetch } = state.lastFetch

          return {
            stats: remainingStats,
            lastFetch: remainingFetch,
          }
        })
      },

      // Clear all stats
      clearAll: () => {
        set({ stats: {}, lastFetch: {} })
      },

      // Fetch stats from API
      fetchStats: async (videoId, force = false) => {
        const state = get()
        const lastFetchTime = state.lastFetch[videoId] ?? 0
        const now = Date.now()

        // Skip if recently fetched (unless forced)
        if (!force && now - lastFetchTime < CACHE_DURATION_MS) {
          return state.stats[videoId] ?? null
        }

        try {
          const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/stats`)
          if (!res.ok) {
            console.error(`[VideoStatsStore] Failed to fetch stats for ${videoId}: ${res.status}`)
            return null
          }

          const data = await res.json()
          if (data && !data.error) {
            get().setStats(videoId, data)
            return data
          }

          return null
        } catch (err) {
          console.error(`[VideoStatsStore] Error fetching stats for ${videoId}:`, err)
          return null
        }
      },

      // Connect to SSE (singleton, only one connection ever)
      connectSSE: () => {
        // Already connected or connecting
        if (sseConnection) {
          console.log('[VideoStatsStore] SSE already connected')
          return
        }

        console.log('[VideoStatsStore] Connecting to SSE...')

        let eventSource: EventSource
        try {
          eventSource = new EventSource('/api/events/video-stats')
          sseConnection = eventSource
        } catch (error) {
          console.error('[VideoStatsStore] Failed to create SSE connection:', error)
          return
        }

        eventSource.addEventListener('video-stats-updated', event => {
          try {
            const data = JSON.parse(event.data) as {
              videoId: string
              flowName: string
              status: string
            }
            console.log('[VideoStatsStore] SSE update received:', data)

            const currentStats = get().stats
            const isNewVideo = !currentStats[data.videoId]

            // videoId is now the UUID (stable identifier)
            // Force refetch stats for this video
            void get().fetchStats(data.videoId, true)

            // If this is a new video (not in our stats cache), notify callback
            // This allows the Videos page to revalidate and fetch the new video list
            if (isNewVideo && get().onNewVideo) {
              console.log(
                '[VideoStatsStore] New video detected, triggering callback:',
                data.videoId
              )
              get().onNewVideo?.(data.videoId)
            }

            // Reset reconnect attempts on successful message
            reconnectAttempts = 0
          } catch (error) {
            console.error('[VideoStatsStore] Failed to parse SSE event:', error)
          }
        })

        eventSource.onopen = () => {
          console.log('[VideoStatsStore] SSE connected')
          reconnectAttempts = 0
        }

        eventSource.onerror = error => {
          console.error('[VideoStatsStore] SSE connection error:', error)

          // Check if it's just a normal close (readyState = 2)
          if (eventSource.readyState === EventSource.CLOSED) {
            console.log('[VideoStatsStore] SSE connection closed cleanly')
            eventSource.close()
            sseConnection = null

            // Only reconnect if we had a successful connection before
            if (reconnectAttempts === 0) {
              console.log('[VideoStatsStore] Not reconnecting - connection never succeeded')
              return
            }
          }

          eventSource.close()
          sseConnection = null

          // Exponential backoff reconnect
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)
          console.log(
            `[VideoStatsStore] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})...`
          )

          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++
            get().connectSSE()
          }, delay)
        }
      },

      // Disconnect from SSE
      disconnectSSE: () => {
        if (sseConnection) {
          console.log('[VideoStatsStore] Disconnecting SSE')
          sseConnection.close()
          sseConnection = null
        }
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout)
          reconnectTimeout = null
        }
      },

      // Set callback for new video detection
      setOnNewVideo: callback => {
        set({ onNewVideo: callback })
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist stats, not lastFetch (refetch on mount)
      partialize: state => ({ stats: state.stats }),
    }
  )
)
