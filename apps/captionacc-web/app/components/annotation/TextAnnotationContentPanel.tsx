import { CaptionTextForm } from '~/components/annotation/CaptionTextForm'
import { CombinedImageDisplay } from '~/components/annotation/CombinedImageDisplay'
import { FrameViewer } from '~/components/annotation/FrameViewer'
import { PerFrameOCRDisplay } from '~/components/annotation/PerFrameOCRDisplay'
import type { AnnotationData, PerFrameOCRItem, TextStyle } from '~/types/text-annotation'

interface TextAnnotationContentPanelProps {
  videoId: string
  currentAnnotation: AnnotationData | null
  queueLength: number

  // Frame navigation
  currentFrameIndex: number
  onWheel: (e: React.WheelEvent) => void
  onMouseDown: (e: React.MouseEvent) => void
  imageContainerRef: (node: HTMLDivElement | null) => (() => void) | undefined

  // Per-frame OCR
  perFrameOCR: PerFrameOCRItem[]
  loadingFrames: boolean

  // Text state
  text: string
  onTextChange: (text: string) => void
  textStyle: TextStyle
}

/**
 * Content panel for the Text Annotation workflow.
 * Contains the frame viewer, OCR display, text editor, and combined image.
 */
export function TextAnnotationContentPanel({
  videoId,
  currentAnnotation,
  queueLength,
  currentFrameIndex,
  onWheel,
  onMouseDown,
  imageContainerRef,
  perFrameOCR,
  loadingFrames,
  text,
  onTextChange,
  textStyle,
}: TextAnnotationContentPanelProps) {
  if (!currentAnnotation) {
    return (
      <div className="flex h-full w-2/3 items-center justify-center rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="text-center text-gray-500 dark:text-gray-400">
          {queueLength === 0 ? 'No annotations in queue' : 'Loading annotation...'}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-2/3 flex-col gap-4 overflow-y-auto">
      {/* Frame-by-Frame View */}
      <div>
        <FrameViewer
          videoId={videoId}
          currentFrameIndex={currentFrameIndex}
          startFrameIndex={currentAnnotation.annotation.start_frame_index}
          endFrameIndex={currentAnnotation.annotation.end_frame_index}
          imageContainerRef={imageContainerRef}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
        />

        {/* Per-frame OCR text */}
        <PerFrameOCRDisplay
          currentFrameIndex={currentFrameIndex}
          perFrameOCR={perFrameOCR}
          loadingFrames={loadingFrames}
          textStyle={textStyle}
          onTextSelect={onTextChange}
        />
      </div>

      {/* Caption Text Editor */}
      <CaptionTextForm text={text} onChange={onTextChange} textStyle={textStyle} />

      {/* Combined Frames: Image and OCR */}
      <CombinedImageDisplay
        annotation={currentAnnotation.annotation}
        combinedImageUrl={currentAnnotation.combinedImageUrl}
        textStyle={textStyle}
        onTextSelect={onTextChange}
      />
    </div>
  )
}
