import { existsSync } from 'fs'

import Database from 'better-sqlite3'
import { type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router'

import { getOrGenerateCombinedImage } from '../utils/image-processing'
import { runOCROnCombinedImage } from '../utils/ocr-wrapper'

import { getDbPath } from '~/utils/video-paths'

interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  boundary_state: 'predicted' | 'confirmed' | 'gap'
  boundary_pending: number
  boundary_updated_at: string
  text: string | null
  text_pending: number
  text_status: string | null
  text_notes: string | null
  text_ocr_combined: string | null
  text_updated_at: string
  created_at: string
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

// GET - Load annotation for text annotation with OCR
export async function loader({ params }: LoaderFunctionArgs) {
  console.log('=== TEXT API LOADER CALLED ===', new Date().toISOString())
  const { videoId: encodedVideoId, id } = params
  console.log('  encodedVideoId:', encodedVideoId, 'id:', id)

  if (!encodedVideoId || !id) {
    return new Response(JSON.stringify({ error: 'Missing videoId or id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)
  const annotationId = parseInt(id)
  console.log('  Decoded videoId:', videoId, 'annotationId:', annotationId)

  try {
    const db = getDatabase(videoId)
    if (db instanceof Response) return db

    // Get annotation
    const annotation = db.prepare('SELECT * FROM captions WHERE id = ?').get(annotationId) as
      | Annotation
      | undefined

    if (!annotation) {
      db.close()
      return new Response(JSON.stringify({ error: 'Annotation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Check if combined OCR is already cached in database
    let combinedOCRText = annotation.text_ocr_combined
    console.log(
      '  Current text_ocr_combined:',
      combinedOCRText ? `"${combinedOCRText.substring(0, 50)}..."` : 'null'
    )

    if (!combinedOCRText) {
      console.log('  Generating combined image and running OCR...')
      // Generate or get cached combined image
      const combinedImagePath = await getOrGenerateCombinedImage(
        videoId,
        annotationId,
        annotation.start_frame_index,
        annotation.end_frame_index
      )
      console.log('  Combined image path:', combinedImagePath)

      // Run OCR on combined image
      console.log('  Calling runOCROnCombinedImage with path:', combinedImagePath)
      console.log('  runOCROnCombinedImage function type:', typeof runOCROnCombinedImage)
      console.log(
        '  runOCROnCombinedImage function:',
        runOCROnCombinedImage.toString().substring(0, 200)
      )

      let ocrResult
      try {
        console.log('  About to await runOCROnCombinedImage...')
        ocrResult = await runOCROnCombinedImage(combinedImagePath)
        console.log('  Await completed, result:', ocrResult)
      } catch (error) {
        console.error('  ERROR in runOCROnCombinedImage:', error)
        throw error
      }
      console.log('  OCR result type:', typeof ocrResult)
      console.log('  OCR result is string:', typeof ocrResult === 'string')
      console.log('  OCR result is array:', Array.isArray(ocrResult))
      console.log('  OCR result value:', ocrResult)
      console.log('  OCR result object keys:', Object.keys(ocrResult))
      console.log('  OCR result.text:', ocrResult.text)
      console.log('  OCR result annotations count:', ocrResult.annotations?.length)

      // If ocrResult is a string (the bug), use it directly
      if (typeof ocrResult === 'string') {
        combinedOCRText = ocrResult
        console.log('  WARNING: OCR returned string directly, using it as text')
      } else {
        combinedOCRText = ocrResult.text
      }
      console.log(
        '  OCR extracted text:',
        combinedOCRText
          ? `"${combinedOCRText.substring(0, 50)}..." (length: ${combinedOCRText.length})`
          : 'empty'
      )

      // Cache OCR result in database
      console.log('  Saving to database...')
      db.prepare(
        `
        UPDATE captions
        SET text_ocr_combined = ?
        WHERE id = ?
      `
      ).run(combinedOCRText, annotationId)
      console.log('  Database updated successfully')
    } else {
      console.log('  Using cached OCR text from database')
    }

    db.close()

    // TODO: Trigger per-frame OCR in background (Phase 6 enhancement)

    return new Response(
      JSON.stringify({
        annotation: {
          ...annotation,
          text_ocr_combined: combinedOCRText,
        },
        combinedImageUrl: `/api/images/${encodeURIComponent(videoId)}/text_images/annotation_${annotationId}.jpg`,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// PUT - Update text annotation
export async function action({ params, request }: ActionFunctionArgs) {
  const { videoId: encodedVideoId, id } = params

  if (!encodedVideoId || !id) {
    return new Response(JSON.stringify({ error: 'Missing videoId or id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)
  const annotationId = parseInt(id)
  const body = await request.json()

  try {
    const db = getDatabase(videoId)
    if (db instanceof Response) return db

    // Update text annotation fields
    const { text, text_status, text_notes } = body

    db.prepare(
      `
      UPDATE captions
      SET text = ?,
          text_status = ?,
          text_notes = ?,
          text_pending = 0
      WHERE id = ?
    `
    ).run(text !== undefined ? text : null, text_status || null, text_notes || null, annotationId)

    // Get updated annotation
    const annotation = db.prepare('SELECT * FROM captions WHERE id = ?').get(annotationId)

    db.close()

    return new Response(JSON.stringify({ annotation }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
