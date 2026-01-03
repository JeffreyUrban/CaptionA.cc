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
 * Create an empty/error VideoStats object with the specified badges
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
 * Create an error badge for missing database
 */
function createMissingDatabaseBadge(videoId: string): BadgeState {
  return {
    type: 'error',
    label: 'Layout: Error',
    color: 'red',
    clickable: true,
    errorDetails: {
      message: 'Database file not found',
      context: { videoId, stage: 'layout', issue: 'missing_database' },
    },
  }
}

/**
 * Query count of cropped frames from database
 */
function queryTotalFrames(db: Database.Database): number {
  try {
    const frameCount = db.prepare(`SELECT COUNT(*) as count FROM cropped_frames`).get() as
      | { count: number }
      | undefined
    return frameCount?.count ?? 0
  } catch {
    return 0
  }
}

/**
 * Query basic caption stats from database
 */
function queryBasicStats(db: Database.Database): {
  total: number
  confirmed: number
  predicted: number
  gaps: number
} {
  return db
    .prepare(
      `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN boundary_state = 'confirmed' OR boundary_state = 'issue' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN boundary_state = 'predicted' THEN 1 ELSE 0 END) as predicted,
        SUM(CASE WHEN boundary_state = 'gap' THEN 1 ELSE 0 END) as gaps
      FROM captions
    `
    )
    .get() as { total: number; confirmed: number; predicted: number; gaps: number }
}

/**
 * Query boundary pending count, recording errors to stageErrors
 */
function queryBoundaryPending(
  db: Database.Database,
  videoId: string,
  stageErrors: StageErrors
): number {
  try {
    const result = db
      .prepare(
        `SELECT SUM(CASE WHEN boundary_pending = 1 THEN 1 ELSE 0 END) as boundary_pending FROM captions`
      )
      .get() as { boundary_pending: number }
    return result.boundary_pending || 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error(`[getVideoStats] Error querying boundary_pending for ${videoId}:`, error)
    stageErrors.boundaries = { message: errorMessage, stack: errorStack }
    return 0
  }
}

/**
 * Query text pending count, recording errors to stageErrors
 */
function queryTextPending(
  db: Database.Database,
  videoId: string,
  stageErrors: StageErrors
): number {
  try {
    const result = db
      .prepare(
        `SELECT SUM(CASE WHEN text_pending = 1 THEN 1 ELSE 0 END) as text_pending FROM captions`
      )
      .get() as { text_pending: number }
    return result.text_pending || 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error(`[getVideoStats] Error querying text_pending for ${videoId}:`, error)
    stageErrors.text = { message: errorMessage, stack: errorStack }
    return 0
  }
}

/**
 * Query covered frames count (frames that are confirmed/predicted, not gaps or pending)
 */
function queryCoveredFrames(db: Database.Database): number {
  try {
    const result = db
      .prepare(
        `SELECT SUM(end_frame_index - start_frame_index + 1) as covered_frames FROM captions WHERE boundary_state != 'gap' AND boundary_state != 'issue' AND boundary_pending = 0`
      )
      .get() as { covered_frames: number | null }
    return result.covered_frames ?? 0
  } catch {
    return 0
  }
}

/**
 * Query whether video has OCR data
 */
