import { resolve } from 'path'
import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import Database from 'better-sqlite3'

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
  layoutComplete: boolean  // Whether layout annotation is marked as complete
  processingStatus?: ProcessingStatus  // Upload/processing status (null if not uploaded via web)
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
  const dbPath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'annotations.db'
  )

  // Get total frames from crop_frames directory
  const framesDir = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'crop_frames'
  )

  let totalFrames = 0
  if (existsSync(framesDir)) {
    const files = await readdir(framesDir)
    totalFrames = files.filter(f => f.startsWith('frame_') && f.endsWith('.jpg')).length
  }

  if (!existsSync(dbPath)) {
    return {
      totalAnnotations: 0,
      pendingReview: 0,
      confirmedAnnotations: 0,
      predictedAnnotations: 0,
      gapAnnotations: 0,
      progress: 0,
      totalFrames,
      coveredFrames: 0,
      hasOcrData: false,
      layoutComplete: false
    }
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

    // Check if layout annotation is marked as complete
    let layoutComplete = false
    try {
      const prefs = db.prepare(`SELECT layout_complete FROM video_preferences WHERE id = 1`).get() as { layout_complete: number } | undefined
      layoutComplete = (prefs?.layout_complete ?? 0) === 1
    } catch {
      // Table or column doesn't exist
      layoutComplete = false
    }

    // Get processing status if available
    let processingStatus: ProcessingStatus | undefined
    try {
      const status = db.prepare(`SELECT * FROM processing_status WHERE id = 1`).get() as any
      if (status) {
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
      layoutComplete,
      processingStatus
    }
  } finally {
    db.close()
  }
}
