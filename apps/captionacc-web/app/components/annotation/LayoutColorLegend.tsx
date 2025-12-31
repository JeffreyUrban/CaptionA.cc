export function LayoutColorLegend() {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Color Legend</div>
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <div
            className="h-4 w-4 rounded border-2"
            style={{
              borderColor: '#14b8a6',
              backgroundColor: 'rgba(20,184,166,0.25)',
            }}
          />
          <span className="text-gray-700 dark:text-gray-300">Annotated: Caption</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="h-4 w-4 rounded border-2"
            style={{
              borderColor: '#dc2626',
              backgroundColor: 'rgba(220,38,38,0.25)',
            }}
          />
          <span className="text-gray-700 dark:text-gray-300">Annotated: Noise</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="h-4 w-4 rounded border-2"
            style={{
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59,130,246,0.15)',
            }}
          />
          <span className="text-gray-700 dark:text-gray-300">Predicted: Caption</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="h-4 w-4 rounded border-2"
            style={{
              borderColor: '#f97316',
              backgroundColor: 'rgba(249,115,22,0.15)',
            }}
          />
          <span className="text-gray-700 dark:text-gray-300">Predicted: Noise</span>
        </div>
      </div>
    </div>
  )
}
