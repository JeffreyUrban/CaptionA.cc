/**
 * Controls panel for the Caption Frame Extents Annotation workflow.
 * Contains mode toggle, video info, spacing controls, marking controls, and action buttons.
 */

import { CaptionFrameExtentsActionButtons } from './CaptionFrameExtentsActionButtons'
import { CaptionFrameExtentsAnnotationInfo } from './CaptionFrameExtentsAnnotationInfo'
import { CaptionFrameExtentsMarkingControls } from './CaptionFrameExtentsMarkingControls'
import { CaptionFrameExtentsShortcutsPanel } from './CaptionFrameExtentsShortcutsPanel'
import { CaptionFrameExtentsVideoInfo } from './CaptionFrameExtentsVideoInfo'

import type { Annotation, AnnotationState } from '~/caption-frame-extents'

interface CaptionFrameExtentsControlsPanelProps {
  // Video info
  videoId: string
  currentFrameIndex: number
  totalFrames: number
  workflowProgress: number
  completedFrames: number
  jumpToFrameInput: string
  onJumpInputChange: (value: string) => void
  onJump: () => void
  onActivateCurrentFrame: () => void

  // Marking controls
  markedStart: number | null
  markedEnd: number | null
  onJumpToStart: () => void
  onMarkStart: () => void
  onJumpToEnd: () => void
  onMarkEnd: () => void
  onClearMarks: () => void

  // Active annotation
  activeAnnotation: Annotation | null
  canSave: boolean
  isSaving: boolean
  hasPrevAnnotation: boolean
  hasNextAnnotation: boolean
  onSave: () => void
  onPrevious: () => void
  onNext: () => void
  onDelete: () => void
  onMarkAsIssue: () => void

  // Help
  onShowHelp: () => void

  // Mode switching
  onSwitchToText: () => void

  // Helper function
  getEffectiveState: (annotation: Annotation) => 'pending' | AnnotationState
}

export function CaptionFrameExtentsControlsPanel({
  videoId,
  currentFrameIndex,
  totalFrames,
  workflowProgress,
  completedFrames,
  jumpToFrameInput,
  onJumpInputChange,
  onJump,
  onActivateCurrentFrame,
  markedStart,
  markedEnd,
  onJumpToStart,
  onMarkStart,
  onJumpToEnd,
  onMarkEnd,
  onClearMarks,
  activeAnnotation,
  canSave,
  isSaving,
  hasPrevAnnotation,
  hasNextAnnotation,
  onSave,
  onPrevious,
  onNext,
  onDelete,
  onMarkAsIssue,
  onShowHelp,
  onSwitchToText,
  getEffectiveState,
}: CaptionFrameExtentsControlsPanelProps) {
  return (
    <div className="flex h-full w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      {/* Mode toggle */}
      <div className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
        <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
          Caption Frame Extents
        </button>
        <button
          onClick={onSwitchToText}
          className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Text Correction
        </button>
      </div>

      {/* Video info */}
      <CaptionFrameExtentsVideoInfo
        videoId={videoId}
        currentFrameIndex={currentFrameIndex}
        totalFrames={totalFrames}
        workflowProgress={workflowProgress}
        completedFrames={completedFrames}
        jumpToFrameInput={jumpToFrameInput}
        onJumpInputChange={onJumpInputChange}
        onJump={onJump}
        onActivateCurrentFrame={onActivateCurrentFrame}
      />

      {/* Caption Frame Extents */}
      <CaptionFrameExtentsMarkingControls
        markedStart={markedStart}
        markedEnd={markedEnd}
        hasActiveAnnotation={!!activeAnnotation}
        onJumpToStart={onJumpToStart}
        onMarkStart={onMarkStart}
        onJumpToEnd={onJumpToEnd}
        onMarkEnd={onMarkEnd}
        onClearMarks={onClearMarks}
      />

      {/* Active annotation info */}
      {activeAnnotation && (
        <div className="space-y-3">
          <CaptionFrameExtentsAnnotationInfo
            annotation={activeAnnotation}
            getEffectiveState={getEffectiveState}
          />

          {/* Actions */}
          <CaptionFrameExtentsActionButtons
            canSave={canSave}
            isSaving={isSaving}
            hasPrevAnnotation={hasPrevAnnotation}
            hasNextAnnotation={hasNextAnnotation}
            activeAnnotation={activeAnnotation}
            onSave={onSave}
            onPrevious={onPrevious}
            onNext={onNext}
            onDelete={onDelete}
            onMarkAsIssue={onMarkAsIssue}
          />
        </div>
      )}

      {/* Help button */}
      <button
        onClick={onShowHelp}
        className="w-full rounded-md border border-teal-500 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 dark:border-teal-600 dark:bg-teal-950 dark:text-teal-300 dark:hover:bg-teal-900"
      >
        Annotation Guide
      </button>

      {/* Keyboard and mouse shortcuts */}
      <CaptionFrameExtentsShortcutsPanel />
    </div>
  )
}
