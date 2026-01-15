import type { Frame, Annotation } from '~/types/boundaries'

interface BoundaryFrameStackProps {
  visibleFramePositions: number[]
  frames: Map<number, Frame>
  currentFrameIndex: number
  totalFrames: number
  markedStart: number | null
  markedEnd: number | null
  activeAnnotation: Annotation | null
  cropWidth: number
  cropHeight: number
  cursorStyle: 'grab' | 'grabbing'
  getOpacity: (framePosition: number) => number
  getAnnotationsForFrame: (framePosition: number) => Annotation[]
  getAnnotationBorderColor: (annotation: Annotation) => string
  onDragStart: (e: React.MouseEvent<HTMLDivElement>) => void
  onMarkStart: (framePosition: number) => void
  onMarkEnd: (framePosition: number) => void
}

interface FrameSlotProps {
  framePosition: number
  slotIndex: number
  frames: Map<number, Frame>
  totalFrames: number
  currentFrameIndex: number
  markedStart: number | null
  markedEnd: number | null
  activeAnnotation: Annotation | null
  cropWidth: number
  cropHeight: number
  getOpacity: (framePosition: number) => number
  getAnnotationsForFrame: (framePosition: number) => Annotation[]
  getAnnotationBorderColor: (annotation: Annotation) => string
  onMarkStart: (framePosition: number) => void
  onMarkEnd: (framePosition: number) => void
  visibleFramePositions: number[]
}

interface FrameInterpolationData {
  exactFrame?: Frame
  prevFrame?: Frame
  prevFrameIndex?: number
  nextFrame?: Frame
  nextFrameIndex?: number
  prevOpacity: number
  nextOpacity: number
}

function findInterpolatedFrames(
  framePosition: number,
  frames: Map<number, Frame>,
  totalFrames: number
): FrameInterpolationData {
  const exactFrame = frames.get(framePosition)
  if (exactFrame) {
    return { exactFrame, prevOpacity: 1, nextOpacity: 1 }
  }

  const searchRange = 32
  let prevFrame: Frame | undefined
  let prevFrameIndex: number | undefined
  let nextFrame: Frame | undefined
  let nextFrameIndex: number | undefined

  // Find nearest previous frame
  for (let i = framePosition - 1; i >= Math.max(0, framePosition - searchRange); i--) {
    if (frames.has(i)) {
      prevFrame = frames.get(i)
      prevFrameIndex = i
      break
    }
  }

  // Find nearest next frame
  for (
    let i = framePosition + 1;
    i <= Math.min(totalFrames - 1, framePosition + searchRange);
    i++
  ) {
    if (frames.has(i)) {
      nextFrame = frames.get(i)
      nextFrameIndex = i
      break
    }
  }

  let prevOpacity = 1
  let nextOpacity = 1

  // Calculate linear interpolation weights if we have both neighbors
  if (prevFrame && nextFrame && prevFrameIndex !== undefined && nextFrameIndex !== undefined) {
    const totalDist = nextFrameIndex - prevFrameIndex
    prevOpacity = (nextFrameIndex - framePosition) / totalDist
    nextOpacity = (framePosition - prevFrameIndex) / totalDist
  }

  return { prevFrame, prevFrameIndex, nextFrame, nextFrameIndex, prevOpacity, nextOpacity }
}

interface FrameImageProps {
  framePosition: number
  interpolation: FrameInterpolationData
}

function FrameImage({ framePosition, interpolation }: FrameImageProps) {
  const {
    exactFrame,
    prevFrame,
    prevFrameIndex,
    nextFrame,
    nextFrameIndex,
    prevOpacity,
    nextOpacity,
  } = interpolation

  if (exactFrame) {
    return (
      <img
        src={exactFrame.image_url}
        alt={`Frame ${framePosition}`}
        className="w-full"
        draggable={false}
        onError={e => {
          const target = e.target as HTMLImageElement
          target.style.display = 'none'
          const parent = target.parentElement
          if (parent) {
            parent.innerHTML += `
              <div class="flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400" style="width: 100%; height: 100%;">
                Frame ${framePosition}
              </div>
            `
          }
        }}
      />
    )
  }

  if (prevFrame && nextFrame) {
    return (
      <div className="relative w-full h-full">
        <img
          src={prevFrame.image_url}
          alt={`Frame ${prevFrameIndex} (prev)`}
          className="absolute inset-0 w-full"
          style={{ opacity: prevOpacity }}
          draggable={false}
        />
        <img
          src={nextFrame.image_url}
          alt={`Frame ${nextFrameIndex} (next)`}
          className="absolute inset-0 w-full"
          style={{ opacity: nextOpacity }}
          draggable={false}
        />
      </div>
    )
  }

  if (prevFrame) {
    return (
      <img
        src={prevFrame.image_url}
        alt={`Frame ${prevFrameIndex}`}
        className="w-full"
        draggable={false}
      />
    )
  }

  return (
    <div className="flex w-full h-full items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
      Loading frame {framePosition}...
    </div>
  )
}

function getAnnotationBorderClasses(
  framePosition: number,
  primaryAnnotation: Annotation | undefined,
  getAnnotationBorderColor: (annotation: Annotation) => string
): { borderClasses: string; borderColor: string } {
  if (!primaryAnnotation) {
    return { borderClasses: '', borderColor: '' }
  }

  const borderColor = getAnnotationBorderColor(primaryAnnotation)
  if (!borderColor) {
    return { borderClasses: '', borderColor: '' }
  }

  const isAnnotationStart = framePosition === primaryAnnotation.start_frame_index
  const isAnnotationEnd = framePosition === primaryAnnotation.end_frame_index

  let borderClasses = `border-l-4 border-r-4 ${borderColor}`
  if (isAnnotationStart) borderClasses += ' border-t-4 rounded-t'
  if (isAnnotationEnd) borderClasses += ' border-b-4 rounded-b'

  return { borderClasses, borderColor }
}

