interface CompletionBannerProps {
  workflowProgress: number
}

export function CompletionBanner({ workflowProgress }: CompletionBannerProps) {
  if (workflowProgress < 100) return null

  return (
    <div className="mb-4 rounded-lg border-2 border-green-500 bg-green-50 p-4 dark:border-green-600 dark:bg-green-950">
      <div className="flex items-center gap-3">
        <div className="text-3xl">🎉</div>
        <div className="flex-1">
          <div className="text-lg font-bold text-green-900 dark:text-green-100">
            Workflow Complete!
          </div>
          <div className="text-sm text-green-700 dark:text-green-300">
            All annotations have been reviewed. You can continue editing as needed.
          </div>
        </div>
      </div>
    </div>
  )
}
