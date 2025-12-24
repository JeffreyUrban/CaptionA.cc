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

  // Get total frames from caption_frames directory
  const framesDir = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'caption_frames'
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
      progress: 0
    }
  }

  const db = new Database(dbPath, { readonly: true })

  try {
    const result = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN pending = 1 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN state = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN state = 'predicted' THEN 1 ELSE 0 END) as predicted,
        SUM(CASE WHEN state = 'gap' THEN 1 ELSE 0 END) as gaps
      FROM annotations
    `).get() as {
      total: number
      pending: number
      confirmed: number
      predicted: number
      gaps: number
    }

    // Calculate frame coverage for non-gap, non-pending annotations
    const frameCoverage = db.prepare(`
      SELECT
        SUM(end_frame_index - start_frame_index + 1) as covered_frames
      FROM annotations
      WHERE state != 'gap' AND pending = 0
    `).get() as { covered_frames: number | null }

    // Calculate progress as percentage of frames that are not gap or pending
    const coveredFrames = frameCoverage.covered_frames || 0
    const progress = totalFrames > 0
      ? Math.round((coveredFrames / totalFrames) * 100)
      : 0

    return {
      totalAnnotations: result.total,
      pendingReview: result.pending,
      confirmedAnnotations: result.confirmed,
      predictedAnnotations: result.predicted,
      gapAnnotations: result.gaps,
      progress
    }
  } finally {
    db.close()
  }
}
