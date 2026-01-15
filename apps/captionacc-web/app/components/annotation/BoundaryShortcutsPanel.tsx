export function BoundaryShortcutsPanel() {
  return (
    <>
      {/* Mouse shortcuts */}
      <details className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
        <summary className="cursor-pointer p-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
          Mouse Shortcuts
        </summary>
        <div className="space-y-1 p-3 pt-1 text-xs text-gray-600 dark:text-gray-400">
          <div>
            <strong>Navigation:</strong>
          </div>
          <div>Scroll Wheel: Navigate frames</div>
          <div>Click & Drag: Scroll with momentum</div>
          <div className="mt-2">
            <strong>Marking:</strong>
          </div>
          <div>Left Click: Mark Start</div>
          <div>Right Click: Mark End</div>
        </div>
      </details>

      {/* Keyboard shortcuts */}
      <details className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-950">
        <summary className="cursor-pointer p-2 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">
          Keyboard Shortcuts
        </summary>
        <div className="space-y-1 p-3 pt-1 text-xs text-gray-600 dark:text-gray-400">
          <div>
            <strong>Navigation:</strong>
          </div>
          <div>↑/↓ or ←/→: ±1 frame</div>
          <div>Shift + Arrow: ±10 frames</div>
          <div>Ctrl + Arrow: ±50 frames</div>
          <div className="mt-2">
            <strong>Marking:</strong>
          </div>
          <div>A: Jump to Start</div>
          <div>S: Mark Start</div>
          <div>D: Mark End</div>
          <div>F: Jump to End</div>
          <div className="mt-2">
            <strong>Actions:</strong>
          </div>
          <div>Enter: Save & Next</div>
          <div>Esc: Clear Marks</div>
        </div>
      </details>
    </>
  )
}
