interface PerFrameOCRDisplayProps {
  currentFrameIndex: number
  perFrameOCR: Array<{ frameIndex: number; ocrText: string }>
  loadingFrames: boolean
  textStyle: React.CSSProperties
  onTextSelect: (text: string) => void
}

export function PerFrameOCRDisplay({
  currentFrameIndex,
  perFrameOCR,
  loadingFrames,
  textStyle,
  onTextSelect,
}: PerFrameOCRDisplayProps) {
  const currentFrameText = perFrameOCR.find(f => f.frameIndex === currentFrameIndex)?.ocrText

  const handleClick = () => {
    if (currentFrameText) onTextSelect(currentFrameText)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (currentFrameText) onTextSelect(currentFrameText)
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mt-3">
        {loadingFrames ? (
          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-950 dark:text-gray-400">
            Loading frame OCR data...
          </div>
        ) : (
          <div
            className="rounded-lg bg-gray-50 font-mono whitespace-pre-wrap dark:bg-gray-950 dark:text-gray-300 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            style={textStyle}
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            title="Click to copy to Caption Text"
          >
            {currentFrameText ?? '(No OCR text for this frame)'}
          </div>
        )}
      </div>
    </div>
  )
}
