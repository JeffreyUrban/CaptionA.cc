import { useState, useEffect, useCallback } from 'react'
import { AppLayout } from '~/components/AppLayout'

// Status options matching PyQt6 annotator
const STATUS_OPTIONS = [
  { id: 'valid', label: 'Valid Caption' },
  { id: 'valid_bounds_incomplete', label: 'Valid, But Bounds Incomplete' },
  { id: 'valid_ocr_errors', label: 'Valid, But OCR Errors Need Correction' },
  { id: 'valid_bounds_and_ocr', label: 'Valid - Bounds + OCR' },
  { id: 'invalid_not_caption', label: 'Invalid - Not a Caption' },
  { id: 'other', label: 'Other Issue (Add Notes)' },
  { id: 'empty', label: 'No Caption' },
] as const

type StatusId = typeof STATUS_OPTIONS[number]['id']

// Annotation mode options
const MODE_OPTIONS = [
  { id: 'random_sequence', label: 'Random Sequence' },
  { id: 'random_time', label: 'Random Time' },
  { id: 'random_annotation', label: 'Random Annotation' },
  { id: 'from_csv', label: 'From CSV' },
] as const

type ModeId = typeof MODE_OPTIONS[number]['id']

interface Frame {
  id: number
  frame_index: number
  ocr_text: string
  show_id: string
  episode_id: string
  image_url: string
}

interface AnnotationData {
  show_id: string
  episode_id: string
  frames: Frame[]
  original_start_idx: number
  original_end_idx: number
  initial_caption_text?: string
  initial_status?: StatusId
}