function getMarkedRangeBorderClasses(
  framePosition: number,
  markedStart: number | null,
  markedEnd: number | null
): string {
  if (
    markedStart === null ||
    markedEnd === null ||
    framePosition < markedStart ||
    framePosition > markedEnd
  ) {
    return ''
  }

  let classes = 'border-l-4 border-r-4 border-orange-500'
  if (framePosition === markedStart) classes += ' border-t-4 rounded-t'
  if (framePosition === markedEnd) classes += ' border-b-4 rounded-b'

  return classes
}

function FrameSlot({
  framePosition,
  slotIndex,
  frames,
  totalFrames,
  currentFrameIndex,
  markedStart,
  markedEnd,
  activeAnnotation,
  cropWidth,
  cropHeight,
  getOpacity,
  getAnnotationsForFrame,
  getAnnotationBorderColor,
  onMarkStart,
  onMarkEnd,
  visibleFramePositions,
}: FrameSlotProps) {
  if (framePosition < 0 || framePosition >= totalFrames) {
    return null
  }

  const interpolation = findInterpolatedFrames(framePosition, frames, totalFrames)
  const isCurrent = framePosition === currentFrameIndex
  const opacity = getOpacity(framePosition)
  const frameAnnotations = getAnnotationsForFrame(framePosition)
  const primaryAnnotation =
    frameAnnotations.find(ann => ann.id === activeAnnotation?.id) ?? frameAnnotations[0]

  const { borderClasses, borderColor } = getAnnotationBorderClasses(
    framePosition,
    primaryAnnotation,
    getAnnotationBorderColor
  )

  const orangeBorderClasses = getMarkedRangeBorderClasses(framePosition, markedStart, markedEnd)

  return (
    <div key={slotIndex} className="relative">
      {orangeBorderClasses && (
        <div
          className={`absolute inset-0 pointer-events-none z-10 ${orangeBorderClasses}`}
          style={{ opacity: 1 }}
        />
      )}

      {isCurrent && (
        <>
          <div
            className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-20"
            style={{
              left: '-12px',
              width: 0,
              height: 0,
              borderTop: '12px solid transparent',
              borderBottom: '12px solid transparent',
              borderLeft: '12px solid rgb(156, 163, 175)',
            }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-20"
            style={{
              right: '-12px',
              width: 0,
              height: 0,
              borderTop: '12px solid transparent',
              borderBottom: '12px solid transparent',
              borderRight: '12px solid rgb(156, 163, 175)',
            }}
          />
        </>
      )}

      <div
        onClick={() => onMarkStart(framePosition)}
        onContextMenu={e => {
          e.preventDefault()
          onMarkEnd(framePosition)
        }}
        style={{
          opacity,
          aspectRatio: cropWidth > 0 && cropHeight > 0 ? `${cropWidth}/${cropHeight}` : undefined,
        }}
        className={`relative overflow-hidden cursor-pointer ${borderClasses}`}
      >
        <FrameImage framePosition={framePosition} interpolation={interpolation} />
      </div>

      {orangeBorderClasses &&
        framePosition !== markedEnd &&
        slotIndex < visibleFramePositions.length - 1 && (
          <div
            className="absolute left-0 right-0 border-l-4 border-r-4 border-orange-500 pointer-events-none"
            style={{ top: '100%', height: '0.5rem', opacity: 1 }}
          />
        )}

      {primaryAnnotation &&
        borderColor &&
        framePosition !== primaryAnnotation.end_frame_index &&
        slotIndex < visibleFramePositions.length - 1 && (
          <div
            className={`absolute left-0 right-0 border-l-4 border-r-4 ${borderColor} pointer-events-none`}
            style={{ top: '100%', height: '0.25rem', opacity }}
          />
        )}
    </div>
  )
}

export function BoundaryFrameStack({
  visibleFramePositions,
  frames,
  currentFrameIndex,
  totalFrames,
  markedStart,
  markedEnd,
  activeAnnotation,
  cropWidth,
  cropHeight,
  cursorStyle,
  getOpacity,
  getAnnotationsForFrame,
  getAnnotationBorderColor,
  onDragStart,
  onMarkStart,
  onMarkEnd,
}: BoundaryFrameStackProps) {
  return (
    <div
      className={`frame-stack-container relative flex h-full w-2/3 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 cursor-${cursorStyle}`}
      onMouseDown={onDragStart}
    >
      <div className="flex h-full flex-1 flex-col justify-center gap-1 overflow-hidden p-4">
        {visibleFramePositions.map((framePosition, slotIndex) => (
          <FrameSlot
            key={slotIndex}
            framePosition={framePosition}
            slotIndex={slotIndex}
            frames={frames}
            totalFrames={totalFrames}
            currentFrameIndex={currentFrameIndex}
            markedStart={markedStart}
            markedEnd={markedEnd}
            activeAnnotation={activeAnnotation}
            cropWidth={cropWidth}
            cropHeight={cropHeight}
            getOpacity={getOpacity}
            getAnnotationsForFrame={getAnnotationsForFrame}
            getAnnotationBorderColor={getAnnotationBorderColor}
            onMarkStart={onMarkStart}
            onMarkEnd={onMarkEnd}
            visibleFramePositions={visibleFramePositions}
          />
        ))}
      </div>
    </div>
  )
}
