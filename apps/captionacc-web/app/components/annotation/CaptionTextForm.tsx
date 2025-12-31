interface CaptionTextFormProps {
  text: string
  onChange: (text: string) => void
  textStyle: React.CSSProperties
}

export function CaptionTextForm({ text, onChange, textStyle }: CaptionTextFormProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="p-4">
        <textarea
          value={text}
          onChange={e => onChange(e.target.value)}
          className="w-full h-26 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          style={textStyle}
          placeholder="Enter caption text..."
        />
      </div>
    </div>
  )
}
