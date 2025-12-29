import { type LoaderFunctionArgs } from 'react-router'
import { getDbPath } from '~/utils/video-paths'
import Database from 'better-sqlite3'
import { existsSync } from 'fs'

interface PotentialMislabel {
  frameIndex: number
  boxIndex: number
  boxText: string
  userLabel: 'in' | 'out'
  predictedLabel: 'in' | 'out' | null
  predictedConfidence: number | null
  boxTop: number
  topDeviation: number
  issueType: string
}

function getDatabase(videoId: string): Database.Database | Response {
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

// GET - Find potential mislabeled boxes for review
export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    const db = getDatabase(videoId)
    if (db instanceof Response) return db

    // Get main cluster statistics
    const clusterStats = db.prepare(`
      SELECT
        AVG(box_top) as avg_top,
        AVG(box_bottom) as avg_bottom
      FROM full_frame_box_labels
      WHERE label = 'in' AND annotation_source = 'full_frame'
    `).get() as { avg_top: number; avg_bottom: number } | undefined

    if (!clusterStats) {
      db.close()
      return new Response(JSON.stringify({
        potentialMislabels: [],
        message: 'No caption boxes labeled yet'
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Find potential mislabels
    const potentialMislabels = db.prepare(`
      SELECT
        frame_index as frameIndex,
        box_index as boxIndex,
        box_text as boxText,
        label as userLabel,
        predicted_label as predictedLabel,
        predicted_confidence as predictedConfidence,
        box_top as boxTop,
        ABS(box_top - ?) as topDeviation,
        CASE
          WHEN predicted_label IS NOT NULL AND predicted_label != label AND predicted_confidence > 0.7
            THEN 'High-confidence model disagreement'
          WHEN predicted_label IS NOT NULL AND predicted_label != label
            THEN 'Model disagreement'
          WHEN label = 'in' AND ABS(box_top - ?) > 100
            THEN 'Major vertical outlier (>100px)'
          WHEN label = 'in' AND ABS(box_top - ?) > 50
            THEN 'Vertical outlier (>50px)'
          ELSE 'Minor deviation'
        END as issueType
      FROM full_frame_box_labels
      WHERE label_source = 'user'
        AND annotation_source = 'full_frame'
        AND (
          (predicted_label IS NOT NULL AND predicted_label != label)
          OR (label = 'in' AND ABS(box_top - ?) > 50)
        )
      ORDER BY
        CASE WHEN predicted_label != label AND predicted_confidence > 0.7 THEN 0 ELSE 1 END,
        ABS(box_top - ?) DESC,
        frame_index,
        box_index
      LIMIT 100
    `).all(
      clusterStats.avg_top,
      clusterStats.avg_top,
      clusterStats.avg_top,
      clusterStats.avg_top,
      clusterStats.avg_top
    ) as PotentialMislabel[]

    db.close()

    return new Response(JSON.stringify({
      potentialMislabels,
      clusterStats: {
        avgTop: Math.round(clusterStats.avg_top),
        avgBottom: Math.round(clusterStats.avg_bottom)
      },
      summary: {
        total: potentialMislabels.length,
        modelDisagreements: potentialMislabels.filter(m => m.predictedLabel && m.predictedLabel !== m.userLabel).length,
        verticalOutliers: potentialMislabels.filter(m => m.topDeviation > 50).length,
        highConfidenceDisagreements: potentialMislabels.filter(m =>
          m.predictedLabel && m.predictedLabel !== m.userLabel && m.predictedConfidence && m.predictedConfidence > 0.7
        ).length
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error finding potential mislabels:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
