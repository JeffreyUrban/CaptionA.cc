/**
 * Video statistics utilities
 *
 * Fetches video status and statistics from Supabase.
 * Local databases are deprecated - all data comes from cloud storage.
 */

import { createServerSupabaseClient } from '~/services/supabase-client'

export type BadgeState = {
  type: 'layout' | 'boundaries' | 'text' | 'fully-annotated' | 'error' | 'info' | 'warning'
  label: string
  color: 'blue' | 'indigo' | 'purple' | 'yellow' | 'green' | 'teal' | 'red' | 'gray'
  clickable: boolean
  url?: string
  errorDetails?: {
    message: string
    stack?: string
    context?: Record<string, unknown>
  }
}

export interface VideoStats {
  totalAnnotations: number
  pendingReview: number
  confirmedAnnotations: number
  predictedAnnotations: number
  gapAnnotations: number
  progress: number
  totalFrames: number
  coveredFrames: number
  hasOcrData: boolean
  layoutApproved: boolean
  boundaryPendingReview: number
  textPendingReview: number
  databaseId?: string
  badges: BadgeState[]
}

/**
 * Create an empty VideoStats object with the specified badges
 */
function createEmptyStats(badges: BadgeState[] = []): VideoStats {
  return {
    totalAnnotations: 0,
    pendingReview: 0,
    confirmedAnnotations: 0,
    predictedAnnotations: 0,
    gapAnnotations: 0,
    progress: 0,
    totalFrames: 0,
    coveredFrames: 0,
    hasOcrData: false,
    layoutApproved: false,
    boundaryPendingReview: 0,
    textPendingReview: 0,
    badges,
  }
}

/**
 * Map Supabase video status to badge
 */
function statusToBadge(status: string | null, videoId: string): BadgeState {
  switch (status) {
    case 'processing':
      return {
        type: 'layout',
        label: 'Processing',
        color: 'purple',
        clickable: false,
      }
    case 'uploading':
      return {
        type: 'layout',
        label: 'Uploading',
        color: 'blue',
        clickable: false,
      }
    case 'active':
    case 'ready_for_layout':
      return {
        type: 'layout',
        label: 'Layout: Annotate',
        color: 'green',
        clickable: true,
        url: `/annotate/layout?videoId=${encodeURIComponent(videoId)}`,
      }
    case 'layout_complete':
    case 'ready_for_boundaries':
      return {
        type: 'boundaries',
        label: 'Boundaries: Annotate',
        color: 'green',
        clickable: true,
        url: `/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`,
      }
    case 'boundaries_complete':
      return {
        type: 'text',
        label: 'Text: Review',
        color: 'yellow',
        clickable: true,
        url: `/annotate/text?videoId=${encodeURIComponent(videoId)}`,
      }
    case 'complete':
      return {
        type: 'fully-annotated',
        label: 'Fully Annotated',
        color: 'teal',
        clickable: false,
      }
    case 'error':
    case 'failed':
      return {
        type: 'error',
        label: 'Error',
        color: 'red',
        clickable: true,
        errorDetails: {
          message: 'Processing failed',
          context: { videoId, status },
        },
      }
    default:
      // Unknown or null status - show as processing
      return {
        type: 'layout',
        label: 'Processing',
        color: 'purple',
        clickable: false,
      }
  }
}

/**
 * Get video statistics from Supabase
 */
export async function getVideoStats(videoId: string): Promise<VideoStats> {
  console.log(`[getVideoStats] CALLED for videoId: ${videoId}`)

  const supabase = createServerSupabaseClient()

  // Query video from Supabase
  const { data: video, error } = await supabase
    .from('videos')
    .select('id, status, current_cropped_frames_version')
    .eq('id', videoId)
    .is('deleted_at', null)
    .single()

  if (error || !video) {
    console.log(`[getVideoStats] Video not found in Supabase: ${videoId}`, error)
    return createEmptyStats([
      {
        type: 'error',
        label: 'Not Found',
        color: 'red',
        clickable: true,
        errorDetails: {
          message: 'Video not found',
          context: { videoId, error: error?.message },
        },
      },
    ])
  }

  // Get badge based on status
  const badge = statusToBadge(video.status, videoId)

  // For now, return basic stats with the status badge
  // Full annotation stats will require downloading the annotations DB from Wasabi
  const stats = createEmptyStats([badge])

  // Set flags based on status
  if (video.status === 'ready_for_layout' || video.status === 'layout_complete') {
    stats.hasOcrData = true
  }
  if (
    video.status === 'layout_complete' ||
    video.status === 'ready_for_boundaries' ||
    video.status === 'boundaries_complete' ||
    video.status === 'complete'
  ) {
    stats.layoutApproved = true
  }

  console.log(`[getVideoStats] Returning stats for ${videoId}:`, JSON.stringify(stats, null, 2))
  return stats
}
