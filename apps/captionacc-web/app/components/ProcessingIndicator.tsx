import type { ProcessingStatus } from '~/hooks/useProcessingStatus'

interface ProcessingIndicatorProps {
  status: ProcessingStatus
  className?: string
}

/**
 * Visual indicator for background processing operations.
 *
 * Shows a spinner and message during streaming updates or full retrains.
 * Displays progress information when available.
 */
export function ProcessingIndicator({ status, className = '' }: ProcessingIndicatorProps) {
  if (!status.isProcessing) {
    return null
  }

  const message =
    status.type === 'streaming_update' ? 'Updating predictions...' : 'Retraining model...'

  return (
    <div
      className={`flex items-center gap-2 rounded-md border border-amber-400 bg-amber-50 px-4 py-3 ${className}`}
    >
      {/* Spinner */}
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />

      {/* Message */}
      <span className="text-sm font-medium text-amber-900">{message}</span>

      {/* Progress message */}
      {status.progress?.message && (
        <span className="ml-auto text-sm text-amber-700">{status.progress.message}</span>
      )}
    </div>
  )
}
