/**
 * Error and processing status screen for Layout annotation workflow.
 * Shows processing status with auto-refresh or error messages with retry option.
 */

interface LayoutErrorScreenProps {
  error: string
  onRetry: () => void
}

export function LayoutErrorScreen({ error, onRetry }: LayoutErrorScreenProps) {
  const isProcessing = error.startsWith('Processing:')

  if (isProcessing) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="max-w-md rounded-lg border border-gray-300 bg-white p-8 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center justify-center">
            <svg
              className="h-12 w-12 animate-spin text-blue-500"
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
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </div>
          <h2 className="mb-2 text-center text-xl font-bold text-gray-900 dark:text-white">
            Video Processing
          </h2>
          <p className="mb-4 text-center text-gray-600 dark:text-gray-400">
            {error.replace('Processing: ', '')}
          </p>
          <p className="mb-6 text-center text-sm text-gray-500 dark:text-gray-500">
            The video is being processed. This page will automatically refresh when ready.
          </p>
          <button
            onClick={onRetry}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Check Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="max-w-md rounded-lg border border-gray-300 bg-white p-8 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 text-center text-red-500">
          <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="mb-2 text-center text-xl font-bold text-gray-900 dark:text-white">
          Error Loading Layout
        </h2>
        <p className="mb-6 text-center text-gray-600 dark:text-gray-400">{error}</p>
        <button
          onClick={onRetry}
          className="w-full rounded-md bg-gray-600 px-4 py-2 text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        >
          Try Again
        </button>
      </div>
    </div>
  )
}
