import Database from 'better-sqlite3'

import { getDbPath } from './video-paths'

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
  hasOcrData: boolean // Whether video has full_frame_ocr data (enables layout annotation)
  layoutApproved: boolean // Whether layout annotation has been approved (gate for boundary annotation)
  processingStatus?: ProcessingStatus // Upload/processing status (null if not uploaded via web)
  cropFramesStatus?: CropFramesStatus // Crop frames processing status
  boundaryPendingReview: number // Boundaries pending review
  textPendingReview: number // Text annotations pending review
  databaseId?: string // Unique ID that changes when database is recreated (for cache invalidation)
  badges: BadgeState[] // Calculated badge states for display
}

export interface ProcessingStatus {
  status:
    | 'uploading'
    | 'upload_complete'
    | 'extracting_frames'
    | 'running_ocr'
    | 'analyzing_layout'
    | 'processing_complete'
    | 'error'
  uploadProgress: number
  frameExtractionProgress: number
  ocrProgress: number
  layoutAnalysisProgress: number
  errorMessage?: string
  errorDetails?: string
  uploadStartedAt?: string
  uploadCompletedAt?: string
  processingStartedAt?: string
  processingCompletedAt?: string
}

/**
 * Stage-specific error information
 */
interface StageErrors {
  boundaries?: { message: string; stack?: string }
  text?: { message: string; stack?: string }
}

/**
 * Calculate badge states based on video stats
 * Returns array of badges to display
 */
function calculateBadges(
  stats: Omit<VideoStats, 'badges'>,
  videoId: string,
  db: Database.Database,
  stageErrors: StageErrors = {}
): BadgeState[] {
  const badges: BadgeState[] = []

  // Layout Track
  const layoutBadge = calculateLayoutBadge(stats, videoId, db)
  if (layoutBadge) badges.push(layoutBadge)

  // Boundaries Track
  const boundariesBadge = calculateBoundariesBadge(stats, videoId, stageErrors.boundaries)
  if (boundariesBadge) badges.push(boundariesBadge)

  // Text Track
  const textBadge = calculateTextBadge(stats, videoId, stageErrors.text)
  if (textBadge) badges.push(textBadge)

  // If all tracks complete (and video is actually ready for annotation), show Fully Annotated
  if (badges.length === 0) {
    const isReady = isVideoReadyForAnnotation(stats)
    console.log(
      `[calculateBadges] ${videoId}: No badges, isReady=${isReady}, hasOcrData=${stats.hasOcrData}, layoutApproved=${stats.layoutApproved}, totalAnnotations=${stats.totalAnnotations}`
    )

    if (isReady) {
      badges.push({
        type: 'fully-annotated',
        label: 'Fully Annotated',
        color: 'teal',
        clickable: false,
      })
    }
  } else {
    console.log(
      `[calculateBadges] ${videoId}: ${badges.length} badges:`,
      badges.map(b => b.label).join(', ')
    )
  }

  return badges
}

/**
 * Check if video is in a state where annotation could have happened
 * (as opposed to just not having any badges because it's not ready yet)
 */
function isVideoReadyForAnnotation(stats: Omit<VideoStats, 'badges'>): boolean {
  // Must have OCR data (layout phase complete)
  if (!stats.hasOcrData) return false

  // Must have layout approved (boundaries phase unlocked)
  if (!stats.layoutApproved) return false

  // Must have some annotations (not just empty)
  if (stats.totalAnnotations === 0) return false

  return true
}