export default function Annotate() {
  const [mode, setMode] = useState<ModeId>('from_csv')
  const [annotationData, setAnnotationData] = useState<AnnotationData | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [startFrameIdx, setStartFrameIdx] = useState(-1)
  const [endFrameIdx, setEndFrameIdx] = useState(-1)
  const [captionText, setCaptionText] = useState('')
  const [status, setStatus] = useState<StatusId>('valid')
  const [notes, setNotes] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  // Load next annotation sequence
  const loadNext = useCallback(async () => {
    try {
      const response = await fetch(`/api/annotations/next?mode=${mode}`)
      const data: AnnotationData = await response.json()

      setAnnotationData(data)
      setCurrentIndex(data.original_start_idx)
      setStartFrameIdx(-1)
      setEndFrameIdx(-1)
      setCaptionText(data.initial_caption_text || '')
      setStatus(data.initial_status || 'valid')
      setNotes('')
      setStatusMessage('')
    } catch (error) {
      console.error('Failed to load annotation:', error)
      setStatusMessage('Failed to load annotation')
    }
  }, [mode])

  useEffect(() => {
    loadNext()
  }, [loadNext])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        return
      }

      switch (e.key.toLowerCase()) {
        case 'a':
        case 'j':
          jumpToOriginalStart()
          break
        case 's':
        case 'k':
          markStart()
          break
        case 'd':
        case 'l':
          markEnd()
          break
        case 'f':
        case ';':
          jumpToOriginalEnd()
          break
        case 'enter':
          saveAnnotation()
          break
        case 'arrowleft':
          prevFrame()
          break
        case 'arrowright':
          nextFrame()
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  })

  const jumpToOriginalStart = () => {
    if (annotationData) {
      setCurrentIndex(annotationData.original_start_idx)
    }
  }

  const jumpToOriginalEnd = () => {
    if (annotationData) {
      setCurrentIndex(annotationData.original_end_idx)
    }
  }

  const prevFrame = () => {
    setCurrentIndex(Math.max(0, currentIndex - 1))
  }

  const nextFrame = () => {
    if (annotationData) {
      setCurrentIndex(Math.min(annotationData.frames.length - 1, currentIndex + 1))
    }
  }

  const markStart = () => {
    if (!annotationData) return
    setStartFrameIdx(currentIndex)
    if (!captionText && status !== 'empty') {
      setCaptionText(annotationData.frames[currentIndex].ocr_text)
    }
    showStatusMessage('Start frame set')
  }

  const markEnd = () => {
    if (!annotationData) return
    setEndFrameIdx(currentIndex)
    if (!captionText && status !== 'empty') {
      setCaptionText(annotationData.frames[currentIndex].ocr_text)
    }
    showStatusMessage('End frame set')
  }

  const showStatusMessage = (message: string) => {
    setStatusMessage(message)
    setTimeout(() => setStatusMessage(''), 3000)
  }

  const saveAnnotation = async () => {
    if (!annotationData) return

    if (status === 'valid' && (startFrameIdx === -1 || endFrameIdx === -1)) {
      showStatusMessage('Please set both start and end frames!')
      return
    }

    if (startFrameIdx > endFrameIdx && startFrameIdx !== -1 && endFrameIdx !== -1) {
      showStatusMessage('Start frame must come before end frame!')
      return
    }

    if (!captionText && (status === 'valid' || status === 'valid_bounds_incomplete')) {
      showStatusMessage('Please enter caption text for valid captions!')
      return
    }

    if (captionText && status === 'empty') {
      showStatusMessage('Please remove caption text for empty captions!')
      return
    }

    const actualStartIdx = startFrameIdx !== -1 ? startFrameIdx : annotationData.original_start_idx
    const actualEndIdx = endFrameIdx !== -1 ? endFrameIdx : annotationData.original_end_idx
    const startFrameIndex = annotationData.frames[actualStartIdx].frame_index
    const endFrameIndex = annotationData.frames[actualEndIdx].frame_index

    try {
      await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          show_id: annotationData.show_id,
          episode_id: annotationData.episode_id,
          start_frame_index: startFrameIndex,
          end_frame_index: endFrameIndex,
          caption_text: captionText || (status.startsWith('invalid') ? 'INVALID' : ''),
          status,
          notes,
          annotation_type: 'manual',
        }),
      })

      showStatusMessage('Annotation saved successfully')
      loadNext()
    } catch (error) {
      console.error('Failed to save annotation:', error)
      showStatusMessage('Failed to save annotation')
    }
  }

  if (!annotationData) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-teal-600 border-r-transparent"></div>
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Loading annotation...</p>
          </div>
        </div>
      </AppLayout>
    )
  }

  const currentFrame = annotationData.frames[currentIndex]
  const previousFrame = currentIndex > 0 ? annotationData.frames[currentIndex - 1] : null
  const followingFrame = currentIndex < annotationData.frames.length - 1 ? annotationData.frames[currentIndex + 1] : null

  return (
    <AppLayout>
      <div>
        {/* Header with Mode Selection */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              Caption Annotation
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {annotationData.show_id} / {annotationData.episode_id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setMode(option.id)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  mode === option.id
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Left Column: Frames */}
          <div className="lg:col-span-2 space-y-4">
            {/* Frame Display */}
            {previousFrame && (
              <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">Previous Frame</p>
                <img
                  src={previousFrame.image_url}
                  alt="Previous frame"
                  className="w-full rounded"
                />
              </div>
            )}

            <div className="rounded-lg border-2 border-teal-500 bg-white p-4 shadow-lg dark:bg-gray-800">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Current Frame</p>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {currentIndex + 1} / {annotationData.frames.length} (Index: {currentFrame.frame_index})
                </p>
              </div>
              <img
                src={currentFrame.image_url}
                alt="Current frame"
                className="w-full rounded"
              />
            </div>

            {followingFrame && (
              <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">Next Frame</p>
                <img
                  src={followingFrame.image_url}
                  alt="Next frame"
                  className="w-full rounded"
                />
              </div>
            )}

            {/* Navigation Controls */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={prevFrame}
                disabled={currentIndex === 0}
                className="flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                ← Previous
              </button>
              <button
                onClick={nextFrame}
                disabled={currentIndex === annotationData.frames.length - 1}
                className="flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Next →
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={jumpToOriginalStart}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  currentIndex === annotationData.original_start_idx
                    ? 'bg-orange-500 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                Jump to Start (A/J)
              </button>
              <button
                onClick={jumpToOriginalEnd}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  currentIndex === annotationData.original_end_idx
                    ? 'bg-orange-500 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                Jump to End (F/;)
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={markStart}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  currentIndex === startFrameIdx
                    ? 'bg-green-600 text-white shadow-lg'
                    : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                Mark Start (S/K)
              </button>
              <button
                onClick={markEnd}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  currentIndex === endFrameIdx
                    ? 'bg-green-600 text-white shadow-lg'
                    : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                Mark End (D/L)
              </button>
            </div>

            {/* Boundary Info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Start Frame</p>
                <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                  {startFrameIdx === -1
                    ? 'Not set'
                    : `Frame ${startFrameIdx + 1} (${annotationData.frames[startFrameIdx].frame_index})`}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-900">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">End Frame</p>
                <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                  {endFrameIdx === -1
                    ? 'Not set'
                    : `Frame ${endFrameIdx + 1} (${annotationData.frames[endFrameIdx].frame_index})`}
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Form */}
          <div className="space-y-6">
            {/* OCR Text */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                OCR Text
              </label>
              <div className="mt-2 rounded-lg bg-gray-50 p-4 text-4xl dark:bg-gray-900 dark:text-white">
                {currentFrame.ocr_text}
              </div>
            </div>

            {/* Caption Text */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <label htmlFor="caption-text" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Caption Text
              </label>
              <textarea
                id="caption-text"
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                rows={3}
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-4xl text-gray-900 shadow-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              />
            </div>

            {/* Status */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Status
              </label>
              <div className="mt-2 space-y-2">
                {STATUS_OPTIONS.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-center rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
                  >
                    <input
                      type="radio"
                      name="status"
                      value={option.id}
                      checked={status === option.id}
                      onChange={(e) => setStatus(e.target.value as StatusId)}
                      className="h-4 w-4 border-gray-300 text-teal-600 focus:ring-teal-600"
                    />
                    <span className="ml-3 text-sm text-gray-900 dark:text-gray-100">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
              <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Notes
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                placeholder="Add any additional notes..."
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={saveAnnotation}
                className="flex-1 rounded-lg bg-green-600 px-6 py-3 font-semibold text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2"
              >
                Save (Enter)
              </button>
              <button
                onClick={loadNext}
                className="flex-1 rounded-lg bg-gray-200 px-6 py-3 font-semibold text-gray-700 shadow-sm hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                Skip
              </button>
            </div>

            {/* Status Message */}
            {statusMessage && (
              <div className="rounded-lg bg-teal-50 p-4 dark:bg-teal-900/20">
                <p className="text-sm font-medium text-teal-800 dark:text-teal-300">{statusMessage}</p>
              </div>
            )}

            {/* Keyboard Shortcuts */}
            <div className="rounded-lg bg-gray-50 p-4 text-xs dark:bg-gray-900">
              <p className="font-medium text-gray-700 dark:text-gray-300">Keyboard Shortcuts:</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600 dark:text-gray-400">
                <div><dt className="inline font-mono">A/J:</dt> Jump start</div>
                <div><dt className="inline font-mono">S/K:</dt> Mark start</div>
                <div><dt className="inline font-mono">D/L:</dt> Mark end</div>
                <div><dt className="inline font-mono">F/;:</dt> Jump end</div>
                <div><dt className="inline font-mono">←/→:</dt> Navigate</div>
                <div><dt className="inline font-mono">Enter:</dt> Save</div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
