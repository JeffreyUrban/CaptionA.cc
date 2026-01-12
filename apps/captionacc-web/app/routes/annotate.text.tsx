import { useState, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { CompletionBanner } from '~/components/annotation/CompletionBanner'
import { ErrorBanner } from '~/components/annotation/ErrorBanner'
import { TextAnnotationContentPanel } from '~/components/annotation/TextAnnotationContentPanel'
import { TextAnnotationControlsPanel } from '~/components/annotation/TextAnnotationControlsPanel'
import { TextAnnotationHelpModal } from '~/components/annotation/TextAnnotationHelpModal'
import { useCaptionFrameExtentsFrameLoader } from '~/hooks/useCaptionFrameExtentsFrameLoader'
import { useTextAnnotationData } from '~/hooks/useTextAnnotationData'
import { useTextAnnotationFrameNav } from '~/hooks/useTextAnnotationFrameNav'
import { useTextAnnotationKeyboard } from '~/hooks/useTextAnnotationKeyboard'
import { useTextAnnotationPreferences } from '~/hooks/useTextAnnotationPreferences'
import { useVideoMetadata } from '~/hooks/useVideoMetadata'
import { useVideoTouched } from '~/hooks/useVideoTouched'
import type { Frame } from '~/caption-frame-extents'

// Loader function to expose environment variables
export async function loader() {
  return {
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] ?? '',
  }
}

