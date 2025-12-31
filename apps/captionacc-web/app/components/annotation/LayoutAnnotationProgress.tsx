interface BoxStats {
  totalBoxes: number
  captionBoxes: number
}

interface LayoutAnnotationProgressProps {
  boxStats: BoxStats | null
  annotationsSinceRecalc: number
  recalcThreshold: number
}

export function LayoutAnnotationProgress({
  boxStats,
  annotationsSinceRecalc,
  recalcThreshold,
}: LayoutAnnotationProgressProps) {
  if (boxStats?.captionBoxes === 0) {
    // Alert when no caption boxes - using all boxes as fallback
    return (
      <div className="rounded-md border-2 border-blue-500 bg-blue-50 p-3 dark:border-blue-600 dark:bg-blue-900/20">
        <div className="flex items-center gap-2">
          <span className="text-xl">ℹ️</span>
          <div className="text-sm font-semibold text-blue-800 dark:text-blue-300">
            No Caption Boxes Identified Yet
          </div>
        </div>
        <div className="mt-2 text-xs text-blue-700 dark:text-blue-400">
          Using all {boxStats.totalBoxes} boxes for initial layout analysis
        </div>
        <div className="mt-2 text-xs text-blue-800 dark:text-blue-300 font-medium">
          Label caption boxes to improve accuracy.
          <br />
          Left-click boxes or press &apos;I&apos; while hovering to mark as captions.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Crop Bounds Auto-Update
      </div>
      {annotationsSinceRecalc >= recalcThreshold ? (
        <>
          <div className="mt-1 text-xs text-blue-600 dark:text-blue-400 font-semibold">
            Calculating...
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div className="h-2 rounded-full bg-blue-500 animate-pulse" style={{ width: '100%' }} />
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            Recalculating crop bounds and predictions
          </div>
        </>
      ) : (
        <>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {annotationsSinceRecalc} / {recalcThreshold} annotations
            {boxStats && <span className="ml-2">({boxStats.captionBoxes} caption boxes)</span>}
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all duration-300"
              style={{
                width: `${Math.min(100, (annotationsSinceRecalc / recalcThreshold) * 100)}%`,
              }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            Crop bounds will recalculate automatically after{' '}
            {recalcThreshold - annotationsSinceRecalc} more annotations
          </div>
        </>
      )}
    </div>
  )
}
