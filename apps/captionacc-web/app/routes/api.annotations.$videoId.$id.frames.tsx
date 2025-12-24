import { type LoaderFunctionArgs } from 'react-router'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { runOCROnFrames } from '~/utils/ocr-wrapper'

interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  boundary_state: 'predicted' | 'confirmed' | 'gap'
}

function getDatabase(videoId: string) {
  const dbPath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'annotations.db'
  )

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

// GET - Fetch per-frame OCR results for an annotation
export async function loader({ params }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId, id } = params

  if (!encodedVideoId || !id) {
    return new Response(JSON.stringify({ error: 'Missing videoId or id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)
  const annotationId = parseInt(id)

  try {
    const db = getDatabase(videoId)

    // Get annotation to determine frame range
    const annotation = db.prepare('SELECT * FROM annotations WHERE id = ?').get(annotationId) as Annotation | undefined

    if (!annotation) {
      db.close()
      return new Response(JSON.stringify({ error: 'Annotation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    db.close()

    // Generate array of frame indices
    const frameIndices: number[] = []
    for (let i = annotation.start_frame_index; i <= annotation.end_frame_index; i++) {
      frameIndices.push(i)
    }

    // Run OCR on all frames in parallel
    const ocrResultsMap = await runOCROnFrames(videoId, frameIndices)

    // Convert Map to array for JSON response
    const frameResults = Array.from(ocrResultsMap.values())

    return new Response(JSON.stringify({
      annotationId,
      frameRange: {
        start: annotation.start_frame_index,
        end: annotation.end_frame_index
      },
      frames: frameResults
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
