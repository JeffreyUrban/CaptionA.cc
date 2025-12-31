interface Frame {
  frame_index: number
  image_url: string
  ocr_text: string
}

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

interface BoundaryFrameStackProps {
  visibleFramePositions: number[]
  frames: Map<number, Frame>
  currentFrameIndex: number
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

export function BoundaryFrameStack({
  visibleFramePositions,
  frames,
  currentFrameIndex,
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
        {visibleFramePositions.map((framePosition, slotIndex) => {
          // Find finest available frame by checking coarsest to finest
          // Check coarsest first (loads first, widest coverage) but keep finest found
          let alignedFrameIndex = framePosition
          let frame = frames.get(alignedFrameIndex)

          if (!frame) {
            // Check from coarse to fine, keeping the finest available
            // Short-circuit if a level is missing (finer levels won't exist yet)
            for (const modulo of [32, 16, 8, 4, 2]) {
              const testIndex = Math.round(framePosition / modulo) * modulo
              const testFrame = frames.get(testIndex)
              if (testFrame) {
                frame = testFrame
                alignedFrameIndex = testIndex
                // Stop if we found the exact frame requested
                if (alignedFrameIndex === framePosition) break
                // Continue checking for finer frames
              } else {
                // Missing this level, finer levels won't exist - stop checking
                break
              }
            }
          }

          // Current indicator based on position, not aligned frame
          const isCurrent = framePosition === currentFrameIndex
          const opacity = getOpacity(framePosition)
          const frameAnnotations = getAnnotationsForFrame(framePosition)

          // Find the primary annotation to display (prefer active annotation)
          const primaryAnnotation =
            frameAnnotations.find(ann => activeAnnotation && ann.id === activeAnnotation.id) ??
            frameAnnotations[0]

          // Determine border classes
          let borderClasses = ''
          let borderColor = ''

          if (primaryAnnotation) {
            borderColor = getAnnotationBorderColor(primaryAnnotation)

            // Check if this frame is at the start or end of the annotation
            const isAnnotationStart = framePosition === primaryAnnotation.start_frame_index
            const isAnnotationEnd = framePosition === primaryAnnotation.end_frame_index

            if (borderColor) {
              // Create continuous border for the annotation
              borderClasses = `border-l-4 border-r-4 ${borderColor}`
              if (isAnnotationStart) {
                borderClasses += ' border-t-4 rounded-t'
              }
              if (isAnnotationEnd) {
                borderClasses += ' border-b-4 rounded-b'
              }
            }
          }

          // Orange border for marked range (what will be saved)
          let orangeBorderClasses = ''
          if (
            markedStart !== null &&
            markedEnd !== null &&
            framePosition >= markedStart &&
            framePosition <= markedEnd
          ) {
            // Create continuous orange border around the marked range
            orangeBorderClasses = 'border-l-4 border-r-4 border-orange-500'
            if (framePosition === markedStart) {
              orangeBorderClasses += ' border-t-4 rounded-t'
            }
            if (framePosition === markedEnd) {
              orangeBorderClasses += ' border-b-4 rounded-b'
            }
          }

          return (
            <div key={slotIndex} className="relative">
              {/* Orange border overlay (not affected by opacity) */}
              {orangeBorderClasses && (
                <div
                  className={`absolute inset-0 pointer-events-none z-10 ${orangeBorderClasses}`}
                  style={{ opacity: 1 }}
                />
              )}

              {/* Current frame indicators - gray triangles on left and right */}
              {isCurrent && (
                <>
                  {/* Left triangle pointing right */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-20"
                    style={{
                      left: '-12px',
                      width: 0,
                      height: 0,
                      borderTop: '12px solid transparent',
                      borderBottom: '12px solid transparent',
                      borderLeft: '12px solid rgb(156, 163, 175)', // gray-400
                    }}
                  />
                  {/* Right triangle pointing left */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 pointer-events-none z-20"
                    style={{
                      right: '-12px',
                      width: 0,
                      height: 0,
                      borderTop: '12px solid transparent',
                      borderBottom: '12px solid transparent',
                      borderRight: '12px solid rgb(156, 163, 175)', // gray-400
                    }}
                  />
                </>
              )}

              {/* Frame container */}
              <div
                onClick={() => {
                  onMarkStart(framePosition)
                }}
                onContextMenu={e => {
                  e.preventDefault()
                  onMarkEnd(framePosition)
                }}
                style={{
                  opacity,
                  aspectRatio:
                    cropWidth > 0 && cropHeight > 0 ? `${cropWidth}/${cropHeight}` : undefined,
                }}
                className={`relative overflow-hidden cursor-pointer ${borderClasses}`}
              >
                {/* Frame image */}
                {frame ? (
                  <img
                    src={frame.image_url}
                    alt={`Frame ${alignedFrameIndex}`}
                    className="w-full"
                    draggable={false}
                    onError={e => {
                      // Fallback for missing images
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      const parent = target.parentElement
                      if (parent) {
                        parent.innerHTML += `
                          <div class="flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400" style="width: 100%; height: 100%;">
                            Frame ${alignedFrameIndex}
                          </div>
                        `
                      }
                    }}
                  />
                ) : (
                  <div className="flex w-full h-full items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    Loading frame {framePosition}...
                  </div>
                )}
              </div>

              {/* Border connector to next frame in marked range */}
              {orangeBorderClasses &&
                framePosition !== markedEnd &&
                slotIndex < visibleFramePositions.length - 1 && (
                  <div
                    className="absolute left-0 right-0 border-l-4 border-r-4 border-orange-500 pointer-events-none"
                    style={{ top: '100%', height: '0.5rem', opacity: 1 }}
                  />
                )}

              {/* Border connector for regular annotation borders */}
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
        })}
      </div>
    </div>
  )
}
