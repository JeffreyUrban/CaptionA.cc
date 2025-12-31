/**
 * Hook for managing video statistics data.
 * Handles stats caching, polling for processing videos, localStorage persistence,
 * and validation of error badges on mount.
 */

import { useState, useEffect, useCallback } from 'react'

import type { VideoStats, TreeNode } from '~/utils/video-tree'

// Cache version - increment to invalidate cache when VideoStats structure changes
const CACHE_VERSION = 'v12'

/** Validate video IDs (same logic as server-side validation) */
function isValidVideoId(videoId: string): boolean {
  if (!videoId || videoId.length === 0) return false
  // Not a UUID bucket directory (2-char hex like "f0", "ff", "12")
  if (videoId.length === 2 && /^[0-9a-f]{2}$/i.test(videoId)) return false
  // Not a single number (like "1", "20")
  if (/^\d+$/.test(videoId)) return false
  // Not a hidden file/folder
  if (videoId.startsWith('.')) return false
  return true
}

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
 * Hook for managing video statistics with caching and polling.
 */
export function useVideoStats({ tree }: UseVideoStatsParams): UseVideoStatsReturn {
  // Client-side mount state
  const [isMounted, setIsMounted] = useState(false)

  // Stats map with localStorage initialization
  const [videoStatsMap, setVideoStatsMap] = useState<Map<string, VideoStats>>(() => {
    // Load cached stats from localStorage
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(`video-stats-cache-${CACHE_VERSION}`)
      if (cached) {
        try {
          const parsed = JSON.parse(cached)
          // Filter out invalid video IDs from cache
          const validEntries = Object.entries(parsed).filter(([videoId]) => isValidVideoId(videoId))
          if (validEntries.length < Object.entries(parsed).length) {
            console.log(
              `[useVideoStats] Filtered ${Object.entries(parsed).length - validEntries.length} invalid cached entries`
            )
          }
          return new Map(validEntries)
        } catch {
          return new Map()
        }
      }
    }
    return new Map()
  })

  // Track whether error badges have been validated
  const [errorBadgesValidated, setErrorBadgesValidated] = useState(false)

  // Detect client-side mount
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Save stats to localStorage whenever they update
  useEffect(() => {
    if (videoStatsMap.size > 0 && typeof window !== 'undefined') {
      // Filter out any invalid stats objects (those with error property)
      const validStats = Array.from(videoStatsMap.entries()).filter(
        ([, stats]) => !('error' in stats)
      )
      if (validStats.length > 0) {
        const cacheObj = Object.fromEntries(validStats)
        localStorage.setItem(`video-stats-cache-${CACHE_VERSION}`, JSON.stringify(cacheObj))
      }
    }
  }, [videoStatsMap])

  // Callback for updating stats
  const updateVideoStats = useCallback((videoId: string, stats: VideoStats) => {
    setVideoStatsMap(prev => {
      const next = new Map(prev)
      next.set(videoId, stats)
      return next
    })
  }, [])

  // Callback for clearing stats
  const clearVideoStats = useCallback((videoId: string) => {
    setVideoStatsMap(prev => {
      const next = new Map(prev)
      next.delete(videoId)
      return next
    })
  }, [])

  // Poll for stats updates for videos that are processing
  useEffect(() => {
    if (!isMounted) return

    // Find videos that are currently processing (upload/processing OR crop_frames)
    const processingVideos = Array.from(videoStatsMap.entries())
      .filter(([, stats]) => {
        // Poll if upload/processing is in progress
        const hasProcessingStatus =
          stats.processingStatus &&
          stats.processingStatus.status !== 'processing_complete' &&
          stats.processingStatus.status !== 'error'

        // Poll if crop_frames is queued or processing
        const hasCropFramesProcessing =
          stats.cropFramesStatus &&
          (stats.cropFramesStatus.status === 'queued' ||
            stats.cropFramesStatus.status === 'processing')

        return Boolean(hasProcessingStatus) || Boolean(hasCropFramesProcessing)
      })
      .map(([videoId]) => videoId)

    if (processingVideos.length === 0) return

    console.log(`[useVideoStats] Polling ${processingVideos.length} processing videos...`)

    // Poll every 5 seconds
    const interval = setInterval(() => {
      processingVideos.forEach(videoId => {
        fetch(`/api/videos/${encodeURIComponent(videoId)}/stats`)
          .then(res => (res.ok ? res.json() : null))
          .then(data => {
            if (data && !data.error) {
              console.log(`[useVideoStats] Polling update for ${videoId}:`, {
                processingStatus: data.processingStatus?.status,
                cropFramesStatus: data.cropFramesStatus?.status,
              })
              updateVideoStats(videoId, data)
            }
          })
          .catch(err => console.error(`Failed to poll stats for ${videoId}:`, err))
      })
    }, 5000)

    return () => clearInterval(interval)
  }, [isMounted, videoStatsMap, updateVideoStats])

  // One-time validation of error badges on mount
  useEffect(() => {
    if (!isMounted || errorBadgesValidated) return

    // Find videos with error badges in cache and refetch them to validate
    const videosWithErrors = Array.from(videoStatsMap.entries())
      .filter(([, stats]) => stats.badges?.some(badge => badge.type === 'error'))
      .map(([videoId]) => videoId)

    if (videosWithErrors.length > 0) {
      console.log(
        `[useVideoStats] Validating ${videosWithErrors.length} videos with error badges...`
      )
      videosWithErrors.forEach(videoId => {
        fetch(`/api/videos/${encodeURIComponent(videoId)}/stats`)
          .then(res => (res.ok ? res.json() : null))
          .then(data => {
            if (data && !data.error) {
              console.log(`[useVideoStats] Validated error badge for ${videoId}`)
              updateVideoStats(videoId, data)
            }
          })
          .catch(err => console.error(`Failed to validate error badge for ${videoId}:`, err))
      })
    }

    setErrorBadgesValidated(true)
  }, [isMounted, errorBadgesValidated, videoStatsMap, updateVideoStats])

  // Eagerly load stats for all videos in the tree
  useEffect(() => {
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
        console.log(`[useVideoStats] Loading stats for ${videoId}...`)
        fetch(`/api/videos/${encodeURIComponent(videoId)}/stats`)
          .then(res => {
            if (!res.ok) {
              console.error(`[useVideoStats] Stats request failed for ${videoId}: ${res.status}`)
              return null
            }
            return res.json()
          })
          .then(data => {
            if (data && !data.error) {
              console.log(`[useVideoStats] Stats loaded for ${videoId}:`, data)
              updateVideoStats(videoId, data)
            } else {
              console.error(
                `[useVideoStats] Stats error for ${videoId}:`,
                data?.error ?? 'Unknown error'
              )
            }
          })
          .catch(err => console.error(`Failed to load stats for ${videoId}:`, err))
      } else if (cachedStats.databaseId) {
        // We have cached stats with a database_id - verify it hasn't changed
        fetch(`/api/videos/${encodeURIComponent(videoId)}/stats`)
          .then(res => (res.ok ? res.json() : null))
          .then(data => {
            if (data?.databaseId && data.databaseId !== cachedStats.databaseId) {
              // Database was recreated - invalidate cache and use fresh data
              console.log(`[useVideoStats] Database recreated for ${videoId}, invalidating cache`)
              updateVideoStats(videoId, data)
            }
          })
          .catch(() => {
            /* Ignore errors on background validation */
          })
      }
    })
  }, [tree, videoStatsMap, updateVideoStats])

  return {
    videoStatsMap,
    isMounted,
    updateVideoStats,
    clearVideoStats,
  }
}
