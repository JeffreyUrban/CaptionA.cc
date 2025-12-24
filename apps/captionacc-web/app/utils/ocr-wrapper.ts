/**
 * OCR wrapper for text annotation workflow
 *
 * Wraps the Python ocr_utils package to provide OCR functionality
 * for combined images and individual frames.
 */

import { spawn } from 'child_process'
import { resolve } from 'path'

// OCR configuration constants
const DEFAULT_LANGUAGE = 'zh-Hans' // Simplified Chinese
const DEFAULT_TIMEOUT = 10000 // 10 seconds
const MAX_RETRIES = 3

/**
 * OCR result for a single image
 */
export interface OCRResult {
  imagePath: string
  framework: string
  languagePreference: string
  text: string // Extracted clean text
  annotations: OCRAnnotation[] // Raw OCR annotations
  error?: string
}

/**
 * Individual OCR annotation (bounding box + text)
 */
export interface OCRAnnotation {
  text: string
  confidence?: number
  boundingBox?: {
    x: number
    y: number
    width: number
    height: number
  }
}

/**
 * Per-frame OCR result
 */
export interface FrameOCRResult {
  frameIndex: number
  ocrText: string
  ocrConfidence: number
}

/**
 * Run OCR on a single image using the ocr_utils Python package.
 *
 * @param imagePath - Absolute path to the image file
 * @param language - Language preference (default: 'zh-Hans')
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @returns OCR result with extracted text
 */
export async function runOCR(
  imagePath: string,
  language: string = DEFAULT_LANGUAGE,
  timeout: number = DEFAULT_TIMEOUT
): Promise<OCRResult> {
  return new Promise((resolve, reject) => {
    // Construct path to Python script
    const scriptPath = resolve(
      process.cwd(),
      '..',
      '..',
      'packages',
      'ocr_utils',
      'src',
      'ocr_utils',
      'processing.py'
    )

    // Spawn Python process
    const python = spawn('python3', [
      '-c',
      `
import sys
import json
from pathlib import Path

# Add package to path
sys.path.insert(0, '${resolve(process.cwd(), '..', '..', 'packages', 'ocr_utils', 'src')}')

from ocr_utils.processing import process_frame_ocr_with_retry

# Run OCR
result = process_frame_ocr_with_retry(
    Path('${imagePath}'),
    language='${language}',
    timeout=${Math.floor(timeout / 1000)},
    max_retries=${MAX_RETRIES}
)

# Output as JSON
print(json.dumps(result))
      `
    ])

    let stdout = ''
    let stderr = ''

    python.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    python.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`OCR process failed: ${stderr}`))
        return
      }

      try {
        const result = JSON.parse(stdout)

        // Extract clean text from annotations
        const text = extractTextFromAnnotations(result.annotations || [])

        resolve({
          imagePath: result.image_path,
          framework: result.framework,
          languagePreference: result.language_preference,
          text,
          annotations: result.annotations || [],
          error: result.error
        })
      } catch (error) {
        reject(new Error(`Failed to parse OCR output: ${error}`))
      }
    })

    // Set timeout
    setTimeout(() => {
      python.kill()
      reject(new Error(`OCR timeout after ${timeout}ms`))
    }, timeout)
  })
}

/**
 * Extract clean text string from OCR annotations array.
 *
 * @param annotations - Array of OCR annotations from ocr_utils
 * @returns Concatenated text from all annotations
 */
export function extractTextFromAnnotations(annotations: any[]): string {
  if (!annotations || annotations.length === 0) {
    return ''
  }

  // OCRmac returns annotations as array of objects with 'text' field
  return annotations
    .map(ann => ann.text || '')
    .filter(text => text.trim().length > 0)
    .join('\n')
}

/**
 * Run OCR on multiple frames in parallel.
 *
 * @param videoPath - Relative path to video
 * @param frameIndices - Array of frame indices to process
 * @param language - Language preference
 * @returns Map of frame index to OCR result
 */
export async function runOCROnFrames(
  videoPath: string,
  frameIndices: number[],
  language: string = DEFAULT_LANGUAGE
): Promise<Map<number, FrameOCRResult>> {
  const framesDir = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoPath.split('/'),
    'caption_frames'
  )

  // Run OCR on all frames in parallel
  const results = await Promise.all(
    frameIndices.map(async (frameIndex) => {
      const framePath = resolve(framesDir, `frame_${frameIndex.toString().padStart(6, '0')}.jpg`)

      try {
        const ocrResult = await runOCR(framePath, language)

        return {
          frameIndex,
          result: {
            frameIndex,
            ocrText: ocrResult.text,
            ocrConfidence: calculateAverageConfidence(ocrResult.annotations)
          }
        }
      } catch (error) {
        console.error(`OCR failed for frame ${frameIndex}:`, error)
        return {
          frameIndex,
          result: {
            frameIndex,
            ocrText: '',
            ocrConfidence: 0
          }
        }
      }
    })
  )

  // Convert to Map
  const resultMap = new Map<number, FrameOCRResult>()
  results.forEach(({ frameIndex, result }) => {
    resultMap.set(frameIndex, result)
  })

  return resultMap
}

/**
 * Calculate average confidence from OCR annotations.
 *
 * @param annotations - Array of OCR annotations
 * @returns Average confidence (0-1), or 1 if no confidence data
 */
function calculateAverageConfidence(annotations: OCRAnnotation[]): number {
  if (!annotations || annotations.length === 0) {
    return 0
  }

  const confidences = annotations
    .map(ann => ann.confidence)
    .filter(conf => conf !== undefined) as number[]

  if (confidences.length === 0) {
    // OCRmac doesn't provide confidence, return 1 (assumed high quality)
    return 1
  }

  return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length
}

/**
 * Run OCR on a combined image and cache the result.
 *
 * @param imagePath - Path to the combined image
 * @param language - Language preference
 * @returns OCR result with extracted text
 */
export async function runOCROnCombinedImage(
  imagePath: string,
  language: string = DEFAULT_LANGUAGE
): Promise<OCRResult> {
  return runOCR(imagePath, language)
}
