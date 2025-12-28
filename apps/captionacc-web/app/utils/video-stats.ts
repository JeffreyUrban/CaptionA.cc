import { resolve } from 'path'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import Database from 'better-sqlite3'
import { getDbPath, getVideoDir } from './video-paths'

export type BadgeState = {
  type: 'layout' | 'boundaries' | 'text' | 'fully-annotated'
  label: string
  color: 'blue' | 'indigo' | 'purple' | 'yellow' | 'green' | 'teal'
  clickable: boolean
  url?: string
}

export interface CropFramesStatus {
  status: 'queued' | 'processing' | 'complete' | 'error'
  processingStartedAt?: string
  processingCompletedAt?: string
  errorMessage?: string
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
  hasOcrData: boolean  // Whether video has full_frame_ocr data (enables layout annotation)
  layoutApproved: boolean  // Whether layout annotation has been approved (gate for boundary annotation)
  processingStatus?: ProcessingStatus  // Upload/processing status (null if not uploaded via web)
  cropFramesStatus?: CropFramesStatus  // Crop frames processing status
  boundaryPendingReview: number  // Boundaries pending review
  textPendingReview: number  // Text annotations pending review
  databaseId?: string  // Unique ID that changes when database is recreated (for cache invalidation)
  badges: BadgeState[]  // Calculated badge states for display
}

export interface ProcessingStatus {
  status: 'uploading' | 'upload_complete' | 'extracting_frames' | 'running_ocr' | 'analyzing_layout' | 'processing_complete' | 'error'
  uploadProgress: number
  frameExtractionProgress: number
  ocrProgress: number
  layoutAnalysisProgress: number
  errorMessage?: string
  uploadStartedAt?: string
  uploadCompletedAt?: string
  processingStartedAt?: string
  processingCompletedAt?: string
}

/**
 * Calculate badge states based on video stats
 * Returns array of badges to display (empty if fully annotated)
 */
function calculateBadges(stats: Omit<VideoStats, 'badges'>, videoId: string): BadgeState[] {
  const badges: BadgeState[] = []

  // Layout Track
  const layoutBadge = calculateLayoutBadge(stats, videoId)
  if (layoutBadge) badges.push(layoutBadge)

  // Boundaries Track
  const boundariesBadge = calculateBoundariesBadge(stats, videoId)
  if (boundariesBadge) badges.push(boundariesBadge)

  // Text Track
  const textBadge = calculateTextBadge(stats, videoId)
  if (textBadge) badges.push(textBadge)

  // If all tracks complete, show Fully Annotated badge
  if (badges.length === 0) {
    badges.push({
      type: 'fully-annotated',
      label: 'Fully Annotated',
      color: 'teal',
      clickable: false
    })
  }

  return badges
}

function calculateLayoutBadge(stats: Omit<VideoStats, 'badges'>, videoId: string): BadgeState | null {
  const ps = stats.processingStatus

  // Priority 1: System processing
  if (ps) {
    if (ps.status === 'uploading') {
      return { type: 'layout', label: 'Uploading', color: 'blue', clickable: false }
    }
    if (ps.status === 'upload_complete') {
      return { type: 'layout', label: 'Queued', color: 'blue', clickable: false }
    }
    if (ps.status === 'extracting_frames') {
      return { type: 'layout', label: 'Layout: Framing', color: 'indigo', clickable: false }
    }
    if (ps.status === 'running_ocr') {
      return { type: 'layout', label: 'Layout: Running OCR', color: 'purple', clickable: false }
    }
    if (ps.status === 'analyzing_layout') {
      return { type: 'layout', label: 'Layout: Analyzing', color: 'purple', clickable: false }
    }
  }

  // Priority 2: Revisit (TODO: need to detect if predicted bounds changed)
  // For now, skipping this state until we implement predicted bounds tracking

  // Priority 3: Annotate (ready for first-time annotation)
  if (stats.hasOcrData && !stats.layoutApproved) {
    return {
      type: 'layout',
      label: 'Layout: Annotate',
      color: 'green',
      clickable: true,
      url: `/annotate/layout?videoId=${encodeURIComponent(videoId)}`
    }
  }

  // Hide if layout approved and predictions unchanged
  return null
}