function queryHasOcrData(db: Database.Database): boolean {
  try {
    const result = db.prepare(`SELECT COUNT(*) as count FROM full_frame_ocr LIMIT 1`).get() as
      | { count: number }
      | undefined
    return (result?.count ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * Query whether layout has been approved
 */
function queryLayoutApproved(db: Database.Database): boolean {
  try {
    const result = db
      .prepare(`SELECT layout_approved FROM video_preferences WHERE id = 1`)
      .get() as { layout_approved: number } | undefined
    return (result?.layout_approved ?? 0) === 1
  } catch {
    return false
  }
}

/**
 * Raw processing status row from database
 */
interface ProcessingStatusRow {
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

/**
 * Query processing status from database
 * Returns null if table doesn't exist or video is marked as deleted
 */
function queryProcessingStatus(
  db: Database.Database,
  videoId: string
): { status: ProcessingStatus | undefined; isDeleted: boolean } {
  try {
    const row = db.prepare(`SELECT * FROM processing_status WHERE id = 1`).get() as
      | ProcessingStatusRow
      | undefined
    console.log(`[getVideoStats] Processing status for ${videoId}:`, row)

    if (!row) {
      return { status: undefined, isDeleted: false }
    }

    if (row.deleted === 1) {
      console.log(`[getVideoStats] Video ${videoId} is marked as deleted`)
      return { status: undefined, isDeleted: true }
    }

    return {
      isDeleted: false,
      status: {
        status: row.status as ProcessingStatus['status'],
        uploadProgress: row.upload_progress ?? 0,
        frameExtractionProgress: row.frame_extraction_progress ?? 0,
        ocrProgress: row.ocr_progress ?? 0,
        layoutAnalysisProgress: row.layout_analysis_progress ?? 0,
        errorMessage: row.error_message,
        errorDetails: row.error_details,
        uploadStartedAt: row.upload_started_at,
        uploadCompletedAt: row.upload_completed_at,
        processingStartedAt: row.processing_started_at,
        processingCompletedAt: row.processing_completed_at,
      },
    }
  } catch (error) {
    console.log(`[getVideoStats] No processing_status table for ${videoId}:`, error)
    return { status: undefined, isDeleted: false }
  }
}

/**
 * Query crop frames status from database
 */
function queryCropFramesStatus(db: Database.Database): CropFramesStatus | undefined {
  try {
    const row = db.prepare(`SELECT * FROM crop_frames_status WHERE id = 1`).get() as
      | {
          status: string
          processing_started_at?: string
          processing_completed_at?: string
          error_message?: string
        }
      | undefined
    if (!row) return undefined
    return {
      status: row.status as CropFramesStatus['status'],
      processingStartedAt: row.processing_started_at,
      processingCompletedAt: row.processing_completed_at,
      errorMessage: row.error_message,
    }
  } catch {
    return undefined
  }
}

/**
 * Query database ID for cache invalidation
 */
function queryDatabaseId(db: Database.Database): string | undefined {
  try {
    const result = db.prepare(`SELECT database_id FROM video_metadata WHERE id = 1`).get() as
      | { database_id: string }
      | undefined
    return result?.database_id
  } catch {
    return undefined
  }
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
 * Create an error badge for layout stage
 */
function createLayoutErrorBadge(
  videoId: string,
  message: string,
  issue: string,
  extra?: Record<string, unknown>
): BadgeState {
  return {
    type: 'error',
    label: 'Layout: Error',
    color: 'red',
    clickable: true,
    errorDetails: {
      message,
      context: {
        videoId,
        stage: 'layout',
        issue,
        ...extra,
      },
    },
  }
}

/**
 * Create a layout status badge (non-error, non-clickable)
 */
function createLayoutStatusBadge(label: string, color: BadgeState['color']): BadgeState {
  return { type: 'layout', label, color, clickable: false }
}

/**
 * Handle processing error state for layout badge
 * Returns null if not an error state
 */
function handleLayoutProcessingError(
  ps: ProcessingStatus,
  videoId: string,
  db: Database.Database
): BadgeState | null {
  if (ps.status !== 'error') return null

  // Special handling for "No valid boxes found" - not a real error
  if (ps.errorDetails?.includes('No valid boxes found')) {
    const boxCount = db.prepare(`SELECT COUNT(*) as count FROM full_frame_ocr`).get() as
      | { count: number }
      | undefined
    const totalBoxes = boxCount?.count ?? 0

    if (totalBoxes === 0) {
      // Zero boxes - informational, not an error
      return { type: 'info', label: 'No Text Detected', color: 'gray', clickable: false }
    }
    // Some boxes but insufficient for layout analysis - needs review
    return {
      type: 'warning',
      label: 'Layout: Review',
      color: 'yellow',
      clickable: true,
      url: `/annotate/layout/review?videoId=${encodeURIComponent(videoId)}`,
    }
  }

  // Other errors - actual processing failures
  return createLayoutErrorBadge(
    videoId,
    ps.errorMessage ?? 'Processing failed',
    'processing_error',
    { processingStatus: ps.status }
  )
}

/**
 * Map processing status to layout badge for in-progress states
 * Returns null if not an in-progress state
 */
function getLayoutProgressBadge(status: ProcessingStatus['status']): BadgeState | null {
  const statusMap: Partial<Record<ProcessingStatus['status'], BadgeState>> = {
    uploading: createLayoutStatusBadge('Uploading', 'blue'),
    upload_complete: createLayoutStatusBadge('Queued', 'blue'),
    extracting_frames: createLayoutStatusBadge('Layout: Framing', 'indigo'),
    analyzing_layout: createLayoutStatusBadge('Layout: Analyzing', 'purple'),
  }
  return statusMap[status] ?? null
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
    return createLayoutErrorBadge(
      videoId,
      'Video has no processing status. May need to be processed manually or re-uploaded.',
      'no_processing_status'
    )
  }

  // State 1: Error during processing
  if (ps) {
    const errorBadge = handleLayoutProcessingError(ps, videoId, db)
    if (errorBadge) return errorBadge

    // State 2-6: In-progress states
    const progressBadge = getLayoutProgressBadge(ps.status)
    if (progressBadge) return progressBadge
  }

  // State 7: Processing complete but no OCR data (processing failed silently)
  if (ps?.status === 'processing_complete' && !stats.hasOcrData) {
    return createLayoutErrorBadge(
      videoId,
      'Processing completed but no OCR data was generated',
      'empty_ocr_results'
    )
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

/**
 * Create an error badge for boundaries stage
 */
function createBoundariesErrorBadge(
  videoId: string,
  message: string,
  issue: string,
  extra?: { stack?: string; errorType?: string }
): BadgeState {
  return {
    type: 'error',
    label: 'Boundaries: Error',
    color: 'red',
    clickable: true,
    errorDetails: {
      message,
      stack: extra?.stack,
      context: {
        videoId,
        stage: 'boundaries',
        issue,
        ...(extra?.errorType && { errorType: extra.errorType }),
      },
    },
  }
}

/**
 * Create a boundaries action badge (annotate or review)
 */
function createBoundariesActionBadge(videoId: string, action: 'annotate' | 'review'): BadgeState {
  const isReview = action === 'review'
  return {
    type: 'boundaries',
    label: isReview ? 'Boundaries: Review' : 'Boundaries: Annotate',
    color: isReview ? 'yellow' : 'green',
    clickable: true,
    url: `/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`,
  }
}

/**
 * Handle crop frames processing state for boundaries badge
 * Returns null if no processing state applies
 */
function handleCropFramesProcessingState(
  cfs: CropFramesStatus | undefined,
  stats: Omit<VideoStats, 'badges'>,
  videoId: string
): BadgeState | null {
  if (!cfs) return null

  // Processing error (failed or interrupted)
  if (cfs.status === 'error') {
    return createBoundariesErrorBadge(
      videoId,
      cfs.errorMessage ?? 'Crop frames processing failed',
      'crop_frames_failed'
    )
  }

  // Queued for processing
  if (cfs.status === 'queued') {
    return { type: 'boundaries', label: 'Boundaries: Queued', color: 'blue', clickable: false }
  }

  // Currently processing
  if (cfs.status === 'processing') {
    const label = stats.totalFrames === 0 ? 'Boundaries: Framing' : 'Boundaries: Running OCR'
    const color = stats.totalFrames === 0 ? 'indigo' : 'purple'
    return { type: 'boundaries', label, color, clickable: false }
  }

  // Processing completed but no cropped frames created (processing failed)
  if (cfs.status === 'complete' && stats.totalFrames === 0) {
    return createBoundariesErrorBadge(
      videoId,
      'Crop frames processing completed but no frames were created',
      'no_frames_created'
    )
  }

  // Ready to annotate (crop frames complete with frames, but no captions yet)
  if (cfs.status === 'complete' && stats.totalFrames > 0 && stats.totalAnnotations === 0) {
    console.log(
      `[calculateBoundariesBadge] ${videoId}: Showing Boundaries: Annotate (frames=${stats.totalFrames}, annotations=${stats.totalAnnotations})`
    )
    return createBoundariesActionBadge(videoId, 'annotate')
  }

  // Debug: Log why we're not showing the annotate badge
  if (cfs.status === 'complete') {
    console.log(
      `[calculateBoundariesBadge] ${videoId}: crop_frames complete but not showing badge - frames=${stats.totalFrames}, annotations=${stats.totalAnnotations}, cfs=${JSON.stringify(cfs)}`
    )
  }

  return null
}

function calculateBoundariesBadge(
  stats: Omit<VideoStats, 'badges'>,
  videoId: string,
  error?: { message: string; stack?: string }
): BadgeState | null {
  // Priority 0: Error (show if this stage has a data error)
  if (error) {
    return createBoundariesErrorBadge(videoId, error.message, 'sqlite_error', {
      stack: error.stack,
      errorType: 'SqliteError',
    })
  }

  // Hide if waiting for layout approval
  if (!stats.layoutApproved) {
    return null
  }

  // Check crop frames processing states
  const processingBadge = handleCropFramesProcessingState(stats.cropFramesStatus, stats, videoId)
  if (processingBadge) return processingBadge

  // Priority 6: Incomplete (progress < 100% means there are unannotated frames)
  if (stats.progress < 100) {
    return createBoundariesActionBadge(videoId, 'annotate')
  }

  // Priority 7: Review (progress is 100%, but has pending review)
  if (stats.boundaryPendingReview > 0) {
    return createBoundariesActionBadge(videoId, 'review')
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
    console.log(`[getVideoStats] Database not found for ${videoId}`)
    return createEmptyStats([createMissingDatabaseBadge(videoId)])
  }

  const db = new Database(dbPath, { readonly: true })

  try {
    // Query all the data using helper functions
    const totalFrames = queryTotalFrames(db)
    const stageErrors: StageErrors = {}
    const basicResult = queryBasicStats(db)
    const boundaryPendingReview = queryBoundaryPending(db, videoId, stageErrors)
    const textPendingReview = queryTextPending(db, videoId, stageErrors)
    const coveredFrames = queryCoveredFrames(db)
    const progress = totalFrames > 0 ? (coveredFrames / totalFrames) * 100 : 0
    const hasOcrData = queryHasOcrData(db)
    const layoutApproved = queryLayoutApproved(db)

    // Handle deleted videos early
    const { status: processingStatus, isDeleted } = queryProcessingStatus(db, videoId)
    if (isDeleted) {
      return createEmptyStats([])
    }

    const cropFramesStatus = queryCropFramesStatus(db)
    const databaseId = queryDatabaseId(db)

    // Build stats object (used twice: once for return, once for badge calculation)
    const statsWithoutBadges: Omit<VideoStats, 'badges'> = {
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
    }

    const stats: VideoStats = {
      ...statsWithoutBadges,
      badges: calculateBadges(statsWithoutBadges, videoId, db, stageErrors),
    }

    console.log(`[getVideoStats] Returning stats for ${videoId}:`, JSON.stringify(stats, null, 2))
    return stats
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error(`[getVideoStats] Error for ${videoId}:`, error)

    return createEmptyStats([
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
    ])
  } finally {
    db.close()
  }
}
