interface ErrorBannerProps {
  error: string | null
}

export function ErrorBanner({ error }: ErrorBannerProps) {
  if (!error) return null

  return (
    <div className="mb-4 rounded-lg border-2 border-red-500 bg-red-50 p-4 dark:border-red-600 dark:bg-red-950">
      <div className="flex items-center gap-3">
        <div className="text-2xl">⚠️</div>
        <div className="flex-1">
          <div className="text-lg font-bold text-red-900 dark:text-red-100">Error</div>
          <div className="text-sm text-red-700 dark:text-red-300">{error}</div>
        </div>
      </div>
    </div>
  )
}