function calculateBoundariesBadge(stats: Omit<VideoStats, 'badges'>, videoId: string): BadgeState | null {
  // Hide if waiting for layout approval
  if (!stats.layoutApproved) {
    return null
  }

  const cfs = stats.cropFramesStatus

  // Priority 1: System processing
  if (cfs) {
    if (cfs.status === 'processing') {
      // Determine which step based on whether we have crop frames
      if (stats.totalFrames === 0) {
        return { type: 'boundaries', label: 'Boundaries: Framing', color: 'indigo', clickable: false }
      } else {
        return { type: 'boundaries', label: 'Boundaries: Running OCR', color: 'purple', clickable: false }
      }
    }
  }

  // Priority 2: Annotate (has gap annotations that need marking)
  if (stats.gapAnnotations > 0) {
    return {
      type: 'boundaries',
      label: 'Boundaries: Annotate',
      color: 'green',
      clickable: true,
      url: `/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`
    }
  }

  // Priority 3: Review (no gaps, but has pending review)
  if (stats.boundaryPendingReview > 0) {
    return {
      type: 'boundaries',
      label: 'Boundaries: Review',
      color: 'yellow',
      clickable: true,
      url: `/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`
    }
  }

  // Hide if no gaps and none pending review
  return null
}

function calculateTextBadge(stats: Omit<VideoStats, 'badges'>, videoId: string): BadgeState | null {
  // Hide if waiting for boundaries (no annotations yet, or all are gaps)
  const nonGapAnnotations = stats.totalAnnotations - stats.gapAnnotations
  if (nonGapAnnotations === 0) {
    return null
  }

  // Priority 1: Review (has text pending review)
  if (stats.textPendingReview > 0) {
    return {
      type: 'text',
      label: 'Text: Review',
      color: 'yellow',
      clickable: true,
      url: `/annotate/text?videoId=${encodeURIComponent(videoId)}`
    }
  }

  // Hide if none pending review (all text complete)
  return null
}

