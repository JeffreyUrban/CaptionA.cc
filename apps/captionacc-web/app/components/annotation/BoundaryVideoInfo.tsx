interface BoundaryVideoInfoProps {
  videoId: string
  currentFrameIndex: number
  totalFrames: number
  workflowProgress: number
  completedFrames: number
  jumpToFrameInput: string
  onJumpInputChange: (value: string) => void
  onJump: () => void
  onActivateCurrentFrame: () => void
}

export function BoundaryVideoInfo({
  videoId,
  currentFrameIndex,
  totalFrames,
  workflowProgress,
  completedFrames,
  jumpToFrameInput,
  onJumpInputChange,
  onJump,
  onActivateCurrentFrame,
}: BoundaryVideoInfoProps) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">Video</div>
      <div className="text-lg font-bold text-gray-900 dark:text-white">{videoId}</div>
      <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Frame: {currentFrameIndex.toLocaleString()} / {totalFrames.toLocaleString()}
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
        Progress: {workflowProgress.toFixed(2)}% ({completedFrames.toLocaleString()} /{' '}
        {totalFrames.toLocaleString()} completed)
      </div>

      {/* Jump to frame */}
      <div className="mt-3 flex gap-2">
        <input
          type="number"
          value={jumpToFrameInput}
          onChange={e => onJumpInputChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onJump()
          }}
          placeholder="Frame #"
          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        />
        <button
          onClick={onJump}
          disabled={!jumpToFrameInput}
          className={`rounded-md px-3 py-1 text-sm font-medium ${
            jumpToFrameInput
              ? 'bg-teal-600 text-white hover:bg-teal-700'
              : 'cursor-not-allowed bg-gray-300 text-gray-500 dark:bg-gray-700 dark:text-gray-600'
          }`}
        >
          Jump
        </button>
      </div>

      {/* Activate current frame's annotation */}
      <button
        onClick={onActivateCurrentFrame}
        className="mt-2 w-full rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        Activate Current Frame
      </button>
    </div>
  )
}