function calculateLayoutBadge(
  stats: Omit<VideoStats, 'badges'>,
  videoId: string,
  db: Database.Database
): BadgeState | null {
  const ps = stats.processingStatus

  // State 0: No processing status (video created outside upload flow or database incomplete)
  if (!ps && !stats.hasOcrData) {
    return {
      type: 'error',
      label: 'Layout: Error',
      color: 'red',
      clickable: true,
      errorDetails: {
        message:
          'Video has no processing status. May need to be processed manually or re-uploaded.',
        context: {
          videoId,
          stage: 'layout',
          issue: 'no_processing_status',
        },
      },
    }
  }

  // State 1: Error during processing
  if (ps?.status === 'error') {
    // Special handling for "No valid boxes found" - not a real error
    if (ps.errorDetails?.includes('No valid boxes found')) {
      // Check if there are any OCR boxes at all
      const boxCount = db.prepare(`SELECT COUNT(*) as count FROM full_frame_ocr`).get() as
        | { count: number }
        | undefined
      const totalBoxes = boxCount?.count || 0

      if (totalBoxes === 0) {
        // Zero boxes - informational, not an error
        return {
          type: 'info',
          label: 'No Text Detected',
          color: 'gray',
          clickable: false,
        }
      } else {
        // Some boxes but insufficient for layout analysis - needs review
        return {
          type: 'warning',
          label: 'Layout: Review',
          color: 'yellow',
          clickable: true,
          url: `/annotate/layout/review?videoId=${encodeURIComponent(videoId)}`,
        }
      }
    }

    // Other errors - actual processing failures
    return {
      type: 'error',
      label: 'Layout: Error',
      color: 'red',
      clickable: true,
      errorDetails: {
        message: ps.errorMessage || 'Processing failed',
        context: {
          videoId,
          stage: 'layout',
          processingStatus: ps.status,
        },
      },
    }
  }

  // State 2: Uploading
  if (ps?.status === 'uploading') {
    return { type: 'layout', label: 'Uploading', color: 'blue', clickable: false }
  }

  // State 3: Queued for processing
  if (ps?.status === 'upload_complete') {
    return { type: 'layout', label: 'Queued', color: 'blue', clickable: false }
  }

  // State 4: Extracting frames
  if (ps?.status === 'extracting_frames') {
    return { type: 'layout', label: 'Layout: Framing', color: 'indigo', clickable: false }
  }

  // State 5: Running OCR
  if (ps?.status === 'running_ocr') {
    return { type: 'layout', label: 'Layout: Running OCR', color: 'purple', clickable: false }
  }

  // State 6: Analyzing layout
  if (ps?.status === 'analyzing_layout') {
    return { type: 'layout', label: 'Layout: Analyzing', color: 'purple', clickable: false }
  }

  // State 7: Processing complete but no OCR data (processing failed silently)
  if (ps?.status === 'processing_complete' && !stats.hasOcrData) {
    return {
      type: 'error',
      label: 'Layout: Error',
      color: 'red',
      clickable: true,
      errorDetails: {
        message: 'Processing completed but no OCR data was generated',
        context: {
          videoId,
          stage: 'layout',
          issue: 'empty_ocr_results',
        },
      },
    }
  }

  // State 8: Ready for annotation (has OCR data, not yet approved)
  if (stats.hasOcrData && !stats.layoutApproved) {
    return {
      type: 'layout',
      label: 'Layout: Annotate',
      color: 'green',
      clickable: true,
      url: `/annotate/layout?videoId=${encodeURIComponent(videoId)}`,
    }
  }

  // Layout stage complete (layoutApproved = true)
  return null
}

