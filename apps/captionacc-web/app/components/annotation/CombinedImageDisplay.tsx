interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  caption_ocr: string | null
}

interface CombinedImageDisplayProps {
  annotation: Annotation
  combinedImageUrl: string
  textStyle: React.CSSProperties
  onTextSelect: (text: string) => void
}

export function CombinedImageDisplay({
  annotation,
  combinedImageUrl,
  textStyle,
  onTextSelect,
}: CombinedImageDisplayProps) {
  const handleClick = () => {
    if (annotation.caption_ocr) {
      onTextSelect(annotation.caption_ocr)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (annotation.caption_ocr) {
        onTextSelect(annotation.caption_ocr)
      }
    }
  }

  const totalFrames = annotation.end_frame_index - annotation.start_frame_index + 1

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="p-4">
        {/* Combined image */}
        <div className="overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
          <img
            src={combinedImageUrl}
            alt={`Annotation ${annotation.id}`}
            className="h-auto w-full"
          />
        </div>

        {/* Combined OCR text */}
        <div className="mt-3">
          <div
            className="rounded-lg bg-gray-50 font-mono whitespace-pre-wrap dark:bg-gray-950 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            style={textStyle}
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            title="Click to copy to Caption Text"
          >
            {annotation.caption_ocr ?? '(No OCR text available)'}
          </div>
        </div>

        {/* Title at bottom */}
        <div className="mt-3 text-sm text-gray-600 dark:text-gray-400 font-medium">
          Combined Frames {annotation.start_frame_index} - {annotation.end_frame_index} (
          {totalFrames} frames): Image and OCR
        </div>
      </div>
    </div>
  )
}
