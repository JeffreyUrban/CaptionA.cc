import { resolve } from 'path'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import Database from 'better-sqlite3'
import { getDbPath, getVideoDir } from './video-paths'

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
  databaseId?: string  // Unique ID that changes when database is recreated (for cache invalidation)
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

export async function getVideoStats(videoId: string): Promise<VideoStats> {
  // Resolve videoId (can be display_path or UUID) to database path
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    // Video not found - return default stats
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
      layoutApproved: false
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
        SUM(CASE WHEN boundary_pending = 1 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN boundary_state = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN boundary_state = 'predicted' THEN 1 ELSE 0 END) as predicted,
        SUM(CASE WHEN boundary_state = 'gap' THEN 1 ELSE 0 END) as gaps
      FROM captions
    `).get() as {
      total: number
      pending: number
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
      if (status) {
        // Check if video is marked as deleted
        if (status.deleted === 1) {
          // Return null stats for deleted videos
          return null
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
    } catch {
      // Table doesn't exist (video not uploaded via web)
      processingStatus = undefined
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

    return {
      totalAnnotations: result.total,
      pendingReview: result.pending,
      confirmedAnnotations: result.confirmed,
      predictedAnnotations: result.predicted,
      gapAnnotations: result.gaps,
      progress,
      totalFrames,
      coveredFrames,
      hasOcrData,
      layoutApproved,
      processingStatus,
      databaseId
    }
  } finally {
    db.close()
  }
}
