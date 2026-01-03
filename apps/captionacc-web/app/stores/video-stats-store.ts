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

  // Background polling for processing videos
  startPolling: () => void
  stopPolling: () => void
}

// ============================================================================
// Configuration
// ============================================================================

const CACHE_VERSION = 'v1'
const STORAGE_KEY = `video-stats-${CACHE_VERSION}`

// Cache duration: 5 minutes (don't refetch if recently fetched)
const CACHE_DURATION_MS = 5 * 60 * 1000

// Poll interval for processing videos: 5 seconds
const POLL_INTERVAL_MS = 5000

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if video is currently processing and needs polling
 */
function isProcessing(stats: VideoStats): boolean {
  // Poll if upload/processing is in progress
  const hasProcessingStatus =
    stats.processingStatus &&
    stats.processingStatus.status !== 'processing_complete' &&
    stats.processingStatus.status !== 'error'

  // Poll if crop_frames is queued or processing
  const hasCropFramesProcessing =
    stats.cropFramesStatus &&
    (stats.cropFramesStatus.status === 'queued' || stats.cropFramesStatus.status === 'processing')

  return Boolean(hasProcessingStatus) || Boolean(hasCropFramesProcessing)
}

/**
 * Validate video ID (only reject empty strings)
 */
function isValidVideoId(videoId: string): boolean {
  return Boolean(videoId && videoId.trim().length > 0)
}

// ============================================================================
// Store Implementation
// ============================================================================

let pollingInterval: ReturnType<typeof setInterval> | null = null

export const useVideoStatsStore = create<VideoStatsStore>()(
  persist(
    (set, get) => ({
      // Initial state
      stats: {},
      lastFetch: {},

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

      // Start background polling for processing videos
      startPolling: () => {
        // Stop existing polling if any
        if (pollingInterval) {
          clearInterval(pollingInterval)
        }

        pollingInterval = setInterval(() => {
          const state = get()

          // Find videos that are processing
          const processingVideos = Object.entries(state.stats)
            .filter(([, stats]) => isProcessing(stats))
            .map(([videoId]) => videoId)

          if (processingVideos.length === 0) return

          console.log(`[VideoStatsStore] Polling ${processingVideos.length} processing videos...`)

          // Fetch stats for all processing videos
          processingVideos.forEach(videoId => {
            void get().fetchStats(videoId, true) // Force refresh
          })
        }, POLL_INTERVAL_MS)
      },

      // Stop background polling
      stopPolling: () => {
        if (pollingInterval) {
          clearInterval(pollingInterval)
          pollingInterval = null
        }
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
