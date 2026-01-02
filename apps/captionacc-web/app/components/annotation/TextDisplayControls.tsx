interface TextDisplayControlsProps {
  textAnchor: 'left' | 'center' | 'right'
  textSizePercent: number
  paddingScale: number
  actualTextSize: number
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onTextAnchorChange: (anchor: 'left' | 'center' | 'right') => void
  onTextSizeChange: (size: number) => void
  onPaddingScaleChange: (padding: number) => void
}

export function TextDisplayControls({
  textAnchor,
  textSizePercent,
  paddingScale,
  actualTextSize,
  expanded,
  onExpandedChange,
  onTextAnchorChange,
  onTextSizeChange,
  onPaddingScaleChange,
}: TextDisplayControlsProps) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 rounded-lg transition-colors"
      >
        <span className="font-semibold text-gray-700 dark:text-gray-300">
          Text Display Controls
        </span>
        <svg
          className={`w-5 h-5 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Text Anchor */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Text Anchor
            </label>
            <div className="flex flex-col md:flex-row gap-2">
              <button
                type="button"
                onClick={() => onTextAnchorChange('left')}
                className={`flex-1 px-2 py-2 rounded-lg font-medium text-sm text-center transition-colors ${
                  textAnchor === 'left'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                Left
              </button>
              <button
                type="button"
                onClick={() => onTextAnchorChange('center')}
                className={`flex-1 px-2 py-2 rounded-lg font-medium text-sm text-center transition-colors ${
                  textAnchor === 'center'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                Center
              </button>
              <button
                type="button"
                onClick={() => onTextAnchorChange('right')}
                className={`flex-1 px-2 py-2 rounded-lg font-medium text-sm text-center transition-colors ${
                  textAnchor === 'right'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                Right
              </button>
            </div>
          </div>

          {/* Text Size */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 truncate">
              Size: {textSizePercent.toFixed(1)}% ({Math.round(actualTextSize)}px)
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[2ch]">1</span>
              <input
                type="range"
                min="1.0"
                max="10.0"
                step="0.1"
                value={textSizePercent}
                onChange={e => onTextSizeChange(parseFloat(e.target.value))}
                className="flex-1 min-w-0 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[3ch]">10</span>
            </div>
          </div>

          {/* Padding / Center Offset */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 truncate">
              {textAnchor === 'center'
                ? `Offset: ${paddingScale >= 0 ? '+' : ''}${paddingScale.toFixed(2)}em`
                : `${textAnchor === 'left' ? 'L' : 'R'} Pad: ${paddingScale.toFixed(2)}em`}
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[3ch]">
                {textAnchor === 'center' ? '-2' : textAnchor === 'right' ? '2' : '0'}
              </span>
              <input
                type="range"
                min={textAnchor === 'center' ? '-2.0' : '0.0'}
                max="2.0"
                step="0.05"
                value={textAnchor === 'right' ? 2.0 - paddingScale : paddingScale}
                onChange={e => {
                  const sliderValue = parseFloat(e.target.value)
                  const actualValue = textAnchor === 'right' ? 2.0 - sliderValue : sliderValue
                  onPaddingScaleChange(actualValue)
                }}
                className="flex-1 min-w-0 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[3ch]">
                {textAnchor === 'center' ? '+2' : textAnchor === 'right' ? '0' : '2'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
