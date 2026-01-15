import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { CaptionFrameExtentsControlsPanel } from '~/components/annotation/CaptionFrameExtentsControlsPanel'
import { CaptionFrameExtentsFrameStack } from '~/components/annotation/CaptionFrameExtentsFrameStack'
import { CaptionFrameExtentsHelpModal } from '~/components/annotation/CaptionFrameExtentsHelpModal'
import { CompletionBanner } from '~/components/annotation/CompletionBanner'
import { DatabaseLockBanner, type LockHolderInfo } from '~/components/annotation/DatabaseLockBanner'
import { LockAcquisitionModal } from '~/components/annotation/LockAcquisitionModal'
import { useCaptionFrameExtentsWorkflowState } from '~/hooks/useCaptionFrameExtentsWorkflowState'
import { useImageRegeneration } from '~/hooks/useImageRegeneration'
import { getAnnotationBorderColor, getEffectiveState } from '~/utils/caption-frame-extents-helpers'

// Loader function to expose environment variables
export async function loader() {
  return {
    defaultVideoId: process.env['DEFAULT_VIDEO_ID'] ?? '',
  }
}

// eslint-disable-next-line complexity -- Component with multiple conditional rendering paths for different workflow states
export default function CaptionFrameExtentsWorkflow() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const videoId = searchParams.get('videoId') ?? ''

  // Lock modal state
  const [showLockModal, setShowLockModal] = useState(true)
  const lockError: string | null = null

  const workflow = useCaptionFrameExtentsWorkflowState({ videoId })

  // Opportunistically process pending image regenerations during idle time
  useImageRegeneration({ videoId, enabled: true, idleDelay: 3000, maxBatch: 3 })

  // Close lock modal when ready
  useEffect(() => {
    if (workflow.isReady) {
      setShowLockModal(false)
    }
  }, [workflow.isReady])

  // Switch to text correction mode
  const switchToText = () => {
    void navigate(`/annotate/text?videoId=${encodeURIComponent(videoId)}`)
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
    if (workflow.isLoadingMetadata || !workflow.isInitialized) return 'loading'
    if (workflow.isReady && workflow.canEdit) return 'granted'
    if (workflow.isReady && !workflow.canEdit) return 'denied'
    return 'loading'
  }

  // Lock holder info (placeholder - would need to come from database)
  const lockHolder: LockHolderInfo | null =
    !workflow.canEdit && workflow.isReady ? { userId: 'unknown', isCurrentUser: false } : null

  // Loading state - wait for metadata AND initial position
  if (workflow.isLoadingMetadata || !workflow.isInitialized) {
    return (
      <AppLayout fullScreen>
        <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
          <div className="text-center">
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {workflow.isLoadingMetadata ? 'Loading video metadata...' : 'Loading annotations...'}
            </div>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{videoId}</div>
          </div>
        </div>
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

  const { displayState, visibleFramePositions, canSave, totalFrames, cropWidth, cropHeight } =
    workflow

  return (
    <AppLayout fullScreen>
      <div className="flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] flex-col overflow-hidden px-4 py-4">
        {/* Lock Status Banner */}
        <DatabaseLockBanner lockState={getLockState()} lockHolder={lockHolder} className="mb-4" />

        <CompletionBanner workflowProgress={displayState.workflowProgress || 0} />

        <div className="flex h-full flex-1 gap-6 overflow-hidden">
          <CaptionFrameExtentsFrameStack
            visibleFramePositions={visibleFramePositions}
            frames={displayState.frames}
            currentFrameIndex={displayState.currentFrameIndex}
            totalFrames={totalFrames}
            markedStart={displayState.markedStart}
            markedEnd={displayState.markedEnd}
            activeAnnotation={displayState.activeAnnotation}
            cropWidth={cropWidth}
            cropHeight={cropHeight}
            cursorStyle={displayState.cursorStyle}
            getOpacity={workflow.getOpacity}
            getAnnotationsForFrame={workflow.getAnnotationsForFrame}
            getAnnotationBorderColor={getAnnotationBorderColor}
            onDragStart={workflow.handleDragStart}
            onMarkStart={workflow.canEdit ? workflow.markStartAt : () => {}}
            onMarkEnd={workflow.canEdit ? workflow.markEndAt : () => {}}
          />

          <CaptionFrameExtentsControlsPanel
            videoId={videoId}
            currentFrameIndex={displayState.currentFrameIndex}
            totalFrames={totalFrames}
            workflowProgress={displayState.workflowProgress || 0}
            completedFrames={displayState.completedFrames || 0}
            jumpToFrameInput={workflow.jumpToFrameInput}
            onJumpInputChange={workflow.setJumpToFrameInput}
            onJump={() => void workflow.jumpToFrame()}
            onActivateCurrentFrame={() => void workflow.activateCurrentFrameAnnotation()}
            markedStart={displayState.markedStart}
            markedEnd={displayState.markedEnd}
            onJumpToStart={workflow.jumpToStart}
            onMarkStart={workflow.canEdit ? workflow.markStart : () => {}}
            onJumpToEnd={workflow.jumpToEnd}
            onMarkEnd={workflow.canEdit ? workflow.markEnd : () => {}}
            onClearMarks={workflow.canEdit ? workflow.clearMarks : () => {}}
            activeAnnotation={displayState.activeAnnotation}
            canSave={workflow.canEdit && canSave}
            isSaving={workflow.isSaving}
            hasPrevAnnotation={displayState.hasPrevAnnotation}
            hasNextAnnotation={displayState.hasNextAnnotation}
            onSave={workflow.canEdit ? () => void workflow.saveAnnotation() : () => {}}
            onPrevious={() => void workflow.navigateToAnnotation('prev')}
            onNext={() => void workflow.navigateToAnnotation('next')}
            onDelete={workflow.canEdit ? () => void workflow.deleteAnnotation() : () => {}}
            onMarkAsIssue={workflow.canEdit ? () => void workflow.markAsIssue() : () => {}}
            onShowHelp={() => workflow.setShowHelpModal(true)}
            onSwitchToText={switchToText}
            getEffectiveState={getEffectiveState}
          />
        </div>
      </div>

      <CaptionFrameExtentsHelpModal
        isOpen={workflow.showHelpModal}
        onClose={() => workflow.setShowHelpModal(false)}
      />
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