export async function getVideoStats(videoId: string): Promise<VideoStats> {
  // Resolve videoId (can be display_path or UUID) to database path
  const dbPath = getDbPath(videoId)
  console.log(`[getVideoStats] videoId: ${videoId}, dbPath: ${dbPath}`)
  if (!dbPath) {
    // Video not found - return default stats
    console.log(`[getVideoStats] Database not found for ${videoId}`)
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
      badges: []
    }
  }

  // Get video directory for accessing crop_frames
  const videoDir = getVideoDir(videoId)
  const framesDir = videoDir ? resolve(videoDir, 'crop_frames') : null

  let totalFrames = 0
  if (framesDir && existsSync(framesDir)) {
    const files = await readdir(framesDir)
    totalFrames = files.filter(f => f.startsWith('frame_') && f.endsWith('.jpg')).length
  }

  const db = new Database(dbPath, { readonly: true })

  try {
    const result = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN boundary_pending = 1 THEN 1 ELSE 0 END) as boundary_pending,
        SUM(CASE WHEN text_pending = 1 THEN 1 ELSE 0 END) as text_pending,
        SUM(CASE WHEN boundary_state = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN boundary_state = 'predicted' THEN 1 ELSE 0 END) as predicted,
        SUM(CASE WHEN boundary_state = 'gap' THEN 1 ELSE 0 END) as gaps
      FROM captions
    `).get() as {
      total: number
      boundary_pending: number
      text_pending: number
      confirmed: number
      predicted: number
      gaps: number
    }

    // Calculate frame coverage for non-gap, non-pending captions
    const frameCoverage = db.prepare(`
      SELECT
        SUM(end_frame_index - start_frame_index + 1) as covered_frames
      FROM captions
      WHERE boundary_state != 'gap' AND boundary_pending = 0
    `).get() as { covered_frames: number | null }

    // Calculate progress as percentage of frames that are not gap or pending
    const coveredFrames = frameCoverage.covered_frames || 0
    const progress = totalFrames > 0
      ? Math.round((coveredFrames / totalFrames) * 100)
      : 0

    // Check if video has OCR data (full_frame_ocr table with rows)
    let hasOcrData = false
    try {
      const ocrCount = db.prepare(`SELECT COUNT(*) as count FROM full_frame_ocr LIMIT 1`).get() as { count: number } | undefined
      hasOcrData = (ocrCount?.count ?? 0) > 0
    } catch {
      // Table doesn't exist
      hasOcrData = false
    }

    // Check if layout annotation has been approved
    let layoutApproved = false
    try {
      const prefs = db.prepare(`SELECT layout_approved FROM video_preferences WHERE id = 1`).get() as { layout_approved: number } | undefined
      layoutApproved = (prefs?.layout_approved ?? 0) === 1
    } catch {
      // Table or column doesn't exist
      layoutApproved = false
    }

    // Get processing status if available
    let processingStatus: ProcessingStatus | undefined
    try {
      const status = db.prepare(`SELECT * FROM processing_status WHERE id = 1`).get() as any
      console.log(`[getVideoStats] Processing status for ${videoId}:`, status)
      if (status) {
        // Check if video is marked as deleted
        if (status.deleted === 1) {
          // Return default stats for deleted videos (not null)
          console.log(`[getVideoStats] Video ${videoId} is marked as deleted`)
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
            badges: []
          }
        }

        processingStatus = {
          status: status.status,
          uploadProgress: status.upload_progress ?? 0,
          frameExtractionProgress: status.frame_extraction_progress ?? 0,
          ocrProgress: status.ocr_progress ?? 0,
          layoutAnalysisProgress: status.layout_analysis_progress ?? 0,
          errorMessage: status.error_message,
          uploadStartedAt: status.upload_started_at,
          uploadCompletedAt: status.upload_completed_at,
          processingStartedAt: status.processing_started_at,
          processingCompletedAt: status.processing_completed_at,
        }
      }
    } catch (error) {
      // Table doesn't exist (video not uploaded via web)
      console.log(`[getVideoStats] No processing_status table for ${videoId}:`, error)
      processingStatus = undefined
    }

    // Get crop_frames processing status
    let cropFramesStatus: CropFramesStatus | undefined
    try {
      const status = db.prepare(`SELECT * FROM crop_frames_status WHERE id = 1`).get() as any
      if (status) {
        cropFramesStatus = {
          status: status.status,
          processingStartedAt: status.processing_started_at,
          processingCompletedAt: status.processing_completed_at,
          errorMessage: status.error_message
        }
      }
    } catch {
      // Table doesn't exist
      cropFramesStatus = undefined
    }

    // Get database_id for cache invalidation
    let databaseId: string | undefined
    try {
      const metadata = db.prepare(`SELECT database_id FROM video_metadata WHERE id = 1`).get() as { database_id: string } | undefined
      databaseId = metadata?.database_id
    } catch {
      // Column doesn't exist in older databases
      databaseId = undefined
    }

    const stats: VideoStats = {
      totalAnnotations: result.total,
      pendingReview: result.boundary_pending + result.text_pending,
      confirmedAnnotations: result.confirmed,
      predictedAnnotations: result.predicted,
      gapAnnotations: result.gaps,
      progress,
      totalFrames,
      coveredFrames,
      hasOcrData,
      layoutApproved,
      processingStatus,
      cropFramesStatus,
      boundaryPendingReview: result.boundary_pending,
      textPendingReview: result.text_pending,
      databaseId,
      badges: calculateBadges({
        totalAnnotations: result.total,
        pendingReview: result.boundary_pending + result.text_pending,
        confirmedAnnotations: result.confirmed,
        predictedAnnotations: result.predicted,
        gapAnnotations: result.gaps,
        progress,
        totalFrames,
        coveredFrames,
        hasOcrData,
        layoutApproved,
        processingStatus,
        cropFramesStatus,
        boundaryPendingReview: result.boundary_pending,
        textPendingReview: result.text_pending,
        databaseId
      }, videoId)
    }
    console.log(`[getVideoStats] Returning stats for ${videoId}:`, JSON.stringify(stats, null, 2))
    return stats
  } finally {
    db.close()
  }
}
