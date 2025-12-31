interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  boundary_state: 'predicted' | 'confirmed' | 'gap'
}

interface AnnotationInfoPanelProps {
  annotation: Annotation | null
}

export function AnnotationInfoPanel({ annotation }: AnnotationInfoPanelProps) {
  if (!annotation) return null

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
      <div className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
        Active Annotation
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">ID:</span>
          <span className="font-mono font-semibold text-gray-900 dark:text-white">
            {annotation.id}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">State:</span>
          <span className="capitalize font-semibold text-gray-900 dark:text-white">
            {annotation.boundary_state}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Frames:</span>
          <span className="font-mono text-gray-900 dark:text-white">
            {annotation.start_frame_index}-{annotation.end_frame_index}
          </span>
        </div>
      </div>
    </div>
  )
}
