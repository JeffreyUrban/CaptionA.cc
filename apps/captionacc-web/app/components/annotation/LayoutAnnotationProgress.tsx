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
    // Alert when all boxes marked as noise
    return (
      <div className="rounded-md border-2 border-amber-500 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-900/20">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            All Boxes Marked as Noise
          </div>
        </div>
        <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Currently {boxStats.totalBoxes} boxes are all marked as noise. The crop region calculation
          needs at least some caption boxes to work effectively.
        </div>
        <div className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-300">
          Action needed: Identify and mark caption boxes (left-click) to improve layout analysis.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Crop Region Auto-Update
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
            Recalculating crop region and predictions
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
            Crop region will recalculate automatically after{' '}
            {recalcThreshold - annotationsSinceRecalc} more annotations
          </div>
        </>
      )}
    </div>
  )
}