export default function AnnotateText() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId') ?? ''

  // Help modal state
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [jumpToAnnotationInput, setJumpToAnnotationInput] = useState('')

  // Ref for frame viewer container (used for wheel event listener)
  const frameContainerRef = useRef<HTMLDivElement>(null)

  // Mark this video as being worked on for stats refresh
  useVideoTouched(videoId)

  // Data management hook
  const {
    queue,
    queueIndex,
    currentAnnotation,
    perFrameOCR: _perFrameOCR,
    loadingFrames: _loadingFrames,
    text,
    setText,
    textStatus,
    setTextStatus,
    textNotes,
    setTextNotes,
    workflowProgress,
    completedAnnotations,
    loading,
    error,
    handleSave,
    handleSaveEmptyCaption,
    handleSkip,
    handlePrevious,
    jumpToAnnotation,
  } = useTextAnnotationData({ videoId })

  // Display preferences hook
  const {
    textSizePercent,
    paddingScale,
    textAnchor,
    actualTextSize,
    textControlsExpanded,
    setTextControlsExpanded,
    textStyle,
    imageContainerRef: preferencesContainerRef,
    handleTextSizeChange,
    handlePaddingScaleChange,
    handleTextAnchorChange,
  } = useTextAnnotationPreferences({ videoId })

  // Frame navigation hook
  const { currentFrameIndex, handleDragStart, navigateFrame } = useTextAnnotationFrameNav({
    annotation: currentAnnotation?.annotation ?? null,
    containerRef: frameContainerRef,
  })

  // Video metadata for frame loading
  const { metadata, loading: isLoadingMetadata } = useVideoMetadata(videoId)

  // Frame loading state
  const framesRef = useRef<Map<number, Frame>>(new Map())
  const currentFrameIndexRef = useRef<number>(currentFrameIndex)
  const jumpRequestedRef = useRef<boolean>(false)
  const jumpTargetRef = useRef<number | null>(null)

  // Sync current frame index to ref
  currentFrameIndexRef.current = currentFrameIndex

  // Load frames from Wasabi
  useCaptionFrameExtentsFrameLoader({
    videoId,
    currentFrameIndexRef,
    jumpRequestedRef,
    jumpTargetRef,
    totalFrames: metadata?.totalFrames ?? 0,
    framesRef,
    isReady: !isLoadingMetadata && !!videoId && !!metadata,
    activeAnnotation: null, // Text annotation doesn't use this workflow
    nextAnnotation: null, // No next annotation preloading for text workflow
  })

  // Get current frame from loaded frames
  const currentFrame = framesRef.current.get(currentFrameIndex)

  // Combined ref callback that handles both preferences ResizeObserver and regular ref
  const combinedContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      // Set the regular ref for wheel event listener
      if (frameContainerRef.current !== node) {
        ;(frameContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      }

      // Call the preferences callback ref for ResizeObserver
      return preferencesContainerRef(node)
    },
    [preferencesContainerRef]
  )

  // Keyboard shortcuts hook
  useTextAnnotationKeyboard({
    handleSave,
    handleSaveEmptyCaption,
    handlePrevious,
    handleSkip,
    navigateFrame,
  })

  // Switch to caption frame extents mode
  const switchToCaptionFrameExtents = () => {
    void navigate(
      `/annotate/boundariescaption-frame-extents?videoId=${encodeURIComponent(videoId)}`
    )
  }

  // Handle jump to annotation
  const handleJump = () => {
    jumpToAnnotation(jumpToAnnotationInput)
    setJumpToAnnotationInput('')
  }

  // Show loading state while metadata loads
  if (loading && queue.length === 0) {
    return (
      <AppLayout fullScreen>
        <LoadingScreen videoId={videoId} />
      </AppLayout>
    )
  }

  // No video selected
  if (!videoId) {
    return (
      <AppLayout fullScreen>
        <NoVideoScreen />
      </AppLayout>
    )
  }

  return (
    <AppLayout fullScreen>
      <div className="flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] flex-col overflow-hidden px-4 py-4">
        <CompletionBanner workflowProgress={workflowProgress || 0} />
        <ErrorBanner error={error} />

        <div className="flex h-full flex-1 gap-6 overflow-hidden">
          <TextAnnotationContentPanel
            currentAnnotation={currentAnnotation}
            queueLength={queue.length}
            currentFrameIndex={currentFrameIndex}
            currentFrame={currentFrame}
            onMouseDown={handleDragStart}
            imageContainerRef={combinedContainerRef}
            text={text}
            onTextChange={setText}
            textStyle={textStyle}
          />

          <TextAnnotationControlsPanel
            videoId={videoId}
            queueIndex={queueIndex}
            queueLength={queue.length}
            workflowProgress={workflowProgress || 0}
            completedAnnotations={completedAnnotations}
            jumpToAnnotationInput={jumpToAnnotationInput}
            onJumpInputChange={setJumpToAnnotationInput}
            onJump={handleJump}
            annotation={currentAnnotation?.annotation ?? null}
            textAnchor={textAnchor}
            textSizePercent={textSizePercent}
            paddingScale={paddingScale}
            actualTextSize={actualTextSize}
            textControlsExpanded={textControlsExpanded}
            onExpandedChange={setTextControlsExpanded}
            onTextAnchorChange={anchor => void handleTextAnchorChange(anchor)}
            onTextSizeChange={size => void handleTextSizeChange(size)}
            onPaddingScaleChange={scale => void handlePaddingScaleChange(scale)}
            textStatus={textStatus}
            onTextStatusChange={setTextStatus}
            textNotes={textNotes}
            onTextNotesChange={setTextNotes}
            onSave={() => void handleSave()}
            onSaveEmpty={() => void handleSaveEmptyCaption()}
            onPrevious={handlePrevious}
            onSkip={handleSkip}
            canSave={!!currentAnnotation}
            hasPrevious={queueIndex > 0}
            hasNext={queueIndex < queue.length - 1}
            onShowHelp={() => setShowHelpModal(true)}
            onSwitchToCaptionFrameExtents={switchToCaptionFrameExtents}
          />
        </div>
      </div>

      <TextAnnotationHelpModal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} />
    </AppLayout>
  )
}

// --- Presentational Components ---

interface LoadingScreenProps {
  videoId: string
}

function LoadingScreen({ videoId }: LoadingScreenProps) {
  return (
    <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
      <div className="text-center">
        <div className="text-lg font-semibold text-gray-900 dark:text-white">
          Loading annotation queue...
        </div>
        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{videoId}</div>
      </div>
    </div>
  )
}

function NoVideoScreen() {
  return (
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
  )
}
