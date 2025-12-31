interface VideoInfoPanelProps {
  videoId: string
  queueIndex: number
  queueLength: number
  workflowProgress: number
  completedAnnotations: number
  jumpToAnnotationInput: string
  onJumpInputChange: (value: string) => void
  onJump: () => void
}

export function VideoInfoPanel({
  videoId,
  queueIndex,
  queueLength,
  workflowProgress,
  completedAnnotations,
  jumpToAnnotationInput,
  onJumpInputChange,
  onJump,
}: VideoInfoPanelProps) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">Video</div>
      <div className="text-lg font-bold text-gray-900 dark:text-white">{videoId}</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Annotation: {queueIndex + 1} / {queueLength}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
        Progress: {workflowProgress.toFixed(2)}% ({completedAnnotations} completed)
      </div>

      {/* Jump to annotation */}
      <div className="mt-3 flex gap-2">
        <input
          type="number"
          value={jumpToAnnotationInput}
          onChange={e => onJumpInputChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onJump()}
          placeholder="Annotation ID"
          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        />
        <button
          onClick={onJump}
          disabled={!jumpToAnnotationInput}
          className={`rounded-md px-3 py-1 text-sm font-medium ${
            jumpToAnnotationInput
              ? 'bg-teal-600 text-white hover:bg-teal-700'
              : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-600'
          }`}
        >
          Jump
        </button>
      </div>
    </div>
  )
}
