/**
 * Types for the Text Annotation workflow
 */

import type { TextAnchor } from '~/types/enums'

export type { TextAnchor } from '~/types/enums'

export interface TextQueueAnnotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  caption_frame_extents_state: 'predicted' | 'confirmed' | 'gap'
  text: string | null
  text_pending: number
  text_status: string | null
  created_at: string
}

export interface Annotation {
  id: number
  start_frame_index: number
  end_frame_index: number
  caption_frame_extents_state: 'predicted' | 'confirmed' | 'gap'
  caption_frame_extents_pending: number
  caption_frame_extents_updated_at: string
  text: string | null
  text_pending: number
  text_status: string | null
  text_notes: string | null
  caption_ocr: string | null
  text_updated_at: string | null
  created_at: string
}

export interface AnnotationData {
  annotation: Annotation
  combinedImageUrl: string
}

export interface PerFrameOCRItem {
  frameIndex: number
  ocrText: string
}

export interface TextDisplayPreferences {
  textSizePercent: number
  paddingScale: number
  textAnchor: TextAnchor
}

export interface TextStyle {
  fontSize: string
  paddingTop: string
  paddingBottom: string
  paddingLeft: string
  paddingRight: string
  textAlign: 'left' | 'center' | 'right'
}

/**
 * Generates text style based on anchor mode and padding
 */
export function getTextStyle(
  actualTextSize: number,
  textAnchor: TextAnchor,
  paddingScale: number
): TextStyle {
  const baseStyle = {
    fontSize: `${actualTextSize}px`,
    paddingTop: '0.75rem',
    paddingBottom: '0.75rem',
  }

  switch (textAnchor) {
    case 'left':
      return {
        ...baseStyle,
        paddingLeft: `${paddingScale}em`,
        paddingRight: '0',
        textAlign: 'left' as const,
      }
    case 'center':
      // Use asymmetric padding to shift centered text while keeping container fixed
      return {
        ...baseStyle,
        paddingLeft: paddingScale >= 0 ? `${paddingScale}em` : '0',
        paddingRight: paddingScale < 0 ? `${-paddingScale}em` : '0',
        textAlign: 'center' as const,
      }
    case 'right':
      return {
        ...baseStyle,
        paddingLeft: '0',
        paddingRight: `${paddingScale}em`,
        textAlign: 'right' as const,
      }
  }
}
