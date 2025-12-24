import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router'
import type { LoaderFunctionArgs } from 'react-router'
import { AppLayout } from '~/components/AppLayout'

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
  text_updated_at: string | null
  created_at: string
}

interface AnnotationData {
  annotation: Annotation
  combinedImageUrl: string
}

// Loader function to expose environment variables
export async function loader() {
  return {
    defaultVideoId: process.env.DEFAULT_VIDEO_ID || ''
  }
}

export default function AnnotateText() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId') || ''

  const [queue, setQueue] = useState<TextQueueAnnotation[]>([])
  const [queueIndex, setQueueIndex] = useState(0)
  const [currentAnnotation, setCurrentAnnotation] = useState<AnnotationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalFrames, setTotalFrames] = useState(0)
  const [workflowProgress, setWorkflowProgress] = useState(0)
  const [completedAnnotations, setCompletedAnnotations] = useState(0)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [jumpToAnnotationInput, setJumpToAnnotationInput] = useState('')

  // Form state
  const [text, setText] = useState('')
  const [textStatus, setTextStatus] = useState<string>('valid_caption')
  const [textNotes, setTextNotes] = useState('')

  // Mark this video as being worked on for stats refresh
  useEffect(() => {
    if (videoId && typeof window !== 'undefined') {
      const touchedVideos = new Set(
        JSON.parse(localStorage.getItem('touched-videos') || '[]')
      )
      touchedVideos.add(videoId)
      localStorage.setItem('touched-videos', JSON.stringify(Array.from(touchedVideos)))
    }
  }, [videoId])

  // Load video metadata and progress
  useEffect(() => {
    if (!videoId) return

    const loadMetadata = async () => {
      try {
        const encodedVideoId = encodeURIComponent(videoId)

        // Load video metadata
        const metadataResponse = await fetch(`/api/videos/${encodedVideoId}/metadata`)
        const metadataData = await metadataResponse.json()
        setTotalFrames(metadataData.totalFrames)

        // Load text workflow progress (we'll need a new endpoint for this)
        // For now, calculate from queue
        const queueResponse = await fetch(`/api/annotations/${encodedVideoId}/text-queue`)
        const queueData = await queueResponse.json()
        setQueue(queueData.annotations)

        // Calculate progress based on annotations with text vs total annotations
        // This is a simplified calculation - you might want a dedicated endpoint
        const totalAnnotations = queueData.total || queueData.annotations.length
        const completedCount = totalAnnotations - queueData.annotations.length
        setCompletedAnnotations(completedCount)
        setWorkflowProgress(totalAnnotations > 0 ? (completedCount / totalAnnotations) * 100 : 0)

        setLoading(false)
      } catch (err) {
        console.error('Failed to load metadata:', err)
        setError((err as Error).message)
        setLoading(false)
      }
    }

    loadMetadata()
  }, [videoId])

  // Load current annotation
  useEffect(() => {
    if (!videoId || queue.length === 0 || queueIndex >= queue.length) return

    const loadAnnotation = async () => {
      const annotationId = queue[queueIndex].id
      setLoading(true)
      setError(null)

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

  // Update progress from server
  const updateProgress = useCallback(async () => {
    if (!videoId) return

    try {
      const encodedVideoId = encodeURIComponent(videoId)
      const queueResponse = await fetch(`/api/annotations/${encodedVideoId}/text-queue`)
      const queueData = await queueResponse.json()

      const totalAnnotations = queueData.total || queueData.annotations.length
      const completedCount = totalAnnotations - queueData.annotations.length
      setCompletedAnnotations(completedCount)
      setWorkflowProgress(totalAnnotations > 0 ? (completedCount / totalAnnotations) * 100 : 0)
    } catch (err) {
      console.error('Failed to update progress:', err)
    }
  }, [videoId])

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

      // Update progress
      await updateProgress()

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

  // Jump to specific annotation ID
  const jumpToAnnotation = useCallback(() => {
    const annotationId = parseInt(jumpToAnnotationInput)
    if (isNaN(annotationId) || annotationId < 0) {
      alert('Invalid annotation ID')
      return
    }

    const index = queue.findIndex(a => a.id === annotationId)
    if (index !== -1) {
      setQueueIndex(index)
      setJumpToAnnotationInput('')
    } else {
      alert(`Annotation ${annotationId} not found in current queue`)
    }
  }, [jumpToAnnotationInput, queue])

  // Switch to boundaries mode
  const switchToBoundaries = () => {
    navigate(`/annotate/boundaries?videoId=${encodeURIComponent(videoId)}`)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in input/textarea
      if (document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA') {
        return
      }

      const key = e.key.toLowerCase()

      // Navigation
      if (key === 'enter') {
        e.preventDefault()
        handleSave()
      } else if (key === 'arrowleft') {
        e.preventDefault()
        handlePrevious()
      } else if (key === 'arrowright') {
        e.preventDefault()
        handleSkip()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, handlePrevious, handleSkip])

  // Show loading state while metadata loads
  if (loading && queue.length === 0) {
    return (
      <AppLayout fullScreen>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              Loading annotation queue...
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {videoId}
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  // No video selected
  if (!videoId) {
    return (
      <AppLayout fullScreen>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <div className="rounded-lg border-2 border-yellow-500 bg-yellow-50 p-6 dark:border-yellow-600 dark:bg-yellow-950">
            <div className="text-lg font-semibold text-yellow-900 dark:text-yellow-100">
              No video selected
            </div>
            <div className="mt-2 text-sm text-yellow-800 dark:text-yellow-200">
              Please select a video from the{' '}
              <a href="/" className="underline hover:text-yellow-900 dark:hover:text-yellow-100">
                home page
              </a>
              .
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout fullScreen>
      <div className="flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] flex-col overflow-hidden px-4 py-4">
        {/* Workflow completion banner */}
        {(workflowProgress || 0) >= 100 && (
          <div className="mb-4 rounded-lg bg-green-50 border-2 border-green-500 p-4 dark:bg-green-950 dark:border-green-600">
            <div className="flex items-center gap-3">
              <div className="text-3xl">🎉</div>
              <div className="flex-1">
                <div className="text-lg font-bold text-green-900 dark:text-green-100">
                  Workflow Complete!
                </div>
                <div className="text-sm text-green-700 dark:text-green-300">
                  All annotations have been reviewed. You can continue editing as needed.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border-2 border-red-500 p-4 dark:bg-red-950 dark:border-red-600">
            <div className="flex items-center gap-3">
              <div className="text-2xl">⚠️</div>
              <div className="flex-1">
                <div className="text-lg font-bold text-red-900 dark:text-red-100">
                  Error
                </div>
                <div className="text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex h-full flex-1 gap-6 overflow-hidden">
          {/* Left: Combined Image and OCR (2/3 width) */}
          <div className="flex h-full w-2/3 flex-col gap-4 overflow-y-auto">
            {currentAnnotation ? (
              <>
                {/* Combined Image */}
                <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                  <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Combined Image
                    </h2>
                  </div>
                  <div className="p-4">
                    <div className="overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                      <img
                        src={currentAnnotation.combinedImageUrl}
                        alt={`Annotation ${currentAnnotation.annotation.id}`}
                        className="h-auto w-full"
                      />
                    </div>
                    <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                      Frames {currentAnnotation.annotation.start_frame_index} -{' '}
                      {currentAnnotation.annotation.end_frame_index} (
                      {currentAnnotation.annotation.end_frame_index -
                        currentAnnotation.annotation.start_frame_index +
                        1}{' '}
                      frames)
                    </div>
                  </div>
                </div>

                {/* OCR Text Display */}
                <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                  <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      OCR Text (Combined)
                    </h2>
                  </div>
                  <div className="p-4">
                    <div className="rounded-lg bg-gray-50 p-3 font-mono text-sm whitespace-pre-wrap dark:bg-gray-950 dark:text-gray-300">
                      {currentAnnotation.annotation.text_ocr_combined ||
                        '(No OCR text available)'}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="text-center text-gray-500 dark:text-gray-400">
                  {queue.length === 0 ? 'No annotations in queue' : 'Loading annotation...'}
                </div>
              </div>
            )}
          </div>

          {/* Right: Controls (1/3 width) */}
          <div className="flex h-full w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            {/* Mode toggle */}
            <div className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
              <button
                onClick={switchToBoundaries}
                className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Boundaries
              </button>
              <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
                Text Correction
              </button>
            </div>

            {/* Video info */}
            <div>
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                Video
              </div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {videoId}
              </div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Annotation: {queueIndex + 1} / {queue.length}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                Progress: {(workflowProgress || 0).toFixed(2)}% ({completedAnnotations}{' '}
                completed)
              </div>

              {/* Jump to annotation */}
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  value={jumpToAnnotationInput}
                  onChange={(e) => setJumpToAnnotationInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && jumpToAnnotation()}
                  placeholder="Annotation ID"
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
                <button
                  onClick={jumpToAnnotation}
                  disabled={!jumpToAnnotationInput}
                  className={`rounded-md px-3 py-1 text-sm font-medium ${
                    jumpToAnnotationInput
                      ? 'bg-teal-600 text-white hover:bg-teal-700'
                      : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-600'
                  }`}
                >
                  Jump
                </button>
              </div>
            </div>

            {/* Active annotation info */}
            {currentAnnotation && (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
                <div className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Active Annotation
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">ID:</span>
                    <span className="font-mono font-semibold text-gray-900 dark:text-white">
                      {currentAnnotation.annotation.id}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">State:</span>
                    <span className="font-semibold text-gray-900 dark:text-white capitalize">
                      {currentAnnotation.annotation.boundary_state}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Frames:</span>
                    <span className="font-mono text-gray-900 dark:text-white">
                      {currentAnnotation.annotation.start_frame_index}-
                      {currentAnnotation.annotation.end_frame_index}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Caption Text Editor */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Caption Text
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full h-48 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                placeholder="Enter caption text..."
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Status
              </label>
              <select
                value={textStatus}
                onChange={(e) => setTextStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="valid_caption">Valid Caption</option>
                <option value="ocr_error">OCR Error</option>
                <option value="partial_caption">Partial Caption</option>
                <option value="text_unclear">Text Unclear</option>
                <option value="other_issue">Other Issue</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Notes
              </label>
              <textarea
                value={textNotes}
                onChange={(e) => setTextNotes(e.target.value)}
                className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                placeholder="Optional notes about this annotation..."
              />
            </div>

            {/* Action Buttons */}
            <div className="space-y-2">
              <button
                onClick={handleSave}
                disabled={!currentAnnotation}
                className={`w-full rounded-md px-4 py-2 text-sm font-semibold text-white ${
                  currentAnnotation
                    ? 'bg-teal-600 hover:bg-teal-700'
                    : 'cursor-not-allowed bg-gray-400 dark:bg-gray-700'
                }`}
              >
                Save & Next <span className="text-xs opacity-75">(Enter)</span>
              </button>

              {/* Navigation */}
              <div className="flex gap-2">
                <button
                  onClick={handlePrevious}
                  disabled={queueIndex === 0}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                    queueIndex > 0
                      ? 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                      : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
                  }`}
                >
                  ← Previous
                </button>
                <button
                  onClick={handleSkip}
                  disabled={queueIndex >= queue.length - 1}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                    queueIndex < queue.length - 1
                      ? 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                      : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
                  }`}
                >
                  Skip →
                </button>
              </div>
            </div>

            {/* Help button */}
            <button
              onClick={() => setShowHelpModal(true)}
              className="w-full rounded-md border border-teal-500 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 dark:border-teal-600 dark:bg-teal-950 dark:text-teal-300 dark:hover:bg-teal-900"
            >
              📖 Annotation Guide
            </button>

            {/* Keyboard shortcuts */}
            <details className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
              <summary className="cursor-pointer p-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
                Keyboard Shortcuts
              </summary>
              <div className="space-y-1 p-3 pt-1 text-xs text-gray-600 dark:text-gray-400">
                <div>
                  <strong>Navigation:</strong>
                </div>
                <div>← : Previous annotation</div>
                <div>→ : Skip to next</div>
                <div className="mt-2">
                  <strong>Actions:</strong>
                </div>
                <div>Enter: Save & Next</div>
              </div>
            </details>
          </div>
        </div>
      </div>

      {/* Help Modal */}
      {showHelpModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-opacity-40 p-16 backdrop-blur-sm"
          onClick={() => setShowHelpModal(false)}
        >
          <div
            className="w-full max-w-3xl rounded-lg bg-white bg-opacity-75 px-2 py-5 shadow-xl dark:bg-gray-900 dark:bg-opacity-75"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Text Annotation Guide
              </h2>
              <button
                onClick={() => setShowHelpModal(false)}
                className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Purpose
                </h3>
                <p>
                  This page helps you review and correct text extracted from video
                  captions. Each annotation shows a combined image of all frames in the
                  caption along with OCR-extracted text that you can correct.
                </p>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Workflow
                </h3>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>Review the combined image showing all caption frames</li>
                  <li>Check the OCR-extracted text for accuracy</li>
                  <li>Edit the caption text to correct any OCR errors</li>
                  <li>Select the appropriate status for the annotation</li>
                  <li>Add notes if needed (optional)</li>
                  <li>Click "Save & Next" to save and move to the next annotation</li>
                </ol>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Status Options
                </h3>
                <div className="space-y-2">
                  <div>
                    <strong className="text-gray-900 dark:text-white">Valid Caption:</strong>{' '}
                    Caption text is correct and complete
                  </div>
                  <div>
                    <strong className="text-gray-900 dark:text-white">OCR Error:</strong>{' '}
                    OCR extracted incorrect text that was corrected
                  </div>
                  <div>
                    <strong className="text-gray-900 dark:text-white">Partial Caption:</strong>{' '}
                    Only part of the caption is visible or readable
                  </div>
                  <div>
                    <strong className="text-gray-900 dark:text-white">Text Unclear:</strong>{' '}
                    Text is difficult to read in the image
                  </div>
                  <div>
                    <strong className="text-gray-900 dark:text-white">Other Issue:</strong>{' '}
                    Other problems with the annotation (explain in notes)
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  Tips
                </h3>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Use the combined image to verify OCR accuracy</li>
                  <li>Empty text field means "no caption" (valid for gaps)</li>
                  <li>Use notes to explain unusual cases or issues</li>
                  <li>Use keyboard shortcuts for faster navigation</li>
                  <li>Progress tracks completed vs total annotations</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
