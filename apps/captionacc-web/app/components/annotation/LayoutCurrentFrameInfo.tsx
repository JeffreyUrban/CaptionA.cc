interface BoxData {
  boxIndex: number
  userLabel: 'in' | 'out' | null
}

interface FrameBoxesData {
  frameIndex: number
  boxes: BoxData[]
}

interface LayoutCurrentFrameInfoProps {
  currentFrameBoxes: FrameBoxesData | null
}

export function LayoutCurrentFrameInfo({ currentFrameBoxes }: LayoutCurrentFrameInfoProps) {
  if (!currentFrameBoxes) return null

  const captionCount = currentFrameBoxes.boxes.filter(b => b.userLabel === 'in').length
  const noiseCount = currentFrameBoxes.boxes.filter(b => b.userLabel === 'out').length

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Frame {currentFrameBoxes.frameIndex}
      </div>
      <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        {currentFrameBoxes.boxes.length} total boxes
        <br />
        {captionCount} annotated as caption
        <br />
        {noiseCount} annotated as noise
      </div>
    </div>
  )
}
