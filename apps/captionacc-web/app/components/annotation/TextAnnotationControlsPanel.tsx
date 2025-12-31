import { AnnotationInfoPanel } from '~/components/annotation/AnnotationInfoPanel'
import { TextAnnotationActions } from '~/components/annotation/TextAnnotationActions'
import { TextDisplayControls } from '~/components/annotation/TextDisplayControls'
import { VideoInfoPanel } from '~/components/annotation/VideoInfoPanel'
import type { Annotation, TextAnchor } from '~/types/text-annotation'

interface TextAnnotationControlsPanelProps {
  // Video info
  videoId: string
  queueIndex: number
  queueLength: number
  workflowProgress: number
  completedAnnotations: number

  // Jump to annotation
  jumpToAnnotationInput: string
  onJumpInputChange: (value: string) => void
  onJump: () => void

  // Current annotation
  annotation: Annotation | null

  // Display preferences
  textAnchor: TextAnchor
  textSizePercent: number
  paddingScale: number
  actualTextSize: number
  textControlsExpanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onTextAnchorChange: (anchor: TextAnchor) => void
  onTextSizeChange: (size: number) => void
  onPaddingScaleChange: (scale: number) => void

  // Form state
  textStatus: string
  onTextStatusChange: (status: string) => void
  textNotes: string
  onTextNotesChange: (notes: string) => void

  // Actions
  onSave: () => void
  onSaveEmpty: () => void
  onPrevious: () => void
  onSkip: () => void
  canSave: boolean
  hasPrevious: boolean
  hasNext: boolean

  // Help modal
  onShowHelp: () => void

  // Mode switching
  onSwitchToBoundaries: () => void
}

/**
 * Controls panel for the Text Annotation workflow.
 * Contains all controls in the right sidebar.
 */
export function TextAnnotationControlsPanel({
  videoId,
  queueIndex,
  queueLength,
  workflowProgress,
  completedAnnotations,
  jumpToAnnotationInput,
  onJumpInputChange,
  onJump,
  annotation,
  textAnchor,
  textSizePercent,
  paddingScale,
  actualTextSize,
  textControlsExpanded,
  onExpandedChange,
  onTextAnchorChange,
  onTextSizeChange,
  onPaddingScaleChange,
  textStatus,
  onTextStatusChange,
  textNotes,
  onTextNotesChange,
  onSave,
  onSaveEmpty,
  onPrevious,
  onSkip,
  canSave,
  hasPrevious,
  hasNext,
  onShowHelp,
  onSwitchToBoundaries,
}: TextAnnotationControlsPanelProps) {
  return (
    <div className="flex h-full w-1/3 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      {/* Mode toggle */}
      <ModeToggle onSwitchToBoundaries={onSwitchToBoundaries} />

      {/* Video info */}
      <VideoInfoPanel
        videoId={videoId}
        queueIndex={queueIndex}
        queueLength={queueLength}
        workflowProgress={workflowProgress}
        completedAnnotations={completedAnnotations}
        jumpToAnnotationInput={jumpToAnnotationInput}
        onJumpInputChange={onJumpInputChange}
        onJump={onJump}
      />

      {/* Active annotation info */}
      <AnnotationInfoPanel annotation={annotation} />

      {/* Text Display Controls - Collapsible */}
      <TextDisplayControls
        textAnchor={textAnchor}
        textSizePercent={textSizePercent}
        paddingScale={paddingScale}
        actualTextSize={actualTextSize}
        expanded={textControlsExpanded}
        onExpandedChange={onExpandedChange}
        onTextAnchorChange={anchor => void onTextAnchorChange(anchor)}
        onTextSizeChange={size => void onTextSizeChange(size)}
        onPaddingScaleChange={padding => void onPaddingScaleChange(padding)}
      />

      {/* Status */}
      <StatusSelect value={textStatus} onChange={onTextStatusChange} />

      {/* Notes */}
      <NotesTextarea value={textNotes} onChange={onTextNotesChange} />

      {/* Action Buttons */}
      <TextAnnotationActions
        onSave={onSave}
        onSaveEmpty={onSaveEmpty}
        onPrevious={onPrevious}
        onSkip={onSkip}
        canSave={canSave}
        hasPrevious={hasPrevious}
        hasNext={hasNext}
      />

      {/* Help button */}
      <button
        onClick={onShowHelp}
        className="w-full rounded-md border border-teal-500 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-100 dark:border-teal-600 dark:bg-teal-950 dark:text-teal-300 dark:hover:bg-teal-900"
      >
        Annotation Guide
      </button>

      {/* Keyboard shortcuts */}
      <KeyboardShortcutsPanel />
    </div>
  )
}

// --- Sub-components ---

interface ModeToggleProps {
  onSwitchToBoundaries: () => void
}

function ModeToggle({ onSwitchToBoundaries }: ModeToggleProps) {
  return (
    <div className="flex gap-2 rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
      <button
        onClick={onSwitchToBoundaries}
        className="flex-1 rounded py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
      >
        Boundaries
      </button>
      <button className="flex-1 rounded py-2 text-sm font-semibold bg-teal-600 text-white">
        Text Correction
      </button>
    </div>
  )
}

interface StatusSelectProps {
  value: string
  onChange: (value: string) => void
}

function StatusSelect({ value, onChange }: StatusSelectProps) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
        Status
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      >
        <option value="valid_caption">Valid Caption</option>
        <option value="ocr_error">OCR Error</option>
        <option value="partial_caption">Partial Caption</option>
        <option value="text_unclear">Text Unclear</option>
        <option value="other_issue">Other Issue</option>
      </select>
    </div>
  )
}

interface NotesTextareaProps {
  value: string
  onChange: (value: string) => void
}

function NotesTextarea({ value, onChange }: NotesTextareaProps) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
        Notes
      </label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        placeholder="Optional notes about this annotation..."
      />
    </div>
  )
}

function KeyboardShortcutsPanel() {
  return (
    <details className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
      <summary className="cursor-pointer p-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
        Keyboard Shortcuts
      </summary>
      <div className="space-y-1 p-3 pt-1 text-xs text-gray-600 dark:text-gray-400">
        <div>
          <strong>Frame Navigation:</strong>
        </div>
        <div>Up Arrow : Previous frame</div>
        <div>Down Arrow : Next frame</div>
        <div className="mt-2">
          <strong>Annotation Navigation:</strong>
        </div>
        <div>Left Arrow : Previous annotation</div>
        <div>Right Arrow : Skip to next</div>
        <div className="mt-2">
          <strong>Actions:</strong>
        </div>
        <div>Enter: Save & Next (requires text)</div>
        <div>Ctrl+E: Save Empty Caption</div>
      </div>
    </details>
  )
}
