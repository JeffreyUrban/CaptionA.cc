interface FrameViewerProps {
  videoId: string
  currentFrameIndex: number
  startFrameIndex: number
  endFrameIndex: number
  imageContainerRef?:
    | ((node: HTMLDivElement | null) => (() => void) | undefined)
    | React.RefObject<HTMLDivElement>
  onWheel: (e: React.WheelEvent<HTMLDivElement>) => void
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
}

export function FrameViewer({
  videoId,
  currentFrameIndex,
  startFrameIndex,
  endFrameIndex,
  imageContainerRef,
  onWheel,
  onMouseDown,
}: FrameViewerProps) {
  const framePosition = currentFrameIndex - startFrameIndex + 1
  const totalFrames = endFrameIndex - startFrameIndex + 1

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      {/* Frame info header */}
      <div className="mb-3 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
        <span className="font-medium">Frame {currentFrameIndex}: Image and OCR</span>
        <span className="text-xs">
          ({framePosition} of {totalFrames})
        </span>
      </div>

      {/* Frame image */}
      <div
        ref={imageContainerRef}
        className="active:cursor-grabbing cursor-grab overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        style={{ userSelect: 'none' }}
      >
        <img
          src={`/api/frames/${encodeURIComponent(videoId)}/${currentFrameIndex}.jpg`}
          alt={`Frame ${currentFrameIndex}`}
          className="h-auto w-full"
          draggable={false}
        />
      </div>
    </div>
  )
}
