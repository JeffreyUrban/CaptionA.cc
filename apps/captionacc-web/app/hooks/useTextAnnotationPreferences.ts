import { useState, useEffect, useCallback, useRef } from 'react'

import { getTextStyle, type TextAnchor, type TextStyle } from '~/types/text-annotation'
import { useCaptionsDatabase } from './useCaptionsDatabase'

interface UseTextAnnotationPreferencesParams {
  videoId: string
  /** Tenant ID for database initialization */
  tenantId?: string
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

  // Database status
  isReady: boolean
}

/**
 * Custom hook for managing text display preferences.
 * Handles loading/saving preferences from captions.db and computing text styles.
 * Uses CR-SQLite local database with WebSocket sync.
 */
export function useTextAnnotationPreferences({
  videoId,
  tenantId,
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

  // Track if initial load has been done
  const initialLoadDoneRef = useRef(false)

  // Use the captions database hook (preferences are stored in captions.db)
  const captionsDb = useCaptionsDatabase({
    videoId,
    tenantId,
    // Preferences don't require edit lock
    autoAcquireLock: false,
  })

  // Load preferences from database when ready
  useEffect(() => {
    if (!captionsDb.isReady || !videoId || initialLoadDoneRef.current) return

    const loadPreferences = async () => {
      try {
        const prefs = await captionsDb.getPreferences()

        if (prefs.textSize) {
          const percent =
            typeof prefs.textSize === 'number'
              ? prefs.textSize
              : parseFloat(String(prefs.textSize)) || 3.0
          setTextSizePercent(percent)
        }

        if (prefs.paddingScale !== undefined) {
          const scale =
            typeof prefs.paddingScale === 'number'
              ? prefs.paddingScale
              : parseFloat(String(prefs.paddingScale)) || 0.75
          setPaddingScale(scale)
        }

        if (prefs.textAnchor) {
          setTextAnchor(prefs.textAnchor)
        }

        initialLoadDoneRef.current = true
      } catch (error) {
        console.error('Failed to load preferences:', error)
      }
    }

    void loadPreferences()
  }, [captionsDb.isReady, videoId, captionsDb])

  // Subscribe to preference changes (from other tabs/users)
  useEffect(() => {
    if (!captionsDb.isReady) return

    const unsubscribe = captionsDb.onChanges(event => {
      if (event.type === 'preferences_changed') {
        // Reload preferences when they change
        void captionsDb.getPreferences().then(prefs => {
          setTextSizePercent(prefs.textSize)
          setPaddingScale(prefs.paddingScale)
          setTextAnchor(prefs.textAnchor)
        })
      }
    })

    return unsubscribe
  }, [captionsDb.isReady, captionsDb])

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

  // Handle text size change
  const handleTextSizeChange = useCallback(
    async (newPercent: number) => {
      setTextSizePercent(newPercent)

      if (!captionsDb.isReady) return

      try {
        await captionsDb.updatePreferences({ textSize: newPercent })
      } catch (error) {
        console.error('Failed to save text size preference:', error)
      }
    },
    [captionsDb]
  )

  // Handle padding scale change
  const handlePaddingScaleChange = useCallback(
    async (newScale: number) => {
      setPaddingScale(newScale)

      if (!captionsDb.isReady) return

      try {
        await captionsDb.updatePreferences({ paddingScale: newScale })
      } catch (error) {
        console.error('Failed to save padding scale preference:', error)
      }
    },
    [captionsDb]
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

      if (!captionsDb.isReady) return

      try {
        await captionsDb.updatePreferences({
          textAnchor: newAnchor,
          paddingScale: newPaddingScale,
        })
      } catch (error) {
        console.error('Failed to save text anchor preference:', error)
      }
    },
    [textAnchor, paddingScale, captionsDb]
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
    isReady: captionsDb.isReady,
  }
}
