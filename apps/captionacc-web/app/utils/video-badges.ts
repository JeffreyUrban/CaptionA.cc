/**
 * Video Badge Calculation
 *
 * Calculates UI badges from Supabase video workflow columns.
 * All data comes from the videos table - no additional API calls needed.
 */

export type WorkflowStatus = 'wait' | 'annotate' | 'done' | 'review' | 'error'

export type BadgeState = {
  type: 'layout' | 'boundaries' | 'text' | 'processing' | 'complete' | 'error'
  label: string
  color: 'blue' | 'indigo' | 'purple' | 'yellow' | 'green' | 'teal' | 'red' | 'gray'
  clickable: boolean
  url?: string
  errorDetails?: {
    message: string
    details?: unknown
    stack?: string
    context?: Record<string, unknown>
  }
}

export interface VideoWorkflowData {
  id: string
  layout_status: WorkflowStatus
  boundaries_status: WorkflowStatus
  text_status: WorkflowStatus
  layout_error_details?: { message?: string; [key: string]: unknown } | null
  boundaries_error_details?: { message?: string; [key: string]: unknown } | null
  text_error_details?: { message?: string; [key: string]: unknown } | null
}

/**
 * Calculate badges for a video based on workflow status columns
 *
 * Rules:
 * - All 'wait' → Processing badge
 * - Any 'annotate'/'review'/'error' → show those badges (can be multiple)
 * - All 'done' → Complete badge
 */
export function calculateBadges(video: VideoWorkflowData): BadgeState[] {
  const badges: BadgeState[] = []

  const statuses = [
    video.layout_status,
    video.boundaries_status,
    video.text_status,
  ]

  // All done → Complete
  if (statuses.every(s => s === 'done')) {
    badges.push({
      type: 'complete',
      label: 'Complete',
      color: 'teal',
      clickable: false,
    })
    return badges
  }

  // All wait → Processing
  if (statuses.every(s => s === 'wait')) {
    badges.push({
      type: 'processing',
      label: 'Processing',
      color: 'gray',
      clickable: false,
    })
    return badges
  }

  // Layout badges
  if (video.layout_status === 'annotate') {
    badges.push({
      type: 'layout',
      label: 'Layout: Annotate',
      color: 'green',
      clickable: true,
      url: `/annotate/layout?videoId=${encodeURIComponent(video.id)}`,
    })
  } else if (video.layout_status === 'review') {
    badges.push({
      type: 'layout',
      label: 'Layout: Review',
      color: 'yellow',
      clickable: true,
      url: `/annotate/layout?videoId=${encodeURIComponent(video.id)}`,
    })
  } else if (video.layout_status === 'error') {
    badges.push({
      type: 'error',
      label: 'Layout: Error',
      color: 'red',
      clickable: true,
      errorDetails: {
        message: video.layout_error_details?.message || 'Layout processing error',
        details: video.layout_error_details,
      },
    })
  }

  // Boundaries badges
  if (video.boundaries_status === 'annotate') {
    badges.push({
      type: 'boundaries',
      label: 'Boundaries: Annotate',
      color: 'blue',
      clickable: true,
      url: `/annotate/boundaries?videoId=${encodeURIComponent(video.id)}`,
    })
  } else if (video.boundaries_status === 'review') {
    badges.push({
      type: 'boundaries',
      label: 'Boundaries: Review',
      color: 'yellow',
      clickable: true,
      url: `/annotate/boundaries?videoId=${encodeURIComponent(video.id)}`,
    })
  } else if (video.boundaries_status === 'error') {
    badges.push({
      type: 'error',
      label: 'Boundaries: Error',
      color: 'red',
      clickable: true,
      errorDetails: {
        message: video.boundaries_error_details?.message || 'Boundaries processing error',
        details: video.boundaries_error_details,
      },
    })
  }

  // Text badges
  if (video.text_status === 'annotate') {
    badges.push({
      type: 'text',
      label: 'Text: Annotate',
      color: 'purple',
      clickable: true,
      url: `/annotate/text?videoId=${encodeURIComponent(video.id)}`,
    })
  } else if (video.text_status === 'review') {
    badges.push({
      type: 'text',
      label: 'Text: Review',
      color: 'yellow',
      clickable: true,
      url: `/annotate/text?videoId=${encodeURIComponent(video.id)}`,
    })
  } else if (video.text_status === 'error') {
    badges.push({
      type: 'error',
      label: 'Text: Error',
      color: 'red',
      clickable: true,
      errorDetails: {
        message: video.text_error_details?.message || 'Text processing error',
        details: video.text_error_details,
      },
    })
  }

  return badges
}

/**
 * Calculate action menu items based on workflow status
 */
export function calculateMenuActions(video: VideoWorkflowData): Array<{
  label: string
  url: string
  enabled: boolean
}> {
  return [
    {
      label: 'Annotate Layout',
      url: `/annotate/layout?videoId=${encodeURIComponent(video.id)}`,
      enabled: video.layout_status === 'annotate' || video.layout_status === 'review',
    },
    {
      label: 'Annotate Boundaries',
      url: `/annotate/boundaries?videoId=${encodeURIComponent(video.id)}`,
      enabled: video.boundaries_status === 'annotate' || video.boundaries_status === 'review',
    },
    {
      label: 'Annotate Text',
      url: `/annotate/text?videoId=${encodeURIComponent(video.id)}`,
      enabled: video.text_status === 'annotate' || video.text_status === 'review',
    },
  ]
}
