import type { Frame } from '~/types/boundaries'

interface FrameViewerProps {
  currentFrameIndex: number
  startFrameIndex: number
  endFrameIndex: number
  frame: Frame | undefined
  imageContainerRef?:
    | ((node: HTMLDivElement | null) => (() => void) | undefined)
    | React.RefObject<HTMLDivElement>
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
}

export function FrameViewer({
  currentFrameIndex,
  startFrameIndex,
  endFrameIndex,
  frame,
  imageContainerRef,
  onMouseDown,
}: FrameViewerProps) {
  const framePosition = currentFrameIndex - startFrameIndex + 1
  const totalFrames = endFrameIndex - startFrameIndex + 1

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      {/* Frame info header */}
      <div className="mb-3 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
        <span className="font-medium">Frame {currentFrameIndex}</span>
        <span className="text-xs">
          ({framePosition} of {totalFrames})
        </span>
      </div>

      {/* Frame image */}
      <div
        ref={imageContainerRef}
        className="active:cursor-grabbing cursor-grab overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800"
        onMouseDown={onMouseDown}
        style={{ userSelect: 'none' }}
      >
        {frame ? (
          <img
            src={frame.image_url}
            alt={`Frame ${currentFrameIndex}`}
            className="h-auto w-full"
            draggable={false}
          />
        ) : (
          <div className="flex h-64 items-center justify-center text-gray-500 dark:text-gray-400">
            Loading frame {currentFrameIndex}...
          </div>
        )}
      </div>
    </div>
  )
}
