/**
 * OCR wrapper for text annotation workflow
 *
 * Wraps the Python ocr_utils package to provide OCR functionality
 * for combined images and individual frames.
 */

import { spawn } from 'child_process'
import path from 'path'

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
  const reqId = Math.random().toString(36).substring(7)
  console.log(`[${reqId}] runOCR called for ${imagePath}`)
  console.log(`[${reqId}] Creating Promise...`)

  const promiseResult = new Promise<OCRResult>((resolve, reject) => {
    console.log(`[${reqId}] Inside Promise constructor`)
    console.log(`[${reqId}] process.cwd() =`, process.cwd())

    // Construct path to Python script
    const scriptPath = path.resolve(
      process.cwd(),
      '..',
      '..',
      'packages',
      'ocr_utils',
      'src',
      'ocr_utils',
      'processing.py'
    )
    console.log(`[${reqId}] scriptPath =`, scriptPath)

    // Spawn Python process
    const python = spawn('python3', [
      '-c',
      `
import sys
import json
from pathlib import Path

# Add package to path
sys.path.insert(0, '${path.resolve(process.cwd(), '..', '..', 'packages', 'ocr_utils', 'src')}')

from ocr_utils.processing import process_frame_ocr_with_retry

# Run OCR
result = process_frame_ocr_with_retry(
    Path('${imagePath}'),
    language='${language}',
    timeout=${Math.floor(timeout / 1000)},
    max_retries=${MAX_RETRIES}
)

# Output as JSON (ensure_ascii=False for Chinese characters)
print(json.dumps(result, ensure_ascii=False))
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
      console.log(`[${reqId}] Python process closed with code ${code}`)
      console.log(`[${reqId}] stdout length: ${stdout.length}, stderr length: ${stderr.length}`)
      console.log(`[${reqId}] stdout content:`, stdout.substring(0, 500))
      console.log(`[${reqId}] stderr content:`, stderr.substring(0, 500))

      if (code !== 0) {
        reject(new Error(`OCR process failed: ${stderr}`))
        return
      }

      try {
        console.log(`[${reqId}] Attempting to parse stdout as JSON...`)
        const result = JSON.parse(stdout)
        console.log(`[${reqId}] JSON parsed successfully, keys:`, Object.keys(result))

        // Extract clean text from annotations
        const text = extractTextFromAnnotations(result.annotations || [])

        const resolvedObj: any = {
          imagePath: result.image_path,
          framework: result.framework,
          languagePreference: result.language_preference,
          text: text,  // Explicit property name
          annotations: result.annotations || [],
          error: result.error,
          __debug_reqId: reqId,  // Debug marker
          __debug_textLength: text?.length
        }

        console.log(`[${reqId}] runOCR resolving with debug markers, text len=${text?.length}`)

        resolve(resolvedObj)
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

  console.log(`[${reqId}] Returning promise`)
  return promiseResult
}

/**
 * Extract clean text string from OCR annotations array.
 *
 * @param annotations - Array of OCR annotations from ocr_utils
 * @returns Concatenated text from all annotations
 */
export function extractTextFromAnnotations(annotations: any[]): string {
  if (!annotations || annotations.length === 0) {
    console.log('extractTextFromAnnotations: no annotations')
    return ''
  }

  console.log(`extractTextFromAnnotations: ${annotations.length} annotations, first one:`, annotations[0])

  // Handle two formats:
  // 1. Array format from Python: [text, confidence, bbox]
  // 2. Object format: {text: "...", confidence: ..., boundingBox: ...}
  const texts = annotations
    .map(ann => {
      if (Array.isArray(ann)) {
        // Array format: [text, confidence, bbox]
        return ann[0] || ''
      } else {
        // Object format: {text: "..."}
        return ann.text || ''
      }
    })
    .filter(text => text.trim().length > 0)

  console.log(`extractTextFromAnnotations: extracted ${texts.length} text items`)
  const result = texts.join('\n')
  console.log(`extractTextFromAnnotations: result length=${result.length}`)

  return result
}

/**
 * Run OCR on multiple frames in parallel.
 *
 * @param videoPath - Relative path to video
 * @param frameIndices - Array of frame indices to process
 * @param language - Language preference
 * @returns Map of frame index to OCR result
 */
export async function runOCROnFramesV2(
  videoPath: string,
  frameIndices: number[],
  language: string = DEFAULT_LANGUAGE
): Promise<Map<number, FrameOCRResult>> {
  console.log(`=== runOCROnFrames VERSION 2024-12-24 ===`)
  console.log(`runOCROnFrames called for ${videoPath}, ${frameIndices.length} frames`)

  const framesDir = path.resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoPath.split('/'),
    'caption_frames'
  )

  console.log(`Looking for frames in: ${framesDir}`)

  // Run OCR on all frames in parallel
  const results = await Promise.all(
    frameIndices.map(async (frameIndex) => {
      const framePath = path.resolve(framesDir, `frame_${frameIndex.toString().padStart(10, '0')}.jpg`)

      try {
        console.log(`[runOCROnFrames] Calling runOCR for frame ${frameIndex}`)
        const ocrResult = await runOCR(framePath, language)
        console.log(`[runOCROnFrames] Got result for frame ${frameIndex}:`, {
          hasText: 'text' in ocrResult,
          textLength: ocrResult.text?.length,
          debugReqId: (ocrResult as any).__debug_reqId,
          debugTextLength: (ocrResult as any).__debug_textLength,
          keys: Object.keys(ocrResult)
        })

        const text = ocrResult.text || ''
        console.log(`Frame ${frameIndex}: after extracting, text="${text.substring(0,20)}" len=${text.length}`)

        const resultObj = {
          frameIndex,
          ocrText: text,
          ocrConfidence: calculateAverageConfidence(ocrResult.annotations)
        }

        console.log(`Frame ${frameIndex} final result:`, JSON.stringify(resultObj))

        return {
          frameIndex,
          result: resultObj
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
    console.log(`Adding to map: frame ${frameIndex}, ocrText="${result.ocrText}", length=${result.ocrText?.length}`)
    resultMap.set(frameIndex, result)
  })

  console.log(`Returning map with ${resultMap.size} entries`)
  return resultMap
}

/**
 * Calculate average confidence from OCR annotations.
 *
 * @param annotations - Array of OCR annotations
 * @returns Average confidence (0-1), or 1 if no confidence data
 */
function calculateAverageConfidence(annotations: any[]): number {
  if (!annotations || annotations.length === 0) {
    return 0
  }

  // Handle two formats:
  // 1. Array format from Python: [text, confidence, bbox]
  // 2. Object format: {text: "...", confidence: ..., boundingBox: ...}
  const confidences = annotations
    .map(ann => {
      if (Array.isArray(ann)) {
        // Array format: [text, confidence, bbox]
        return ann[1]  // confidence at index 1
      } else {
        // Object format: {confidence: ...}
        return ann.confidence
      }
    })
    .filter(conf => conf !== undefined && conf !== null) as number[]

  if (confidences.length === 0) {
    // No confidence data available, return 1 (assumed high quality)
    return 1
  }

  return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length
}

/**
 * Run OCR on a combined image using the same script as frame OCR.
 *
 * @param imagePath - Path to the combined image
 * @param language - Language preference
 * @returns OCR result with extracted text
 */
export async function runOCROnCombinedImage(
  imagePath: string,
  language: string = DEFAULT_LANGUAGE
): Promise<OCRResult> {
  const reqId = Math.random().toString(36).substring(7)
  console.log(`[${reqId}] runOCROnCombinedImage called for ${imagePath}`)

  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'run-frame-ocr.py')
    const args = ['--single', imagePath, language]

    console.log(`[${reqId}] Spawning python3 ${scriptPath} ${args.join(' ')}`)
    const python = spawn('python3', [scriptPath, ...args])

    let stdout = ''
    let stderr = ''

    python.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    python.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    python.on('close', (code) => {
      console.log(`[${reqId}] Python process closed with code ${code}`)
      console.log(`[${reqId}] stdout:`, stdout.substring(0, 200))
      console.log(`[${reqId}] stderr:`, stderr.substring(0, 200))

      if (code !== 0) {
        console.error(`[${reqId}] OCR process failed:`, stderr)
        reject(new Error(`OCR process exited with code ${code}: ${stderr}`))
        return
      }

      try {
        const result = JSON.parse(stdout)
        console.log(`[${reqId}] Parsed result:`, result)

        if (result.error) {
          reject(new Error(`OCR error: ${result.error}`))
          return
        }

        // Convert to OCRResult format
        const ocrResult: OCRResult = {
          imagePath,
          framework: result.framework || 'unknown',
          languagePreference: result.language || language,
          text: result.text || '',
          annotations: [],
          error: result.error
        }

        console.log(`[${reqId}] Resolving with text length: ${ocrResult.text.length}`)
        resolve(ocrResult)
      } catch (error) {
        console.error(`[${reqId}] Failed to parse JSON:`, error)
        reject(new Error(`Failed to parse OCR output: ${error}`))
      }
    })

    // Set timeout
    setTimeout(() => {
      python.kill()
      reject(new Error(`OCR timeout after ${DEFAULT_TIMEOUT}ms`))
    }, DEFAULT_TIMEOUT)
  })
}
