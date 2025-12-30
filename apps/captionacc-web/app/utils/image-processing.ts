/**
 * Image processing utilities for text annotation workflow
 *
 * Generates combined images from frame sequences using median pixel algorithm
 * for optimal OCR text extraction.
 */

import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { resolve } from 'path'

import Database from 'better-sqlite3'
import sharp from 'sharp'

import { getDbPath, getVideoDir } from './video-paths'

// Image quality constant
const COMBINED_IMAGE_QUALITY = 95

// Maximum number of frames to use for combined image (to prevent memory issues)
const MAX_FRAMES_FOR_COMBINED_IMAGE = 30

/**
 * Generate a combined image from a sequence of frames using median pixel values.
 *
 * The median algorithm is better than mean for handling outliers/noise from individual frames.
 *
 * @param videoPath - Relative path to video (e.g., "show_name/video_id")
 * @param startFrame - Start frame index (inclusive)
 * @param endFrame - End frame index (inclusive)
 * @returns Path to the generated combined image
 */
export async function generateCombinedImage(
  videoPath: string,
  startFrame: number,
  endFrame: number
): Promise<string> {
  const dbPath = getDbPath(videoPath)
  if (!dbPath) {
    throw new Error(`Database not found for video: ${videoPath}`)
  }

  // Load all frames in the range from database
  const db = new Database(dbPath, { readonly: true })
  const frameBuffers: sharp.Sharp[] = []

  try {
    const stmt = db.prepare(`
      SELECT image_data
      FROM cropped_frames
      WHERE frame_index >= ? AND frame_index <= ?
      ORDER BY frame_index
    `)

    const rows = stmt.all(startFrame, endFrame) as Array<{ image_data: Buffer }>

    for (const row of rows) {
      frameBuffers.push(sharp(row.image_data))
    }
  } finally {
    db.close()
  }

  if (frameBuffers.length === 0) {
    throw new Error(`No frames found in range ${startFrame}-${endFrame}`)
  }

  // Get metadata from first frame to determine dimensions
  const firstFrame = frameBuffers[0]
  if (!firstFrame) {
    throw new Error('First frame buffer is unexpectedly undefined')
  }
  const metadata = await firstFrame.metadata()
  const width = metadata.width
  const height = metadata.height
  const channels = metadata.channels
  if (!width || !height || !channels) {
    throw new Error('Frame metadata is missing required dimensions')
  }

  // Convert all frames to raw pixel data
  const pixelArrays: Buffer[] = await Promise.all(frameBuffers.map(frame => frame.raw().toBuffer()))

  // Calculate median for each pixel position
  const medianBuffer = Buffer.alloc(width * height * channels)
  const pixelCount = pixelArrays.length

  for (let i = 0; i < medianBuffer.length; i++) {
    // Collect values for this pixel position across all frames
    const values: number[] = []
    for (let j = 0; j < pixelCount; j++) {
      const pixelValue = pixelArrays[j]?.[i]
      if (pixelValue !== undefined) {
        values.push(pixelValue)
      }
    }

    // Sort and take median
    values.sort((a, b) => a - b)
    const medianIndex = Math.floor(values.length / 2)
    const medianValue = values[medianIndex]
    if (medianValue !== undefined) {
      medianBuffer[i] = medianValue
    }
  }

  // Create output directory if it doesn't exist
  const videoDir = getVideoDir(videoPath)
  if (!videoDir) {
    throw new Error(`Video directory not found for: ${videoPath}`)
  }
  const outputDir = resolve(videoDir, 'text_images')

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // Generate output filename based on frame range
  const outputPath = resolve(outputDir, `combined_${startFrame}_${endFrame}.jpg`)

  // Convert median buffer back to image and save
  await sharp(medianBuffer, {
    raw: {
      width,
      height,
      channels,
    },
  })
    .jpeg({ quality: COMBINED_IMAGE_QUALITY })
    .toFile(outputPath)

  return outputPath
}

/**
 * Get the path to a combined image for an annotation.
 * Does not generate if it doesn't exist.
 *
 * @param videoPath - Relative path to video
 * @param annotationId - Annotation ID
 * @returns Path to combined image if it exists, null otherwise
 */
