import { useState, useEffect, useCallback } from 'react'

import type { TextAnchor, TextStyle } from '~/types/text-annotation'
import { getTextStyle } from '~/types/text-annotation'

interface UseTextAnnotationPreferencesParams {
  videoId: string
}

interface UseTextAnnotationPreferencesReturn {
  // Preference values
  textSizePercent: number
  paddingScale: number
  textAnchor: TextAnchor
  actualTextSize: number

  // UI state
  textControlsExpanded: boolean
  setTextControlsExpanded: (expanded: boolean) => void

  // Computed styles
  textStyle: TextStyle

  // Callbacks for ResizeObserver
  imageContainerRef: (node: HTMLDivElement | null) => (() => void) | undefined

  // Change handlers
  handleTextSizeChange: (newPercent: number) => Promise<void>
  handlePaddingScaleChange: (newScale: number) => Promise<void>
  handleTextAnchorChange: (newAnchor: TextAnchor) => Promise<void>
}

/**
 * Custom hook for managing text display preferences.
 * Handles loading/saving preferences and computing text styles.
 */
export function useTextAnnotationPreferences({
  videoId,
}: UseTextAnnotationPreferencesParams): UseTextAnnotationPreferencesReturn {
  // Text size preference (as percentage of image width)
  const [textSizePercent, setTextSizePercent] = useState<number>(3.0)
  const [actualTextSize, setActualTextSize] = useState<number>(16)

  // Padding scale (multiplier for horizontal padding relative to text size)
  const [paddingScale, setPaddingScale] = useState<number>(0.75)

  // Text anchor mode (left/center/right)
  const [textAnchor, setTextAnchor] = useState<TextAnchor>('left')

  // Collapsible section state
  const [textControlsExpanded, setTextControlsExpanded] = useState(false)

  // Load preferences
  useEffect(() => {
    if (!videoId) return

    const loadPreferences = async () => {
      try {
        const response = await fetch(`/api/preferences/${encodeURIComponent(videoId)}`)
        const data = await response.json()

        if (data.text_size) {
          const percent =
            typeof data.text_size === 'number' ? data.text_size : parseFloat(data.text_size) || 3.0
          setTextSizePercent(percent)
        }

        if (data.padding_scale !== undefined) {
          const scale =
            typeof data.padding_scale === 'number'
              ? data.padding_scale
              : parseFloat(data.padding_scale) || 0.75
          setPaddingScale(scale)
        }

        if (data.text_anchor) {
          setTextAnchor(data.text_anchor as TextAnchor)
        }
      } catch (error) {
        console.error('Failed to load preferences:', error)
      }
    }

    void loadPreferences()
  }, [videoId])

  // Callback ref to track image width and update text size
  const imageContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return

      const updateTextSize = () => {
        const width = node.offsetWidth
        setActualTextSize(width * (textSizePercent / 100))
      }

      updateTextSize()

      const resizeObserver = new ResizeObserver(updateTextSize)
      resizeObserver.observe(node)

      return () => resizeObserver.disconnect()
    },
    [textSizePercent]
  )

  // Save preference helper
  const savePreference = useCallback(
    async (preferences: Record<string, unknown>) => {
      if (!videoId) return

      try {
        await fetch(`/api/preferences/${encodeURIComponent(videoId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(preferences),
        })
      } catch (error) {
        console.error('Failed to save preference:', error)
      }
    },
    [videoId]
  )

  // Handle text size change
  const handleTextSizeChange = useCallback(
    async (newPercent: number) => {
      setTextSizePercent(newPercent)
      await savePreference({ text_size: newPercent })
    },
    [savePreference]
  )

  // Handle padding scale change
  const handlePaddingScaleChange = useCallback(
    async (newScale: number) => {
      setPaddingScale(newScale)
      await savePreference({ padding_scale: newScale })
    },
    [savePreference]
  )

  // Handle text anchor change
  const handleTextAnchorChange = useCallback(
    async (newAnchor: TextAnchor) => {
      const oldAnchor = textAnchor
      setTextAnchor(newAnchor)

      // Reset padding scale to appropriate default when switching anchor modes
      let newPaddingScale = paddingScale

      // When switching to center, default to 0 (centered)
      if (newAnchor === 'center' && oldAnchor !== 'center') {
        newPaddingScale = 0
        setPaddingScale(0)
      }
      // When switching from center to left/right, default to 0.75
      else if (oldAnchor === 'center' && newAnchor !== 'center') {
        newPaddingScale = 0.75
        setPaddingScale(0.75)
      }

      await savePreference({
        text_anchor: newAnchor,
        padding_scale: newPaddingScale,
      })
    },
    [textAnchor, paddingScale, savePreference]
  )

  // Compute text style
  const textStyle = getTextStyle(actualTextSize, textAnchor, paddingScale)

  return {
    textSizePercent,
    paddingScale,
    textAnchor,
    actualTextSize,
    textControlsExpanded,
    setTextControlsExpanded,
    textStyle,
    imageContainerRef,
    handleTextSizeChange,
    handlePaddingScaleChange,
    handleTextAnchorChange,
  }
}
