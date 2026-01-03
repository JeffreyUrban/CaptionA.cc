type AnnotationState = 'predicted' | 'confirmed' | 'gap' | 'issue'

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

interface BoundaryAnnotationInfoProps {
  annotation: Annotation | null
  getEffectiveState: (annotation: Annotation) => 'pending' | AnnotationState
}

export function BoundaryAnnotationInfo({
  annotation,
  getEffectiveState,
}: BoundaryAnnotationInfoProps) {
  if (!annotation) return null

  const effectiveState = getEffectiveState(annotation)
  const frameCount = annotation.end_frame_index - annotation.start_frame_index + 1

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-950">
      <div className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
        Active Annotation
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">State:</span>
          <span className="font-semibold text-gray-900 dark:text-white capitalize">
            {effectiveState}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Range:</span>
          <span className="font-mono text-gray-900 dark:text-white">
            {annotation.start_frame_index}-{annotation.end_frame_index}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Frames:</span>
          <span className="font-mono text-gray-900 dark:text-white">{frameCount}</span>
        </div>
      </div>
    </div>
  )
}
