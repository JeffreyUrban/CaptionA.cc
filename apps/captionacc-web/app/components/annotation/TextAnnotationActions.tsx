interface TextAnnotationActionsProps {
  onSave: () => void
  onSaveEmpty: () => void
  onPrevious: () => void
  onSkip: () => void
  canSave: boolean
  hasPrevious: boolean
  hasNext: boolean
}

export function TextAnnotationActions({
  onSave,
  onSaveEmpty,
  onPrevious,
  onSkip,
  canSave,
  hasPrevious,
  hasNext,
}: TextAnnotationActionsProps) {
  return (
    <div className="space-y-3">
      {/* Primary Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onSave}
          disabled={!canSave}
          className={`rounded-lg px-4 py-3 font-semibold ${
            canSave
              ? 'bg-teal-600 text-white hover:bg-teal-700'
              : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-600'
          }`}
        >
          Save Caption
        </button>
        <button
          onClick={onSaveEmpty}
          className="rounded-lg bg-orange-600 px-4 py-3 font-semibold text-white hover:bg-orange-700"
        >
          Save Empty Caption
        </button>
      </div>

      {/* Navigation Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onPrevious}
          disabled={!hasPrevious}
          className={`rounded-lg px-4 py-2 font-medium ${
            hasPrevious
              ? 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
          }`}
        >
          ← Previous
        </button>
        <button
          onClick={onSkip}
          disabled={!hasNext}
          className={`rounded-lg px-4 py-2 font-medium ${
            hasNext
              ? 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
          }`}
        >
          Skip →
        </button>
      </div>

      {/* Keyboard Hints */}
      <div className="rounded-md bg-gray-50 p-2 text-xs text-gray-600 dark:bg-gray-950 dark:text-gray-400">
        <div className="font-semibold">Shortcuts:</div>
        <div className="mt-1 space-y-0.5">
          <div>
            <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono dark:bg-gray-800">
              Enter
            </kbd>{' '}
            Save
          </div>
          <div>
            <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono dark:bg-gray-800">
              Ctrl+E
            </kbd>{' '}
            Save Empty
          </div>
          <div>
            <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono dark:bg-gray-800">←</kbd>{' '}
            Previous
          </div>
          <div>
            <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono dark:bg-gray-800">→</kbd>{' '}
            Skip
          </div>
        </div>
      </div>
    </div>
  )
}