export function getCombinedImagePath(videoPath: string, annotationId: number): string | null {
  const videoDir = getVideoDir(videoPath)
  if (!videoDir) {
    return null
  }

  const imagePath = resolve(videoDir, 'text_images', `annotation_${annotationId}.jpg`)
  return existsSync(imagePath) ? imagePath : null
}

/**
 * Get or generate a combined image for an annotation.
 * Uses annotation ID for caching.
 *
 * @param videoPath - Relative path to video
 * @param annotationId - Annotation ID
 * @param startFrame - Start frame index
 * @param endFrame - End frame index
 * @returns Path to the combined image
 */
export async function getOrGenerateCombinedImage(
  videoPath: string,
  annotationId: number,
  startFrame: number,
  endFrame: number
): Promise<string> {
  const videoDir = getVideoDir(videoPath)
  if (!videoDir) {
    throw new Error(`Video directory not found for: ${videoPath}`)
  }

  const outputDir = resolve(videoDir, 'text_images')
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const outputPath = resolve(outputDir, `annotation_${annotationId}.jpg`)

  // Return cached image if it exists
  if (existsSync(outputPath)) {
    return outputPath
  }

  // Generate new combined image from database
  const dbPath = getDbPath(videoPath)
  if (!dbPath) {
    throw new Error(`Database not found for video: ${videoPath}`)
  }

  // Load all frames in the range from database
  const db = new Database(dbPath, { readonly: true })
  const frameBuffers: sharp.Sharp[] = []

  try {
    const stmt = db.prepare(`
      SELECT image_data
      FROM cropped_frames
      WHERE frame_index >= ? AND frame_index <= ?
      ORDER BY frame_index
    `)

    const rows = stmt.all(startFrame, endFrame) as Array<{ image_data: Buffer }>

    for (const row of rows) {
      frameBuffers.push(sharp(row.image_data))
    }
  } finally {
    db.close()
  }

  if (frameBuffers.length === 0) {
    throw new Error(`No frames found in range ${startFrame}-${endFrame}`)
  }

  // Get metadata from first frame
  const firstCropFrame = frameBuffers[0]
  if (!firstCropFrame) {
    throw new Error('First frame buffer is unexpectedly undefined')
  }
  const metadata = await firstCropFrame.metadata()
  const width = metadata.width
  const height = metadata.height
  const channels = metadata.channels
  if (!width || !height || !channels) {
    throw new Error('Frame metadata is missing required dimensions')
  }

  // Convert all frames to raw pixel data
  const pixelArrays: Buffer[] = await Promise.all(frameBuffers.map(frame => frame.raw().toBuffer()))

  // Calculate median for each pixel position
  const medianBuffer = Buffer.alloc(width * height * channels)
  const pixelCount = pixelArrays.length

  for (let i = 0; i < medianBuffer.length; i++) {
    const values: number[] = []
    for (let j = 0; j < pixelCount; j++) {
      const pixelValue = pixelArrays[j]?.[i]
      if (pixelValue !== undefined) {
        values.push(pixelValue)
      }
    }
    values.sort((a, b) => a - b)
    const medianIndex = Math.floor(values.length / 2)
    const medianValue = values[medianIndex]
    if (medianValue !== undefined) {
      medianBuffer[i] = medianValue
    }
  }

  // Save combined image
  await sharp(medianBuffer, {
    raw: {
      width,
      height,
      channels,
    },
  })
    .jpeg({ quality: COMBINED_IMAGE_QUALITY })
    .toFile(outputPath)

  return outputPath
}

/**
 * Delete cached combined image for an annotation.
 * Called when annotation boundaries change.
 *
 * @param videoPath - Relative path to video
 * @param annotationId - Annotation ID
 */
export function deleteCombinedImage(videoPath: string, annotationId: number): void {
  const videoDir = getVideoDir(videoPath)
  if (!videoDir) {
    return
  }

  const imagePath = resolve(videoDir, 'text_images', `annotation_${annotationId}.jpg`)
  if (existsSync(imagePath)) {
    unlinkSync(imagePath)
  }
}
