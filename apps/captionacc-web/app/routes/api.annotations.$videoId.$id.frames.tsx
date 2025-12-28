import { type LoaderFunctionArgs } from 'react-router'
import { getDbPath, getVideoDir } from '~/utils/video-paths'
import Database from 'better-sqlite3'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { spawn } from 'child_process'

interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  boundary_state: 'predicted' | 'confirmed' | 'gap'
}

interface FrameOCR {
  frame_index: number
  ocr_text: string
  ocr_annotations: string
  ocr_confidence: number
}

function getDatabase(videoId: string) {
  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    return new Response('Video not found', { status: 404 })
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found for video: ${videoId}`)
  }

  return new Database(dbPath)
}

// GET - Fetch per-frame OCR results for an annotation
export async function loader({ params }: LoaderFunctionArgs) {
  console.log('=== FRAMES API LOADER CALLED ===', new Date().toISOString())
  const { videoId: encodedVideoId, id } = params
  console.log('  encodedVideoId:', encodedVideoId, 'id:', id)

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
    const annotation = db.prepare('SELECT * FROM captions WHERE id = ?').get(annotationId) as Annotation | undefined

    if (!annotation) {
      db.close()
      return new Response(JSON.stringify({ error: 'Annotation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Generate list of all frame indices in range
    const frameIndices: number[] = []
    for (let i = annotation.start_frame_index; i <= annotation.end_frame_index; i++) {
      frameIndices.push(i)
    }

    // Fetch existing OCR data from frames_ocr table
    const existingOCRData = db.prepare(`
      SELECT frame_index, ocr_text, ocr_annotations, ocr_confidence
      FROM frames_ocr
      WHERE frame_index BETWEEN ? AND ?
      ORDER BY frame_index
    `).all(annotation.start_frame_index, annotation.end_frame_index) as FrameOCR[]

    // Create map of existing OCR data
    const existingOCRMap = new Map<number, FrameOCR>()
    existingOCRData.forEach(row => {
      existingOCRMap.set(row.frame_index, row)
    })

    // Find frames that need OCR
    const framesToOCR = frameIndices.filter(idx => !existingOCRMap.has(idx))

    console.log(`Annotation ${annotationId}: ${frameIndices.length} frames total, ${existingOCRData.length} cached, ${framesToOCR.length} need OCR`)

    // Run OCR on missing frames
    const videoDir = getVideoDir(videoId)
    if (!videoDir) {
      db.close()
      return new Response(JSON.stringify({ error: 'Video directory not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const framesDir = resolve(videoDir, 'crop_frames')

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO frames_ocr (frame_index, ocr_text, ocr_annotations, ocr_confidence, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `)

    // Run OCR on all frames using Python script
    if (framesToOCR.length > 0) {
      console.log(`Running OCR on ${framesToOCR.length} frames using Python service`)

      const pythonScript = resolve(process.cwd(), 'scripts', 'run-frame-ocr.py')
      const args = [pythonScript, framesDir, 'zh-Hans', ...framesToOCR.map(String)]

      const python = spawn('python3', args)

      let stdout = ''
      let stderr = ''

      python.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      python.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      await new Promise<void>((resolve, reject) => {
        python.on('close', (code) => {
          if (code !== 0) {
            console.error(`Python OCR service failed:`, stderr)
            reject(new Error(`Python OCR service exited with code ${code}`))
            return
          }

          try {
            const results = JSON.parse(stdout)
            console.log(`Python OCR service returned ${results.length} results`)

            // Process results and insert into database
            for (const result of results) {
              const { frame_index, ocr_text, ocr_annotations, ocr_confidence } = result

              console.log(`Frame ${frame_index}: text="${ocr_text.substring(0, 30)}" len=${ocr_text.length}`)

              // Insert into database
              insertStmt.run(frame_index, ocr_text, JSON.stringify(ocr_annotations), ocr_confidence)

              // Add to map for response
              existingOCRMap.set(frame_index, {
                frame_index,
                ocr_text,
                ocr_annotations: JSON.stringify(ocr_annotations),
                ocr_confidence
              })
            }

            resolve()
          } catch (error) {
            console.error(`Failed to parse Python OCR results:`, error)
            reject(error)
          }
        })
      })
    }

    db.close()

    // Convert to expected format with camelCase, ordered by frame index
    const frameResults = frameIndices.map(idx => {
      const row = existingOCRMap.get(idx)!
      return {
        frameIndex: row.frame_index,
        ocrText: row.ocr_text || '',
        ocrAnnotations: row.ocr_annotations ? JSON.parse(row.ocr_annotations) : [],
        ocrConfidence: row.ocr_confidence || 0
      }
    })

    return new Response(JSON.stringify({
      annotationId,
      frameRange: {
        start: annotation.start_frame_index,
        end: annotation.end_frame_index
      },
      frames: frameResults
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
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
