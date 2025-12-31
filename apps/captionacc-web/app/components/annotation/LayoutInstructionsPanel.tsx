export function LayoutInstructionsPanel() {
  return (
    <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100">
      <strong>Mouse Controls:</strong>
      <ul className="mt-1 list-inside list-disc space-y-1">
        <li>Left-click box → mark as caption (in)</li>
        <li>Right-click box → mark as noise (out)</li>
        <li>Hover over box to see text</li>
      </ul>
      <strong className="mt-2 block">Keyboard Shortcuts:</strong>
      <ul className="mt-1 list-inside list-disc space-y-1">
        <li>Arrow keys → navigate frames</li>
        <li>Esc → return to analysis view</li>
      </ul>
    </div>
  )
}
