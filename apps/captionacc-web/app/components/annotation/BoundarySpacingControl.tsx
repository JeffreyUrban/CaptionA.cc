type FrameSpacing = 'linear' | 'exponential' | 'hybrid'

interface BoundarySpacingControlProps {
  frameSpacing: FrameSpacing
  onChange: (spacing: FrameSpacing) => void
}

export function BoundarySpacingControl({ frameSpacing, onChange }: BoundarySpacingControlProps) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
        Frame Spacing
      </label>
      <select
        value={frameSpacing}
        onChange={e => onChange(e.target.value as FrameSpacing)}
        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      >
        <option value="linear">Linear (1,1,1...)</option>
        <option value="exponential">Exponential (1,2,4,8...)</option>
        <option value="hybrid">Hybrid (1,2,3,5,10...)</option>
      </select>
    </div>
  )
}
