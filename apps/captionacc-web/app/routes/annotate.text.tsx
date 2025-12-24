import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router'

interface TextQueueAnnotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  boundary_state: 'predicted' | 'confirmed' | 'gap'
  text: string | null
  text_pending: number
  text_status: string | null
  created_at: string
}

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

interface AnnotationData {
  annotation: Annotation
  combinedImageUrl: string
}

export default function AnnotateText() {
  const [searchParams, setSearchParams] = useSearchParams()
  const videoId = searchParams.get('videoId')

  const [queue, setQueue] = useState<TextQueueAnnotation[]>([])
  const [queueIndex, setQueueIndex] = useState(0)
  const [currentAnnotation, setCurrentAnnotation] = useState<AnnotationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [text, setText] = useState('')
  const [textStatus, setTextStatus] = useState<string>('valid_caption')
  const [textNotes, setTextNotes] = useState('')

  // Load annotation queue
  useEffect(() => {
    if (!videoId) return

    const loadQueue = async () => {
      try {
        const response = await fetch(`/api/annotations/${encodeURIComponent(videoId)}/text-queue`)
        if (!response.ok) throw new Error('Failed to load annotation queue')
        const data = await response.json()
        setQueue(data.annotations)
        setLoading(false)
      } catch (err) {
        setError((err as Error).message)
        setLoading(false)
      }
    }

    loadQueue()
  }, [videoId])

  // Load current annotation
  useEffect(() => {
    if (!videoId || queue.length === 0 || queueIndex >= queue.length) return

    const loadAnnotation = async () => {
      const annotationId = queue[queueIndex].id
      setLoading(true)

      try {
        const response = await fetch(
          `/api/annotations/${encodeURIComponent(videoId)}/${annotationId}/text`
        )
        if (!response.ok) throw new Error('Failed to load annotation')
        const data = await response.json()

        setCurrentAnnotation(data)
        setText(data.annotation.text || data.annotation.text_ocr_combined || '')
        setTextStatus(data.annotation.text_status || 'valid_caption')
        setTextNotes(data.annotation.text_notes || '')
        setLoading(false)
      } catch (err) {
        setError((err as Error).message)
        setLoading(false)
      }
    }

    loadAnnotation()
  }, [videoId, queue, queueIndex])

  // Save annotation
  const handleSave = async () => {
    if (!videoId || !currentAnnotation) return

    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(videoId)}/${currentAnnotation.annotation.id}/text`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            text_status: textStatus,
            text_notes: textNotes
          })
        }
      )

      if (!response.ok) throw new Error('Failed to save annotation')

      // Move to next annotation
      if (queueIndex < queue.length - 1) {
        setQueueIndex(queueIndex + 1)
      } else {
        // Reload queue to check for new annotations
        const queueResponse = await fetch(`/api/annotations/${encodeURIComponent(videoId)}/text-queue`)
        const queueData = await queueResponse.json()
        setQueue(queueData.annotations)
        setQueueIndex(0)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Skip to next annotation without saving
  const handleSkip = () => {
    if (queueIndex < queue.length - 1) {
      setQueueIndex(queueIndex + 1)
    }
  }

  // Previous annotation
  const handlePrevious = () => {
    if (queueIndex > 0) {
      setQueueIndex(queueIndex - 1)
    }
  }

  // Render
  if (!videoId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
          No video selected. Please select a video from the{' '}
          <a href="/" className="underline">
            home page
          </a>
          .
        </div>
      </div>
    )
  }

  if (loading && queue.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">Loading annotation queue...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
          Error: {error}
        </div>
      </div>
    )
  }

  if (queue.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded">
          All annotations have been completed! 🎉
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Text Annotation</h1>
        <div className="text-gray-600">
          Video: {decodeURIComponent(videoId)} • Annotation {queueIndex + 1} of {queue.length}
        </div>
      </div>

      {/* Main Content */}
      {currentAnnotation && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Combined Image */}
          <div className="space-y-4">
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-xl font-semibold mb-3">Combined Image</h2>
              <div className="bg-gray-100 rounded overflow-hidden">
                <img
                  src={currentAnnotation.combinedImageUrl}
                  alt={`Annotation ${currentAnnotation.annotation.id}`}
                  className="w-full h-auto"
                />
              </div>
              <div className="mt-3 text-sm text-gray-600">
                Frames {currentAnnotation.annotation.start_frame_index} - {currentAnnotation.annotation.end_frame_index}
              </div>
            </div>

            {/* OCR Text Display */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-xl font-semibold mb-3">OCR Text (Combined)</h2>
              <div className="bg-gray-50 rounded p-3 font-mono text-sm whitespace-pre-wrap">
                {currentAnnotation.annotation.text_ocr_combined || '(No OCR text available)'}
              </div>
            </div>
          </div>

          {/* Right Column: Text Editor */}
          <div className="space-y-4">
            {/* Character Editor */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-xl font-semibold mb-3">Caption Text</h2>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full h-48 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                placeholder="Enter caption text..."
              />
            </div>

            {/* Status and Notes */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-xl font-semibold mb-3">Status & Notes</h2>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <select
                  value={textStatus}
                  onChange={(e) => setTextStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="valid_caption">Valid Caption</option>
                  <option value="ocr_error">OCR Error</option>
                  <option value="partial_caption">Partial Caption</option>
                  <option value="text_unclear">Text Unclear</option>
                  <option value="other_issue">Other Issue</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <textarea
                  value={textNotes}
                  onChange={(e) => setTextNotes(e.target.value)}
                  className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional notes about this annotation..."
                />
              </div>
            </div>

            {/* Navigation Controls */}
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex gap-3">
                <button
                  onClick={handlePrevious}
                  disabled={queueIndex === 0}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={handleSkip}
                  disabled={queueIndex >= queue.length - 1}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Skip
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Save & Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
