/**
 * Layout Review Page
 *
 * Shows OCR visualization for videos with insufficient boxes for automatic layout analysis.
 * Allows user to see what text was detected and potentially manually annotate layout.
 */

import { type LoaderFunctionArgs } from 'react-router'
import { useLoaderData, useNavigate } from 'react-router'
import Database from 'better-sqlite3'
import { getDbPath } from '~/utils/video-paths'

interface OcrBox {
  frameIndex: number
  boxIndex: number
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

interface FrameWithBoxes {
  frameIndex: number
  boxes: OcrBox[]
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const videoId = url.searchParams.get('videoId')

  if (!videoId) {
    throw new Response('Missing videoId', { status: 400 })
  }

  const dbPath = getDbPath(videoId)
  if (!dbPath) {
    throw new Response('Video not found', { status: 404 })
  }

  const db = new Database(dbPath, { readonly: true })
  try {
    // Get video metadata
    const metadata = db.prepare(`
      SELECT display_path, video_id FROM video_metadata WHERE id = 1
    `).get() as { display_path: string; video_id: string } | undefined

    // Get processing status
    const status = db.prepare(`
      SELECT error_message, error_details FROM processing_status WHERE id = 1
    `).get() as { error_message: string; error_details: string } | undefined

    // Get all OCR boxes grouped by frame
    const boxes = db.prepare(`
      SELECT frame_index, box_index, text, confidence, x, y, width, height
      FROM full_frame_ocr
      ORDER BY frame_index, box_index
    `).all() as OcrBox[]

    // Group boxes by frame
    const frameMap = new Map<number, OcrBox[]>()
    for (const box of boxes) {
      if (!frameMap.has(box.frameIndex)) {
        frameMap.set(box.frameIndex, [])
      }
      frameMap.get(box.frameIndex)!.push(box)
    }

    const frames: FrameWithBoxes[] = Array.from(frameMap.entries())
      .map(([frameIndex, boxes]) => ({ frameIndex, boxes }))
      .sort((a, b) => a.frameIndex - b.frameIndex)

    return {
      videoId,
      displayPath: metadata?.display_path || videoId,
      totalBoxes: boxes.length,
      totalFrames: frames.length,
      frames,
      errorMessage: status?.error_message,
      errorDetails: status?.error_details
    }
  } finally {
    db.close()
  }
}

export default function LayoutReview() {
  const data = useLoaderData<typeof loader>()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/videos')}
            className="text-blue-600 hover:text-blue-800 mb-4"
          >
            ← Back to Videos
          </button>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Layout Review
          </h1>
          <p className="text-gray-600">{data.displayPath}</p>
        </div>

        {/* Explanation Card */}
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-6 mb-8">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">
                Insufficient Text for Automatic Layout Detection
              </h3>
              <div className="mt-2 text-sm text-yellow-700">
                <p>
                  OCR detected <strong>{data.totalBoxes} text boxes</strong> across <strong>{data.totalFrames} frames</strong>,
                  but they don't form a consistent subtitle region pattern.
                </p>
                <p className="mt-2">
                  This usually means:
                </p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>Video has minimal or no burned-in subtitles</li>
                  <li>Text appears sporadically (credits, signs, etc.)</li>
                  <li>Subtitle format is unusual or inconsistent</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* OCR Results Summary */}
        <div className="bg-white shadow rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Detection Summary</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Total Frames Analyzed</p>
              <p className="text-2xl font-bold text-gray-900">{data.totalFrames}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Text Boxes Found</p>
              <p className="text-2xl font-bold text-gray-900">{data.totalBoxes}</p>
            </div>
          </div>
        </div>

        {/* Frame-by-Frame OCR Results */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Detected Text by Frame</h2>
          {data.frames.length === 0 ? (
            <p className="text-gray-500 italic">No text detected in any frames</p>
          ) : (
            <div className="space-y-6">
              {data.frames.map((frame) => (
                <div key={frame.frameIndex} className="border-l-2 border-gray-200 pl-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    Frame {frame.frameIndex} ({(frame.frameIndex / 10).toFixed(1)}s)
                  </h3>
                  <div className="space-y-2">
                    {frame.boxes.map((box) => (
                      <div key={box.boxIndex} className="flex items-start space-x-3 text-sm">
                        <span className="font-mono bg-gray-100 px-2 py-1 rounded">
                          {box.text}
                        </span>
                        <span className="text-gray-500">
                          conf: {(box.confidence * 100).toFixed(0)}%
                        </span>
                        <span className="text-gray-400 text-xs">
                          ({(box.x * 100).toFixed(1)}, {(box.y * 100).toFixed(1)})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Next Steps */}
        <div className="mt-8 bg-blue-50 border-l-4 border-blue-400 p-6">
          <h3 className="text-sm font-medium text-blue-800 mb-2">Next Steps</h3>
          <ul className="text-sm text-blue-700 space-y-2">
            <li>• If this video should have subtitles, check the source video quality</li>
            <li>• If subtitles are present but not detected, the format may be incompatible</li>
            <li>• Manual layout annotation is not currently available for this case</li>
            <li>• You can skip this video if subtitle extraction isn't critical</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
