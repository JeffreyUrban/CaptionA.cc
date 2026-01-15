import { useState } from 'react'

import type { Annotation } from '~/caption-frame-extents'

interface CaptionFrameExtentsActionButtonsProps {
  canSave: boolean
  isSaving: boolean
  hasPrevAnnotation: boolean
  hasNextAnnotation: boolean
  activeAnnotation: Annotation | null
  onSave: () => void
  onPrevious: () => void
  onNext: () => void
  onDelete: () => void
  onMarkAsIssue: () => void
}

export function CaptionFrameExtentsActionButtons({
  canSave,
  isSaving,
  hasPrevAnnotation,
  hasNextAnnotation,
  activeAnnotation,
  onSave,
  onPrevious,
  onNext,
  onDelete,
  onMarkAsIssue,
}: CaptionFrameExtentsActionButtonsProps) {
  const [showIssueConfirm, setShowIssueConfirm] = useState(false)

  const handleMarkAsIssue = () => {
    setShowIssueConfirm(false)
    onMarkAsIssue()
  }

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

      <button
        onClick={() => setShowIssueConfirm(true)}
        disabled={!canSave}
        className={`w-full rounded-md border-2 px-4 py-2 text-sm font-semibold ${
          canSave
            ? 'border-purple-700 text-purple-600 hover:bg-purple-100 dark:border-purple-700 dark:text-purple-400 dark:hover:bg-purple-950'
            : 'cursor-not-allowed border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-600'
        }`}
      >
        Mark as Issue
      </button>

      {/* Confirmation Dialog */}
      {showIssueConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Mark as Issue?
            </h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              This will mark the caption frame extents as having an issue (e.g. not cleanly
              bounded).
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setShowIssueConfirm(false)}
                className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkAsIssue}
                className="flex-1 rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
