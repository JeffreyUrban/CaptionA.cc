import { useState, useEffect, useMemo, useCallback } from 'react'
import { AppLayout } from '~/components/AppLayout'

// Types
interface Frame {
  frame_index: number
  image_url: string
  ocr_text: string
}

interface Annotation {
  id: number
  video_id: string
  start_frame_index: number
  end_frame_index: number
  annotation_type: 'caption' | 'non_caption'
  text: string | null
}

type FrameSpacing = 'linear' | 'exponential' | 'hybrid'

// Frame spacing configurations
const FRAME_OFFSETS: Record<FrameSpacing, number[]> = {
  linear: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5],
  exponential: [-8, -4, -2, -1, 0, 1, 2, 4, 8],
  hybrid: [-10, -5, -3, -2, -1, 0, 1, 2, 3, 5, 10]
}

// Opacity for frame distance
const OPACITY_MAP: Record<number, number> = {
  0: 1.0,
  1: 0.9,
  2: 0.7,
  3: 0.6,
  4: 0.5,
  5: 0.4,
  8: 0.3,
  10: 0.2
}

export default function BoundaryWorkflow() {
  // State
  const [videoId, setVideoId] = useState('a_bite_of_china/3')
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [frames, setFrames] = useState<Map<number, Frame>>(new Map())
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true)

  const [markedStart, setMarkedStart] = useState<number | null>(null)
  const [markedEnd, setMarkedEnd] = useState<number | null>(null)
  const [sequenceType, setSequenceType] = useState<'caption' | 'non_caption'>('caption')

  const [frameSpacing, setFrameSpacing] = useState<FrameSpacing>('linear')
  const [sessionHistory, setSessionHistory] = useState<Annotation[]>([])

  const [predictedStart, setPredictedStart] = useState<number | null>(140)
  const [predictedEnd, setPredictedEnd] = useState<number | null>(147)

  const [windowHeight, setWindowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 1000)

  // Load video metadata on mount
  useEffect(() => {
    const loadMetadata = async () => {
      try {
        // URL encode the videoId to handle slashes
        const encodedVideoId = encodeURIComponent(videoId)
        const response = await fetch(`/api/videos/${encodedVideoId}/metadata`)
        const data = await response.json()
        setTotalFrames(data.totalFrames)
        setCurrentFrameIndex(0)
        setIsLoadingMetadata(false)
      } catch (error) {
        console.error('Failed to load video metadata:', error)
        setIsLoadingMetadata(false)
      }
    }
    loadMetadata()
  }, [videoId])

  // Track window height for dynamic frame count
  useEffect(() => {
    if (typeof window === 'undefined') return

    setWindowHeight(window.innerHeight)
    const handleResize = () => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Computed: visible frame indices based on window height
  const visibleFrameIndices = useMemo(() => {
    // Calculate available height: total window height minus navbar (64px) and padding
    const navbarHeight = 64
    const availableHeight = windowHeight - navbarHeight

    // Estimate frame height: ~80-120px depending on aspect ratio
    // Using 90px as conservative estimate to ensure we fill the height
    const estimatedFrameHeight = 90

    // Calculate how many frames we need to fill the height
    const framesToFill = Math.ceil(availableHeight / estimatedFrameHeight)

    // Get base offsets for the selected spacing
    const baseOffsets = FRAME_OFFSETS[frameSpacing]

    // Extend offsets to fill the available height
    let adjustedOffsets = [...baseOffsets]
    const maxBaseOffset = Math.max(...baseOffsets.map(Math.abs))

    // Add more frames until we have enough to fill the height
    if (framesToFill > baseOffsets.length) {
      const additionalFramesNeeded = framesToFill - baseOffsets.length
      const framesPerSide = Math.ceil(additionalFramesNeeded / 2)

      for (let i = 1; i <= framesPerSide; i++) {
        const offset = maxBaseOffset + i
        adjustedOffsets.push(-offset)
        adjustedOffsets.push(offset)
      }
      adjustedOffsets.sort((a, b) => a - b)
    }

    return adjustedOffsets
      .map(offset => currentFrameIndex + offset)
      .filter(idx => idx >= 0 && idx < totalFrames)
  }, [currentFrameIndex, frameSpacing, totalFrames, windowHeight])

  // Get opacity for frame distance
  const getOpacity = useCallback((frameIndex: number) => {
    const distance = Math.abs(frameIndex - currentFrameIndex)
    return OPACITY_MAP[distance] ?? 0.3
  }, [currentFrameIndex])

  // Can save if both boundaries marked
  const canSave = markedStart !== null && markedEnd !== null && markedStart < markedEnd

  // Navigation functions
  const navigateFrame = useCallback((delta: number) => {
    setCurrentFrameIndex(prev => Math.max(0, Math.min(prev + delta, totalFrames - 1)))
  }, [totalFrames])

  // Marking functions
  const markStart = useCallback(() => {
    setMarkedStart(currentFrameIndex)
    // If marking start after current end, clear end to prevent invalid order
    if (markedEnd !== null && currentFrameIndex > markedEnd) {
      setMarkedEnd(null)
    }
  }, [currentFrameIndex, markedEnd])

  const markEnd = useCallback(() => {
    setMarkedEnd(currentFrameIndex)
    // If marking end before current start, clear start to prevent invalid order
    if (markedStart !== null && currentFrameIndex < markedStart) {
      setMarkedStart(null)
    }
  }, [currentFrameIndex, markedStart])

  const jumpToStart = useCallback(() => {
    const target = markedStart ?? predictedStart
    if (target !== null) {
      setCurrentFrameIndex(target)
    }
  }, [markedStart, predictedStart])

  const jumpToEnd = useCallback(() => {
    const target = markedEnd ?? predictedEnd
    if (target !== null) {
      setCurrentFrameIndex(target)
    }
  }, [markedEnd, predictedEnd])

  const clearMarks = useCallback(() => {
    setMarkedStart(null)
    setMarkedEnd(null)
  }, [])

  // Save annotation
  const saveAnnotation = useCallback(async () => {
    if (!canSave) return

    const annotation: Annotation = {
      id: sessionHistory.length + 1,
      video_id: videoId,
      start_frame_index: markedStart!,
      end_frame_index: markedEnd!,
      annotation_type: sequenceType,
      text: sequenceType === 'caption' ? 'NOT_YET_DETERMINED' : null
    }

    // TODO: API call to save annotation
    console.log('Saving annotation:', annotation)

    // Add to session history
    setSessionHistory(prev => [...prev, annotation])

    // Clear marks and move to next suggested position
    clearMarks()
    // TODO: Load next suggested position from API
    setCurrentFrameIndex(prev => prev + 50)
  }, [canSave, markedStart, markedEnd, sequenceType, videoId, sessionHistory, clearMarks])

  // Keyboard event handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if typing in input/textarea
      if (document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.tagName === 'TEXTAREA') {
        return
      }

      const key = e.key.toLowerCase()

      // Navigation
      if (key === 'arrowdown' || key === 'arrowright') {
        e.preventDefault()
        const jump = e.ctrlKey ? 50 : e.shiftKey ? 10 : 1
        navigateFrame(jump)
      } else if (key === 'arrowup' || key === 'arrowleft') {
        e.preventDefault()
        const jump = e.ctrlKey ? 50 : e.shiftKey ? 10 : 1
        navigateFrame(-jump)
      }

      // Marking
      else if (key === 'a') {
        e.preventDefault()
        jumpToStart()
      } else if (key === 's') {
        e.preventDefault()
        markStart()
      } else if (key === 'd') {
        e.preventDefault()
        markEnd()
      } else if (key === 'f') {
        e.preventDefault()
        jumpToEnd()
      }

      // Actions
      else if (key === 'enter') {
        e.preventDefault()
        saveAnnotation()
      } else if (key === 'escape') {
        e.preventDefault()
        clearMarks()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigateFrame, markStart, markEnd, jumpToStart, jumpToEnd, saveAnnotation, clearMarks])

  // Mouse wheel handler for frame navigation
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Check if we're over the frame container
      const target = e.target as HTMLElement
      if (target.closest('.frame-stack-container')) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? 1 : -1
        navigateFrame(delta)
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [navigateFrame])

  // Load frames for visible indices
  useEffect(() => {
    const newFrames = new Map(frames)
    const encodedVideoId = encodeURIComponent(videoId)
    visibleFrameIndices.forEach(idx => {
      if (!newFrames.has(idx)) {
        newFrames.set(idx, {
          frame_index: idx,
          image_url: `/api/frames/${encodedVideoId}/${idx}.jpg`,
          ocr_text: '' // OCR text not used in boundary workflow
        })
      }
    })
    setFrames(newFrames)
  }, [visibleFrameIndices, videoId])

  // Check if frame is in marked range
  const isInMarkedRange = useCallback((frameIndex: number) => {
    if (markedStart === null || markedEnd === null) return false
    return frameIndex >= markedStart && frameIndex <= markedEnd
  }, [markedStart, markedEnd])

  // Show loading state while metadata loads
  if (isLoadingMetadata) {
    return (
      <AppLayout fullScreen>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              Loading video metadata...
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {videoId}
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout fullScreen>
      <div className="flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] flex-col overflow-hidden px-4 py-4">
        {/* Main content */}
        <div className="flex h-full flex-1 gap-6 overflow-hidden">
          {/* Left: Frame stack (2/3 width) */}
          <div className="frame-stack-container flex h-full w-2/3 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex h-full flex-1 flex-col justify-center gap-1 overflow-hidden p-4">
                {visibleFrameIndices.map(frameIndex => {
                  const frame = frames.get(frameIndex)
                  const isCurrent = frameIndex === currentFrameIndex
                  const opacity = getOpacity(frameIndex)
                  const isMarkedStart = frameIndex === markedStart
                  const isMarkedEnd = frameIndex === markedEnd
                  const inRange = isInMarkedRange(frameIndex)

                  // Determine border classes based on position in marked range
                  let borderClasses = ''
                  if (markedStart !== null && markedEnd !== null && inRange) {
                    // Full sequence marked - create continuous border
                    borderClasses = 'border-l-4 border-r-4 border-orange-500'
                    if (isMarkedStart) {
                      borderClasses += ' border-t-4 rounded-t'
                    }
                    if (isMarkedEnd) {
                      borderClasses += ' border-b-4 rounded-b'
                    }
                  } else if (isMarkedStart && markedEnd === null) {
                    // Only start marked
                    borderClasses = 'border-4 border-orange-500 rounded'
                  } else if (isMarkedEnd && markedStart === null) {
                    // Only end marked
                    borderClasses = 'border-4 border-orange-500 rounded'
                  }

                  return (
                    <div
                      key={frameIndex}
                      className="relative"
                      style={{ opacity }}
                    >
                      {/* Frame container */}
                      <div
                        className={`relative overflow-hidden ${
                          isCurrent ? 'ring-4 ring-teal-500 rounded' : ''
                        } ${inRange ? 'bg-orange-50 dark:bg-orange-950' : ''} ${borderClasses}`}
                      >
                        {/* Frame image */}
                        {frame ? (
                          <img
                            src={frame.image_url}
                            alt={`Frame ${frameIndex}`}
                            className="w-full"
                            onError={(e) => {
                              // Fallback for missing images
                              const target = e.target as HTMLImageElement
                              target.style.display = 'none'
                              target.parentElement!.innerHTML += `
                                <div class="flex h-24 items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                                  Frame ${frameIndex}
                                </div>
                              `
                            }}
                          />
                        ) : (
                          <div className="flex h-24 items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                            Loading frame {frameIndex}...
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Right: Controls (1/3 width) */}
          <div className="flex h-full w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            {/* Mode toggle */}
            <div className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
              <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
                Boundaries
              </button>
              <button className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
                Text Correction
              </button>
            </div>

            {/* Video info */}
            <div>
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">Video</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">{videoId}</div>
              <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Frame: {currentFrameIndex.toLocaleString()} / {totalFrames.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                Progress: {((currentFrameIndex / totalFrames) * 100).toFixed(2)}%
              </div>
            </div>

            {/* Frame spacing */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                Frame Spacing
              </label>
              <select
                value={frameSpacing}
                onChange={e => setFrameSpacing(e.target.value as FrameSpacing)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="linear">Linear (1,1,1...)</option>
                <option value="exponential">Exponential (1,2,4,8...)</option>
                <option value="hybrid">Hybrid (1,2,3,5,10...)</option>
              </select>
            </div>

            {/* Boundaries */}
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Boundaries
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Start:</span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">
                    {markedStart ?? 'not set'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">End:</span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">
                    {markedEnd ?? 'not set'}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={jumpToStart}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Jump Start <span className="text-xs text-gray-500">(A)</span>
                </button>
                <button
                  onClick={markStart}
                  className="rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  Mark Start <span className="text-xs opacity-75">(S)</span>
                </button>
                <button
                  onClick={jumpToEnd}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Jump End <span className="text-xs text-gray-500">(F)</span>
                </button>
                <button
                  onClick={markEnd}
                  className="rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  Mark End <span className="text-xs opacity-75">(D)</span>
                </button>
              </div>

              <button
                onClick={clearMarks}
                className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Clear Marks
              </button>
            </div>

            {/* Sequence type */}
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Sequence Type
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSequenceType('caption')}
                  className={`rounded-md px-4 py-3 text-sm font-semibold transition-colors ${
                    sequenceType === 'caption'
                      ? 'bg-teal-600 text-white ring-2 ring-teal-600 ring-offset-2 dark:ring-offset-gray-900'
                      : 'border-2 border-gray-300 text-gray-700 hover:border-teal-500 hover:bg-teal-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-teal-950'
                  }`}
                >
                  Caption
                  <div className="text-xs font-normal opacity-75">text TBD</div>
                </button>
                <button
                  onClick={() => setSequenceType('non_caption')}
                  className={`rounded-md px-4 py-3 text-sm font-semibold transition-colors ${
                    sequenceType === 'non_caption'
                      ? 'bg-teal-600 text-white ring-2 ring-teal-600 ring-offset-2 dark:ring-offset-gray-900'
                      : 'border-2 border-gray-300 text-gray-700 hover:border-teal-500 hover:bg-teal-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-teal-950'
                  }`}
                >
                  Non-caption
                  <div className="text-xs font-normal opacity-75">no text</div>
                </button>
              </div>
            </div>

            {/* Predicted boundaries */}
            {(predictedStart !== null || predictedEnd !== null) && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
                <div className="mb-2 text-sm font-semibold text-blue-900 dark:text-blue-100">
                  Predicted
                </div>
                <div className="space-y-1 text-sm">
                  {predictedStart !== null && (
                    <div className="flex justify-between">
                      <span className="text-blue-700 dark:text-blue-300">Start:</span>
                      <span className="font-mono font-semibold text-blue-900 dark:text-blue-100">
                        {predictedStart} (±2)
                      </span>
                    </div>
                  )}
                  {predictedEnd !== null && (
                    <div className="flex justify-between">
                      <span className="text-blue-700 dark:text-blue-300">End:</span>
                      <span className="font-mono font-semibold text-blue-900 dark:text-blue-100">
                        {predictedEnd} (±2)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div>
              <button
                onClick={saveAnnotation}
                disabled={!canSave}
                className={`w-full rounded-md px-4 py-2 text-sm font-semibold text-white ${
                  canSave
                    ? 'bg-teal-600 hover:bg-teal-700'
                    : 'cursor-not-allowed bg-gray-400 dark:bg-gray-700'
                }`}
              >
                Save & Next <span className="text-xs opacity-75">(Enter)</span>
              </button>
            </div>

            {/* Session history */}
            {sessionHistory.length > 0 && (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
                <div className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-400">
                  Session History ({sessionHistory.length})
                </div>
                <div className="flex max-h-24 flex-col gap-1 overflow-y-auto">
                  {sessionHistory.slice(-5).reverse().map(ann => (
                    <button
                      key={ann.id}
                      onClick={() => {
                        setMarkedStart(ann.start_frame_index)
                        setMarkedEnd(ann.end_frame_index)
                        setCurrentFrameIndex(ann.start_frame_index)
                      }}
                      className="rounded px-2 py-1 text-left text-xs text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      #{ann.id}: {ann.start_frame_index}-{ann.end_frame_index}{' '}
                      {ann.annotation_type === 'caption' ? 'Cap' : 'Non-cap'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Keyboard shortcuts */}
            <details className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
              <summary className="cursor-pointer p-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
                Keyboard Shortcuts
              </summary>
              <div className="space-y-1 p-3 pt-1 text-xs text-gray-600 dark:text-gray-400">
                <div><strong>Navigation:</strong></div>
                <div>↑/↓ or ←/→: ±1 frame</div>
                <div>Shift + Arrow: ±10 frames</div>
                <div>Ctrl + Arrow: ±50 frames</div>
                <div className="mt-2"><strong>Marking:</strong></div>
                <div>A: Jump to Start</div>
                <div>S: Mark Start</div>
                <div>D: Mark End</div>
                <div>F: Jump to End</div>
                <div className="mt-2"><strong>Actions:</strong></div>
                <div>Enter: Save & Next</div>
                <div>Esc: Clear Marks</div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
