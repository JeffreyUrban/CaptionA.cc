/**
 * Hook for managing video statistics data.
 * Uses centralized video-stats-store for state management.
 * Handles eager loading and error validation on mount.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'

import { useVideoStatsStore } from '~/stores/video-stats-store'
import type { VideoStats, TreeNode } from '~/utils/video-tree'

/** Collect all video IDs from tree nodes */
function collectAllVideoIds(nodes: TreeNode[]): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (node.type === 'video') {
      ids.push(node.videoId)
    } else {
      ids.push(...collectAllVideoIds(node.children))
    }
  }
  return ids
}

interface UseVideoStatsParams {
  /** The video tree from the loader */
  tree: TreeNode[]
}

interface UseVideoStatsReturn {
  /** Map of video IDs to their stats */
  videoStatsMap: Map<string, VideoStats>
  /** Whether the component has mounted (for hydration safety) */
  isMounted: boolean
  /** Update stats for a specific video */
  updateVideoStats: (videoId: string, stats: VideoStats) => void
  /** Clear stats for a specific video (e.g., after deletion or move) */
  clearVideoStats: (videoId: string) => void
}

/**
 * Hook for managing video statistics using centralized store.
 * Handles eager loading and error validation.
 */
export function useVideoStats({ tree }: UseVideoStatsParams): UseVideoStatsReturn {
  // Client-side mount state
  const [isMounted, setIsMounted] = useState(false)

  // Track whether error badges have been validated
  const [errorBadgesValidated, setErrorBadgesValidated] = useState(false)

  // Get store state and actions
  const stats = useVideoStatsStore(state => state.stats)
  const setStats = useVideoStatsStore(state => state.setStats)
  const removeStats = useVideoStatsStore(state => state.removeStats)
  const fetchStats = useVideoStatsStore(state => state.fetchStats)
  const startPolling = useVideoStatsStore(state => state.startPolling)
  const stopPolling = useVideoStatsStore(state => state.stopPolling)

  // Convert stats object to Map for backward compatibility
  const videoStatsMap = useMemo(() => {
    return new Map(Object.entries(stats))
  }, [stats])

  // Detect client-side mount
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Callbacks for compatibility with existing code
  const updateVideoStats = useCallback(
    (videoId: string, videoStats: VideoStats) => {
      setStats(videoId, videoStats)
    },
    [setStats]
  )

  const clearVideoStats = useCallback(
    (videoId: string) => {
      removeStats(videoId)
    },
    [removeStats]
  )

  // Start/stop centralized polling based on mount state
  useEffect(() => {
    if (!isMounted) return

    // Start polling when component mounts
    startPolling()

    // Stop polling when component unmounts
    return () => {
      stopPolling()
    }
  }, [isMounted, startPolling, stopPolling])

  // One-time validation of error badges on mount
  useEffect(() => {
    if (!isMounted || errorBadgesValidated) return

    // Find videos with error badges in cache and refetch them to validate
    const videosWithErrors = Array.from(videoStatsMap.entries())
      .filter(([, videoStats]) => videoStats.badges?.some(badge => badge.type === 'error'))
      .map(([videoId]) => videoId)

    if (videosWithErrors.length > 0) {
      console.log(
        `[useVideoStats] Validating ${videosWithErrors.length} videos with error badges...`
      )
      videosWithErrors.forEach(videoId => {
        void fetchStats(videoId, true) // Force refresh
      })
    }

    setErrorBadgesValidated(true)
  }, [isMounted, errorBadgesValidated, videoStatsMap, fetchStats])

  // Eagerly load stats for all videos in the tree
  useEffect(() => {
    if (!isMounted) return

    const videoIds = collectAllVideoIds(tree)

    // Check for videos that were recently touched and need stats refresh
    let touchedVideos: Set<string> = new Set()
    if (typeof window !== 'undefined') {
      const touchedList = localStorage.getItem('touched-videos')
      if (touchedList) {
        try {
          touchedVideos = new Set(JSON.parse(touchedList))
          // Clear the list after reading
          localStorage.removeItem('touched-videos')
        } catch (e) {
          console.error('Failed to parse touched videos list:', e)
        }
      }
    }

    // Load stats for all videos (skip cached ones unless they were recently touched or database_id changed)
    videoIds.forEach(videoId => {
      const cachedStats = videoStatsMap.get(videoId)
      const needsRefresh = touchedVideos.has(videoId)

      // Always fetch if no cache, or if touched
      if (needsRefresh || !cachedStats) {
        void fetchStats(videoId, true) // Force refresh
      } else if (cachedStats.databaseId) {
        // We have cached stats with a database_id - verify it hasn't changed
        void fetchStats(videoId, false).then(data => {
          if (data?.databaseId && data.databaseId !== cachedStats.databaseId) {
            // Database was recreated - invalidate cache (fetchStats already updated)
            console.log(`[useVideoStats] Database recreated for ${videoId}, cache updated`)
          }
        })
      }
    })
  }, [isMounted, tree, videoStatsMap, fetchStats])

  return {
    videoStatsMap,
    isMounted,
    updateVideoStats,
    clearVideoStats,
  }
}
