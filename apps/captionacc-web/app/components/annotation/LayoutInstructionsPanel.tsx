import { useState } from 'react'

import type { ViewMode } from '~/types/layout'

interface LayoutInstructionsPanelProps {
  viewMode: ViewMode
}

export function LayoutInstructionsPanel({ viewMode }: LayoutInstructionsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (viewMode === 'analysis') {
    return (
      <>
        {/* Analysis View Controls - Collapsible */}
        <div className="rounded-md bg-gray-50 dark:bg-gray-900">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full items-center justify-between p-3 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <strong className="text-gray-900 dark:text-gray-100">Analysis View Controls</strong>
            <span className="text-gray-500 dark:text-gray-400">{isExpanded ? '▼' : '▶'}</span>
          </button>
          {isExpanded && (
            <div className="border-t border-gray-200 p-3 dark:border-gray-700">
              <ul className="list-inside list-disc space-y-1 text-xs text-gray-700 dark:text-gray-300">
                <li>Click to start selection, then click again to complete:</li>
                <ul className="ml-4 mt-1 list-inside list-disc space-y-1">
                  <li>Left-click both times → clear annotations in area</li>
                  <li>Right-click both times → mark area as noise (out)</li>
                </ul>
                <li>Click frame thumbnails to review individual frames</li>
              </ul>
            </div>
          )}
        </div>

        {/* Strategy Tip for Analysis View */}
        <div className="mt-2 rounded-md bg-blue-50 p-3 dark:bg-blue-950">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-lg">💡</span>
            <strong className="text-sm text-blue-900 dark:text-blue-100">Strategy Tip</strong>
          </div>
          <p className="text-xs text-blue-800 dark:text-blue-200">
            Start by marking large areas away from captions as noise (right-click drag). Avoid
            including any captions.
          </p>
        </div>
      </>
    )
  }

  // Frame view
  return (
    <div className="rounded-md bg-gray-50 dark:bg-gray-900">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-3 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <strong className="text-gray-900 dark:text-gray-100">Frame View Controls</strong>
        <span className="text-gray-500 dark:text-gray-400">{isExpanded ? '▼' : '▶'}</span>
      </button>
      {isExpanded && (
        <div className="border-t border-gray-200 p-3 dark:border-gray-700">
          <ul className="list-inside list-disc space-y-1 text-xs text-gray-700 dark:text-gray-300">
            <li>Left-click box → mark as caption (in)</li>
            <li>Right-click box → mark as noise (out)</li>
            <li>Click to start selection, then click again to complete:</li>
            <ul className="ml-4 mt-1 list-inside list-disc space-y-1">
              <li>Left-click both times → mark area as captions (in)</li>
              <li>Right-click both times → mark area as noise (out)</li>
            </ul>
            <li>Hover to see text content</li>
          </ul>
          <strong className="mt-2 block text-gray-900 dark:text-gray-100">
            Keyboard Shortcuts:
          </strong>
          <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-gray-700 dark:text-gray-300">
            <li>Arrow keys → navigate frames</li>
            <li>Esc → return to analysis view</li>
          </ul>
        </div>
      )}
    </div>
  )
}
