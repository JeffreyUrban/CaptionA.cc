interface CaptionFrameExtentsMarkingControlsProps {
  markedStart: number | null
  markedEnd: number | null
  hasActiveAnnotation: boolean
  onJumpToStart: () => void
  onMarkStart: () => void
  onJumpToEnd: () => void
  onMarkEnd: () => void
  onClearMarks: () => void
}

export function CaptionFrameExtentsMarkingControls({
  markedStart,
  markedEnd,
  hasActiveAnnotation,
  onJumpToStart,
  onMarkStart,
  onJumpToEnd,
  onMarkEnd,
  onClearMarks,
}: CaptionFrameExtentsMarkingControlsProps) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
        Caption Frame Extents
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
          onClick={onJumpToStart}
          disabled={!hasActiveAnnotation}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            hasActiveAnnotation
              ? 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
              : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
          }`}
        >
          Jump Start <span className="text-xs text-gray-500">(A)</span>
        </button>
        <button
          onClick={onMarkStart}
          disabled={!hasActiveAnnotation}
          className={`rounded-md px-3 py-2 text-sm font-semibold ${
            hasActiveAnnotation
              ? 'bg-orange-500 text-white hover:bg-orange-600'
              : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-600'
          }`}
        >
          Mark Start <span className="text-xs opacity-75">(S)</span>
        </button>
        <button
          onClick={onJumpToEnd}
          disabled={!hasActiveAnnotation}
          className={`rounded-md border px-3 py-2 text-sm font-medium ${
            hasActiveAnnotation
              ? 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
              : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
          }`}
        >
          Jump End <span className="text-xs text-gray-500">(F)</span>
        </button>
        <button
          onClick={onMarkEnd}
          disabled={!hasActiveAnnotation}
          className={`rounded-md px-3 py-2 text-sm font-semibold ${
            hasActiveAnnotation
              ? 'bg-orange-500 text-white hover:bg-orange-600'
              : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-600'
          }`}
        >
          Mark End <span className="text-xs opacity-75">(D)</span>
        </button>
      </div>

      <button
        onClick={onClearMarks}
        disabled={!hasActiveAnnotation}
        className={`mt-2 w-full rounded-md border px-4 py-2 text-sm font-medium ${
          hasActiveAnnotation
            ? 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
            : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
        }`}
      >
        Clear Marks
      </button>
    </div>
  )
}