function calculateBoundariesBadge(
  stats: Omit<VideoStats, 'badges'>,
  videoId: string,
  error?: { message: string; stack?: string }
): BadgeState | null {
  // Priority 0: Error (show if this stage has a data error)
  if (error) {
    return {
      type: 'error',
      label: 'Boundaries: Error',
      color: 'red',
      clickable: true,
      errorDetails: {
        message: error.message,
        stack: error.stack,
        context: {
          videoId,
          stage: 'boundaries',
          errorType: 'SqliteError',
        },
      },
    }
  }

  // Hide if waiting for layout approval
  if (!stats.layoutApproved) {
    return null
  }

  const cfs = stats.cropFramesStatus

  // Priority 1: Processing error (failed or interrupted)
  if (cfs?.status === 'error') {
    return {
      type: 'error',
      label: 'Boundaries: Error',
      color: 'red',
      clickable: true,
      errorDetails: {
        message: cfs.errorMessage || 'Crop frames processing failed',
        context: {
          videoId,
          stage: 'boundaries',
          issue: 'crop_frames_failed',
        },
      },
    }
  }

  // Priority 2: Queued for processing
  if (cfs?.status === 'queued') {
    return { type: 'boundaries', label: 'Boundaries: Queued', color: 'blue', clickable: false }
  }

  // Priority 3: Currently processing
  if (cfs?.status === 'processing') {
    // Determine which step based on whether we have crop frames
    if (stats.totalFrames === 0) {
      return { type: 'boundaries', label: 'Boundaries: Framing', color: 'indigo', clickable: false }
    } else {
      return {
        type: 'boundaries',
        label: 'Boundaries: Running OCR',
        color: 'purple',
        clickable: false,
      }
    }
  }

  // Priority 4: Processing completed but no cropped frames created (processing failed)
  // Note: Having 0 captions is expected initially - that's not an error
  if (cfs?.status === 'complete' && stats.totalFrames === 0) {
    return {
      type: 'error',
      label: 'Boundaries: Error',
      color: 'red',
      clickable: true,
      errorDetails: {
        message: 'Crop frames processing completed but no frames were created',
        context: {
          videoId,
          stage: 'boundaries',
          issue: 'no_frames_created',
        },
      },
    }
  }

  // Priority 5: Ready to annotate (crop frames complete with frames, but no captions yet)
  if (cfs?.status === 'complete' && stats.totalFrames > 0 && stats.totalAnnotations === 0) {
    console.log(
      `[calculateBoundariesBadge] ${videoId}: Showing Boundaries: Annotate (frames=${stats.totalFrames}, annotations=${stats.totalAnnotations})`
    )
    return {
      type: 'boundaries',
      label: 'Boundaries: Annotate',
      color: 'green',
      clickable: true,
      url: `/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`,
    }
  }

  // Debug: Log why we're not showing the annotate badge
  if (cfs?.status === 'complete') {
    console.log(
      `[calculateBoundariesBadge] ${videoId}: crop_frames complete but not showing badge - frames=${stats.totalFrames}, annotations=${stats.totalAnnotations}, cfs=${JSON.stringify(cfs)}`
    )
  }

  // Priority 6: Incomplete (progress < 100% means there are unannotated frames)
  if (stats.progress < 100) {
    return {
      type: 'boundaries',
      label: 'Boundaries: Annotate',
      color: 'green',
      clickable: true,
      url: `/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`,
    }
  }

  // Priority 7: Review (progress is 100%, but has pending review)
  if (stats.boundaryPendingReview > 0) {
    return {
      type: 'boundaries',
      label: 'Boundaries: Review',
      color: 'yellow',
      clickable: true,
      url: `/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`,
    }
  }

  // Boundaries complete (progress = 100%, all confirmed, no pending)
  return null
}

function calculateTextBadge(
  stats: Omit<VideoStats, 'badges'>,
  videoId: string,
  error?: { message: string; stack?: string }
): BadgeState | null {
  // Priority 0: Error (show if this stage has a data error)
  if (error) {
    return {
      type: 'error',
      label: 'Text: Error',
      color: 'red',
      clickable: true,
      errorDetails: {
        message: error.message,
        stack: error.stack,
        context: {
          videoId,
          stage: 'text',
          errorType: 'SqliteError',
        },
      },
    }
  }

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
      url: `/annotate/text?videoId=${encodeURIComponent(videoId)}`,
    }
  }

  // Hide if none pending review (all text complete)
  return null
}

