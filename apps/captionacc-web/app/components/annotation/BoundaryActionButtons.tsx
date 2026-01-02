type AnnotationState = 'predicted' | 'confirmed' | 'gap'

interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  state: AnnotationState
  pending: boolean
  text: string | null
  created_at?: string
  updated_at?: string
}

interface BoundaryActionButtonsProps {
  canSave: boolean
  isSaving: boolean
  hasPrevAnnotation: boolean
  hasNextAnnotation: boolean
  activeAnnotation: Annotation | null
  onSave: () => void
  onPrevious: () => void
  onNext: () => void
  onDelete: () => void
}

export function BoundaryActionButtons({
  canSave,
  isSaving,
  hasPrevAnnotation,
  hasNextAnnotation,
  activeAnnotation,
  onSave,
  onPrevious,
  onNext,
  onDelete,
}: BoundaryActionButtonsProps) {
  return (
    <div className="space-y-3">
      <button
        onClick={onSave}
        disabled={!canSave || isSaving}
        className={`w-full rounded-md px-4 py-2 text-sm font-semibold text-white ${
          canSave && !isSaving
            ? 'bg-teal-600 hover:bg-teal-700'
            : 'cursor-not-allowed bg-gray-400 dark:bg-gray-700'
        }`}
      >
        {isSaving ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Saving...
          </span>
        ) : (
          <>
            Save & Next <span className="text-xs opacity-75">(Enter)</span>
          </>
        )}
      </button>

      {/* History Navigation */}
      <div className="flex gap-2">
        <button
          onClick={onPrevious}
          disabled={!hasPrevAnnotation}
          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
            hasPrevAnnotation
              ? 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
              : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
          }`}
        >
          ← Previous
        </button>
        <button
          onClick={onNext}
          disabled={!hasNextAnnotation}
          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
            hasNextAnnotation
              ? 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
              : 'cursor-not-allowed border-gray-200 text-gray-400 dark:border-gray-800 dark:text-gray-600'
          }`}
        >
          Next →
        </button>
      </div>

      <button
        onClick={onDelete}
        disabled={!activeAnnotation || activeAnnotation.state === 'gap'}
        className={`w-full rounded-md border-2 px-4 py-2 text-sm font-semibold ${
          activeAnnotation && activeAnnotation.state !== 'gap'
            ? 'border-red-500 text-red-600 hover:bg-red-50 dark:border-red-600 dark:text-red-400 dark:hover:bg-red-950'
            : 'cursor-not-allowed border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-600'
        }`}
      >
        Delete Caption
      </button>
    </div>
  )
}
