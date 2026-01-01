/**
 * Controls panel for the Boundary Annotation workflow.
 * Contains mode toggle, video info, spacing controls, marking controls, and action buttons.
 */

import { BoundaryActionButtons } from './BoundaryActionButtons'
import { BoundaryAnnotationInfo } from './BoundaryAnnotationInfo'
import { BoundaryMarkingControls } from './BoundaryMarkingControls'
import { BoundaryShortcutsPanel } from './BoundaryShortcutsPanel'
import { BoundarySpacingControl } from './BoundarySpacingControl'
import { BoundaryVideoInfo } from './BoundaryVideoInfo'

import type { Annotation, AnnotationState, FrameSpacing } from '~/types/boundaries'

interface BoundaryControlsPanelProps {
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

  // Frame spacing
  frameSpacing: FrameSpacing
  onFrameSpacingChange: (spacing: FrameSpacing) => void

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

  // Help
  onShowHelp: () => void

  // Helper function
  getEffectiveState: (annotation: Annotation) => 'pending' | AnnotationState
}

export function BoundaryControlsPanel({
  videoId,
  currentFrameIndex,
  totalFrames,
  workflowProgress,
  completedFrames,
  jumpToFrameInput,
  onJumpInputChange,
  onJump,
  onActivateCurrentFrame,
  frameSpacing,
  onFrameSpacingChange,
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
  onShowHelp,
  getEffectiveState,
}: BoundaryControlsPanelProps) {
  return (
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
      <BoundaryVideoInfo
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

      {/* Frame spacing */}
      <BoundarySpacingControl frameSpacing={frameSpacing} onChange={onFrameSpacingChange} />

      {/* Boundaries */}
      <BoundaryMarkingControls
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
          <BoundaryAnnotationInfo
            annotation={activeAnnotation}
            getEffectiveState={getEffectiveState}
          />

          {/* Actions */}
          <BoundaryActionButtons
            canSave={canSave}
            isSaving={isSaving}
            hasPrevAnnotation={hasPrevAnnotation}
            hasNextAnnotation={hasNextAnnotation}
            activeAnnotation={activeAnnotation}
            onSave={onSave}
            onPrevious={onPrevious}
            onNext={onNext}
            onDelete={onDelete}
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
      <BoundaryShortcutsPanel />
    </div>
  )
}