export async function getVideoStats(videoId: string): Promise<VideoStats> {
  console.log(`[getVideoStats] CALLED for videoId: ${videoId}`)

  // Resolve videoId (can be display_path or UUID) to database path
  const dbPath = getDbPath(videoId)
  console.log(`[getVideoStats] videoId: ${videoId}, dbPath: ${dbPath}`)
  if (!dbPath) {
    // Video directory exists but database is missing - this is an error state
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
      badges: [
        {
          type: 'error',
          label: 'Layout: Error',
          color: 'red',
          clickable: true,
          errorDetails: {
            message: 'Database file not found',
            context: {
              videoId,
              stage: 'layout',
              issue: 'missing_database',
            },
          },
        },
      ],
    }
  }

  const db = new Database(dbPath, { readonly: true })

  // Count cropped frames from database (not filesystem)
  // Frames are written to DB and filesystem is cleaned up after processing
  let totalFrames = 0
  try {
    const frameCount = db.prepare(`SELECT COUNT(*) as count FROM cropped_frames`).get() as
      | { count: number }
      | undefined
    totalFrames = frameCount?.count ?? 0
  } catch {
    // Table doesn't exist yet
    totalFrames = 0
  }

  try {
    // Track stage-specific errors
    const stageErrors: StageErrors = {}

    // Query basic stats (always works - uses columns that exist in all schemas)
    const basicResult = db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN boundary_state = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN boundary_state = 'predicted' THEN 1 ELSE 0 END) as predicted,
        SUM(CASE WHEN boundary_state = 'gap' THEN 1 ELSE 0 END) as gaps
      FROM captions
    `
      )
      .get() as {
      total: number
      confirmed: number
      predicted: number
      gaps: number
    }

    // Query boundary-specific data (might fail if boundary_pending column missing)
    let boundaryPendingReview = 0
    try {
      const boundaryResult = db
        .prepare(
          `
        SELECT SUM(CASE WHEN boundary_pending = 1 THEN 1 ELSE 0 END) as boundary_pending
        FROM captions
      `
        )
        .get() as { boundary_pending: number }
      boundaryPendingReview = boundaryResult.boundary_pending || 0
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined
      console.error(`[getVideoStats] Error querying boundary_pending for ${videoId}:`, error)
      stageErrors.boundaries = {
        message: errorMessage,
        stack: errorStack,
      }
    }

    // Query text-specific data (might fail if text_pending column missing)
    let textPendingReview = 0
    try {
      const textResult = db
        .prepare(
          `
        SELECT SUM(CASE WHEN text_pending = 1 THEN 1 ELSE 0 END) as text_pending
        FROM captions
      `
        )
        .get() as { text_pending: number }
      textPendingReview = textResult.text_pending || 0
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined
      console.error(`[getVideoStats] Error querying text_pending for ${videoId}:`, error)
      stageErrors.text = {
        message: errorMessage,
        stack: errorStack,
      }
    }

    // Calculate frame coverage for non-gap, non-pending captions
    // This might fail if boundary_pending is missing, but that's okay - we already tracked the error
    let coveredFrames = 0
    try {
      const frameCoverage = db
        .prepare(
          `
        SELECT
          SUM(end_frame_index - start_frame_index + 1) as covered_frames
        FROM captions
        WHERE boundary_state != 'gap' AND boundary_pending = 0
      `
        )
        .get() as { covered_frames: number | null }
      coveredFrames = frameCoverage.covered_frames || 0
    } catch {
      // If this fails, it's likely due to missing boundary_pending column
      // We already tracked that error above, so just use 0 for coveredFrames
      coveredFrames = 0
    }

    // Calculate progress as percentage of frames that are not gap or pending
    const progress = totalFrames > 0 ? Math.round((coveredFrames / totalFrames) * 100) : 0

    // Check if video has OCR data (full_frame_ocr table with rows)
    let hasOcrData = false
    try {
      const ocrCount = db.prepare(`SELECT COUNT(*) as count FROM full_frame_ocr LIMIT 1`).get() as
        | { count: number }
        | undefined
      hasOcrData = (ocrCount?.count ?? 0) > 0
    } catch {
      // Table doesn't exist
      hasOcrData = false
    }

    // Check if layout annotation has been approved
    let layoutApproved = false
    try {
      const prefs = db
        .prepare(`SELECT layout_approved FROM video_preferences WHERE id = 1`)
        .get() as { layout_approved: number } | undefined
      layoutApproved = (prefs?.layout_approved ?? 0) === 1
    } catch {
      // Table or column doesn't exist
      layoutApproved = false
    }

    // Get processing status if available
    let processingStatus: ProcessingStatus | undefined
    try {
      const status = db.prepare(`SELECT * FROM processing_status WHERE id = 1`).get() as
        | {
            status: string
            upload_progress?: number
            frame_extraction_progress?: number
            ocr_progress?: number
            layout_analysis_progress?: number
            error_message?: string
            error_details?: string
            upload_started_at?: string
            upload_completed_at?: string
            processing_started_at?: string
            processing_completed_at?: string
            deleted?: number
          }
        | undefined
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
            badges: [],
          }
        }

        processingStatus = {
          status: status.status as ProcessingStatus['status'],
          uploadProgress: status.upload_progress ?? 0,
          frameExtractionProgress: status.frame_extraction_progress ?? 0,
          ocrProgress: status.ocr_progress ?? 0,
          layoutAnalysisProgress: status.layout_analysis_progress ?? 0,
          errorMessage: status.error_message,
          errorDetails: status.error_details,
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
      const status = db.prepare(`SELECT * FROM crop_frames_status WHERE id = 1`).get() as
        | {
            status: string
            processing_started_at?: string
            processing_completed_at?: string
            error_message?: string
          }
        | undefined
      if (status) {
        cropFramesStatus = {
          status: status.status as CropFramesStatus['status'],
          processingStartedAt: status.processing_started_at,
          processingCompletedAt: status.processing_completed_at,
          errorMessage: status.error_message,
        }
      }
    } catch {
      // Table doesn't exist
      cropFramesStatus = undefined
    }

    // Get database_id for cache invalidation
    let databaseId: string | undefined
    try {
      const metadata = db.prepare(`SELECT database_id FROM video_metadata WHERE id = 1`).get() as
        | { database_id: string }
        | undefined
      databaseId = metadata?.database_id
    } catch {
      // Column doesn't exist in older databases
      databaseId = undefined
    }

    const stats: VideoStats = {
      totalAnnotations: basicResult.total,
      pendingReview: boundaryPendingReview + textPendingReview,
      confirmedAnnotations: basicResult.confirmed,
      predictedAnnotations: basicResult.predicted,
      gapAnnotations: basicResult.gaps,
      progress,
      totalFrames,
      coveredFrames,
      hasOcrData,
      layoutApproved,
      processingStatus,
      cropFramesStatus,
      boundaryPendingReview,
      textPendingReview,
      databaseId,
      badges: calculateBadges(
        {
          totalAnnotations: basicResult.total,
          pendingReview: boundaryPendingReview + textPendingReview,
          confirmedAnnotations: basicResult.confirmed,
          predictedAnnotations: basicResult.predicted,
          gapAnnotations: basicResult.gaps,
          progress,
          totalFrames,
          coveredFrames,
          hasOcrData,
          layoutApproved,
          processingStatus,
          cropFramesStatus,
          boundaryPendingReview,
          textPendingReview,
          databaseId,
        },
        videoId,
        db,
        stageErrors
      ),
    }
    console.log(`[getVideoStats] Returning stats for ${videoId}:`, JSON.stringify(stats, null, 2))
    return stats
  } catch (error) {
    // Return error badge when stats calculation fails
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    console.error(`[getVideoStats] Error for ${videoId}:`, error)

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
      badges: [
        {
          type: 'error',
          label: 'Layout: Error',
          color: 'red',
          clickable: true,
          errorDetails: {
            message: errorMessage,
            stack: errorStack,
            context: {
              videoId,
              stage: 'layout',
              errorType: error instanceof Error ? error.constructor.name : 'Unknown',
            },
          },
        },
      ],
    }
  } finally {
    db.close()
  }
}
