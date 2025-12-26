/**
 * Image processing utilities for text annotation workflow
 *
 * Generates combined images from frame sequences using median pixel algorithm
 * for optimal OCR text extraction.
 */

import sharp from 'sharp'
import { resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'

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
  const framesDir = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoPath.split('/'),
    'crop_frames'
  )

  if (!existsSync(framesDir)) {
    throw new Error(`Frames directory not found: ${framesDir}`)
  }

  // Load all frames in the range
  const frameBuffers: sharp.Sharp[] = []

  for (let i = startFrame; i <= endFrame; i++) {
    const framePath = resolve(framesDir, `frame_${i.toString().padStart(10, '0')}.jpg`)

    if (existsSync(framePath)) {
      frameBuffers.push(sharp(framePath))
    }
  }

  if (frameBuffers.length === 0) {
    throw new Error(`No frames found in range ${startFrame}-${endFrame}`)
  }

  // Get metadata from first frame to determine dimensions
  const metadata = await frameBuffers[0].metadata()
  const width = metadata.width!
  const height = metadata.height!
  const channels = metadata.channels!

  // Convert all frames to raw pixel data
  const pixelArrays: Buffer[] = await Promise.all(
    frameBuffers.map(frame =>
      frame.raw().toBuffer()
    )
  )

  // Calculate median for each pixel position
  const medianBuffer = Buffer.alloc(width * height * channels)
  const pixelCount = pixelArrays.length

  for (let i = 0; i < medianBuffer.length; i++) {
    // Collect values for this pixel position across all frames
    const values: number[] = []
    for (let j = 0; j < pixelCount; j++) {
      values.push(pixelArrays[j][i])
    }

    // Sort and take median
    values.sort((a, b) => a - b)
    const medianIndex = Math.floor(values.length / 2)
    medianBuffer[i] = values[medianIndex]
  }

  // Create output directory if it doesn't exist
  const outputDir = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoPath.split('/'),
    'text_images'
  )

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
      channels
    }
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
export function getCombinedImagePath(
  videoPath: string,
  annotationId: number
): string | null {
  const imagePath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoPath.split('/'),
    'text_images',
    `annotation_${annotationId}.jpg`
  )

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
  const outputDir = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoPath.split('/'),
    'text_images'
  )

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const outputPath = resolve(outputDir, `annotation_${annotationId}.jpg`)

  // Return cached image if it exists
  if (existsSync(outputPath)) {
    return outputPath
  }

  // Generate new combined image
  const framesDir = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoPath.split('/'),
    'crop_frames'
  )

  if (!existsSync(framesDir)) {
    throw new Error(`Frames directory not found: ${framesDir}`)
  }

  // Load all frames in the range
  const frameBuffers: sharp.Sharp[] = []

  for (let i = startFrame; i <= endFrame; i++) {
    const framePath = resolve(framesDir, `frame_${i.toString().padStart(10, '0')}.jpg`)

    if (existsSync(framePath)) {
      frameBuffers.push(sharp(framePath))
    }
  }

  if (frameBuffers.length === 0) {
    throw new Error(`No frames found in range ${startFrame}-${endFrame}`)
  }

  // Get metadata from first frame
  const metadata = await frameBuffers[0].metadata()
  const width = metadata.width!
  const height = metadata.height!
  const channels = metadata.channels!

  // Convert all frames to raw pixel data
  const pixelArrays: Buffer[] = await Promise.all(
    frameBuffers.map(frame =>
      frame.raw().toBuffer()
    )
  )

  // Calculate median for each pixel position
  const medianBuffer = Buffer.alloc(width * height * channels)
  const pixelCount = pixelArrays.length

  for (let i = 0; i < medianBuffer.length; i++) {
    const values: number[] = []
    for (let j = 0; j < pixelCount; j++) {
      values.push(pixelArrays[j][i])
    }
    values.sort((a, b) => a - b)
    const medianIndex = Math.floor(values.length / 2)
    medianBuffer[i] = values[medianIndex]
  }

  // Save combined image
  await sharp(medianBuffer, {
    raw: {
      width,
      height,
      channels
    }
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
export function deleteCombinedImage(
  videoPath: string,
  annotationId: number
): void {
  const imagePath = resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoPath.split('/'),
    'text_images',
    `annotation_${annotationId}.jpg`
  )

  if (existsSync(imagePath)) {
    const { unlinkSync } = require('fs')
    unlinkSync(imagePath)
  }
}
