import { useState, useRef, useCallback, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { CompletionBanner } from '~/components/annotation/CompletionBanner'
import { DatabaseLockBanner, type LockHolderInfo } from '~/components/annotation/DatabaseLockBanner'
import { LockAcquisitionModal } from '~/components/annotation/LockAcquisitionModal'
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
import { supabase } from '~/services/supabase-client'

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

  // Lock modal state
  const [showLockModal, setShowLockModal] = useState(true)
  const [lockError, setLockError] = useState<string | null>(null)

  // Tenant ID and cropped frames version from Supabase
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [croppedFramesVersion, setCroppedFramesVersion] = useState<number | null>(null)

  // Ref for frame viewer container (used for wheel event listener)
  const frameContainerRef = useRef<HTMLDivElement>(null)

  // Mark this video as being worked on for stats refresh
  useVideoTouched(videoId)

  // Fetch tenant ID and cropped frames version from Supabase
  useEffect(() => {
    if (!videoId) return

    const fetchVideoMeta = async () => {
      try {
        const { data: videoMeta, error } = await supabase
          .from('videos')
          .select('tenant_id, current_cropped_frames_version')
          .eq('id', videoId)
          .single()

        if (error) {
          console.error('Failed to fetch video metadata:', error)
          return
        }

        if (videoMeta) {
          setTenantId(videoMeta.tenant_id)
          setCroppedFramesVersion(videoMeta.current_cropped_frames_version)
        }
      } catch (err) {
        console.error('Error fetching video metadata:', err)
      }
    }

    void fetchVideoMeta()
  }, [videoId])

  // Data management hook with tenant ID
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
    canEdit,
    isReady,
  } = useTextAnnotationData({ videoId, tenantId: tenantId ?? undefined })

  // Display preferences hook with tenant ID
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
  } = useTextAnnotationPreferences({ videoId, tenantId: tenantId ?? undefined })

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

  // Load frames from Wasabi with tenantId and croppedFramesVersion
  useCaptionFrameExtentsFrameLoader({
    videoId,
    tenantId,
    croppedFramesVersion,
    currentFrameIndexRef,
    jumpRequestedRef,
    jumpTargetRef,
    totalFrames: metadata?.totalFrames ?? 0,
    framesRef,
    isReady: !isLoadingMetadata && !!videoId && !!metadata && !!tenantId && !!croppedFramesVersion,
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

  // Keyboard shortcuts hook - only enabled when we have edit permission
  useTextAnnotationKeyboard({
    handleSave: canEdit ? handleSave : async () => {},
    handleSaveEmptyCaption: canEdit ? handleSaveEmptyCaption : async () => {},
    handlePrevious,
    handleSkip,
    navigateFrame,
  })

  // Close lock modal when ready
  useEffect(() => {
    if (isReady) {
      setShowLockModal(false)
    }
  }, [isReady])

  // Switch to caption frame extents mode
  const switchToCaptionFrameExtents = () => {
    void navigate(`/annotate/caption-frame-extents?videoId=${encodeURIComponent(videoId)}`)
  }

  // Handle jump to annotation
  const handleJump = () => {
    jumpToAnnotation(jumpToAnnotationInput)
    setJumpToAnnotationInput('')
  }

  // Handle lock retry
  const handleLockRetry = () => {
    // Reload the page to retry lock acquisition
    window.location.reload()
  }

  // Handle continue read-only
  const handleContinueReadOnly = () => {
    setShowLockModal(false)
  }

  // Determine lock display state
  const getLockState = () => {
    if (loading && !isReady) return 'loading'
    if (isReady && canEdit) return 'granted'
    if (isReady && !canEdit) return 'denied'
    return 'loading'
  }

  // Lock holder info (placeholder - would need to come from database)
  const lockHolder: LockHolderInfo | null =
    !canEdit && isReady ? { userId: 'unknown', isCurrentUser: false } : null

  // Show loading state while metadata loads
  if (loading && queue.length === 0 && !isReady) {
    return (
      <AppLayout fullScreen>
        <LoadingScreen videoId={videoId} />
        <LockAcquisitionModal
          isOpen={showLockModal}
          lockState={getLockState()}
          lockHolder={lockHolder}
          error={lockError}
          onRetry={handleLockRetry}
          onContinueReadOnly={handleContinueReadOnly}
          onClose={() => setShowLockModal(false)}
        />
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
        {/* Lock Status Banner */}
        <DatabaseLockBanner
          lockState={getLockState()}
          lockHolder={lockHolder}
          canEdit={canEdit}
          className="mb-4"
        />

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
            onTextChange={canEdit ? setText : () => {}}
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
            onTextStatusChange={canEdit ? setTextStatus : () => {}}
            textNotes={textNotes}
            onTextNotesChange={canEdit ? setTextNotes : () => {}}
            onSave={canEdit ? () => void handleSave() : () => {}}
            onSaveEmpty={canEdit ? () => void handleSaveEmptyCaption() : () => {}}
            onPrevious={handlePrevious}
            onSkip={handleSkip}
            canSave={canEdit && !!currentAnnotation}
            hasPrevious={queueIndex > 0}
            hasNext={queueIndex < queue.length - 1}
            onShowHelp={() => setShowHelpModal(true)}
            onSwitchToCaptionFrameExtents={switchToCaptionFrameExtents}
          />
        </div>
      </div>

      <TextAnnotationHelpModal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} />
      <LockAcquisitionModal
        isOpen={showLockModal}
        lockState={getLockState()}
        lockHolder={lockHolder}
        error={lockError}
        onRetry={handleLockRetry}
        onContinueReadOnly={handleContinueReadOnly}
        onClose={() => setShowLockModal(false)}
      />
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
