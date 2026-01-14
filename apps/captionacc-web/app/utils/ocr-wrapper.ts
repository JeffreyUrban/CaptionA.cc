/**
 * OCR wrapper for text annotation workflow
 *
 * Wraps the Python ocr package to provide OCR functionality
 * for combined images and individual frames.
 */

import { spawn } from 'child_process'
import path from 'path'

// OCR configuration constants
const DEFAULT_LANGUAGE = 'zh-Hans' // Simplified Chinese
const DEFAULT_TIMEOUT = 10000 // 10 seconds

// Python executable path - use venv Python if available, otherwise system python3
const PYTHON_EXECUTABLE = path.resolve(process.cwd(), '../../.venv/bin/python3')

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

    console.log(`[${reqId}] Spawning ${PYTHON_EXECUTABLE} ${scriptPath} ${args.join(' ')}`)
    const python = spawn(PYTHON_EXECUTABLE, [scriptPath, ...args])

    let stdout = ''
    let stderr = ''

    python.stdout.on('data', data => {
      stdout += data.toString()
    })

    python.stderr.on('data', data => {
      stderr += data.toString()
    })

    python.on('close', code => {
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
          framework: result.framework ?? 'unknown',
          languagePreference: result.language ?? language,
          text: result.text ?? '',
          annotations: [],
          error: result.error,
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
