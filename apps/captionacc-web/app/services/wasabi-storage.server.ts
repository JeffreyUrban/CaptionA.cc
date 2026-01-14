/**
 * Wasabi Storage Service - Generate signed URLs for VP9 frame chunks
 *
 * This service:
 * - Generates presigned URLs for Wasabi S3-compatible storage
 * - Supports batch URL generation for efficient frame loading
 * - Uses temporary user ID (default_user) until Supabase auth integration
 */

import { execFile } from 'child_process'
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const execFileAsync = promisify(execFile)

// Environment configuration
const WASABI_REGION = process.env['WASABI_REGION'] ?? 'us-east-1'
const WASABI_ENDPOINT = `https://s3.${WASABI_REGION}.wasabisys.com`
const WASABI_BUCKET = process.env['WASABI_BUCKET'] ?? 'caption-acc-prod'
const ENVIRONMENT = process.env['ENVIRONMENT'] ?? 'dev'

// Initialize S3 client with READ-ONLY credentials
const s3Client = new S3Client({
  region: WASABI_REGION,
  endpoint: WASABI_ENDPOINT,
  credentials: {
    accessKeyId:
      process.env['WASABI_ACCESS_KEY_READONLY'] ?? process.env['WASABI_ACCESS_KEY'] ?? '',
    secretAccessKey:
      process.env['WASABI_SECRET_KEY_READONLY'] ?? process.env['WASABI_SECRET_KEY'] ?? '',
  },
  forcePathStyle: true, // Required for Wasabi - use path-style URLs instead of virtual-hosted-style
})

// Constants
const SIGNED_URL_EXPIRY = 3600 // 1 hour
const PLACEHOLDER_USER_ID = 'default_user' // TODO: Replace with session.user.id after Supabase auth

/**
 * Build S3 key for a frame chunk
 */
export function buildChunkKey(
  videoId: string,
  modulo: number,
  chunkIndex: number,
  userId: string = PLACEHOLDER_USER_ID
): string {
  const chunkFileName = `chunk_${chunkIndex.toString().padStart(10, '0')}.webm`
  return `${ENVIRONMENT}/users/${userId}/videos/${videoId}/cropped_frames/modulo_${modulo}/${chunkFileName}`
}

/**
 * Generate a signed URL for a single chunk
 */
export async function generateSignedUrl(
  videoId: string,
  modulo: number,
  chunkIndex: number,
  userId: string = PLACEHOLDER_USER_ID
): Promise<string> {
  const key = buildChunkKey(videoId, modulo, chunkIndex, userId)

  const command = new GetObjectCommand({
    Bucket: WASABI_BUCKET,
    Key: key,
  })

  return await getSignedUrl(s3Client, command, { expiresIn: SIGNED_URL_EXPIRY })
}

/**
 * Generate signed URLs for multiple chunks in batch
 */
export async function generateBatchSignedUrls(
  videoId: string,
  modulo: number,
  chunkIndices: number[],
  userId: string = PLACEHOLDER_USER_ID
): Promise<Array<{ chunkIndex: number; signedUrl: string }>> {
  const promises = chunkIndices.map(async chunkIndex => ({
    chunkIndex,
    signedUrl: await generateSignedUrl(videoId, modulo, chunkIndex, userId),
  }))

  return await Promise.all(promises)
}

/**
 * List all chunks for a video at a specific modulo level
 */
export async function listChunks(
  videoId: string,
  modulo: number,
  userId: string = PLACEHOLDER_USER_ID
): Promise<number[]> {
  const prefix = `${ENVIRONMENT}/users/${userId}/videos/${videoId}/cropped_frames/modulo_${modulo}/`

  const command = new ListObjectsV2Command({
    Bucket: WASABI_BUCKET,
    Prefix: prefix,
  })

  const response = await s3Client.send(command)

  if (!response.Contents) {
    return []
  }

  // Extract chunk indices from filenames
  const chunkIndices: number[] = []
  for (const obj of response.Contents) {
    if (!obj.Key) continue

    const match = obj.Key.match(/chunk_(\d+)\.webm$/)
    if (match?.[1]) {
      chunkIndices.push(parseInt(match[1], 10))
    }
  }

  return chunkIndices.sort((a, b) => a - b)
}

/**
 * Get metadata about available chunks for a video
 */
export async function getVideoChunkMetadata(
  videoId: string,
  userId: string = PLACEHOLDER_USER_ID
): Promise<{
  modulo_16: number[]
  modulo_4: number[]
  modulo_1: number[]
}> {
  const [modulo16, modulo4, modulo1] = await Promise.all([
    listChunks(videoId, 16, userId),
    listChunks(videoId, 4, userId),
    listChunks(videoId, 1, userId),
  ])

  return {
    modulo_16: modulo16,
    modulo_4: modulo4,
    modulo_1: modulo1,
  }
}

/**
 * Build list of frame indices in a chunk for a given modulo level (non-duplicating strategy)
 */
function getFramesInChunk(
  chunkIndex: number,
  modulo: number,
  framesPerChunk: number = 32
): number[] {
  const frames: number[] = []

  if (modulo === 16) {
    // modulo_16: frames divisible by 16
    for (let i = chunkIndex; frames.length < framesPerChunk; i += 16) {
      frames.push(i)
    }
  } else if (modulo === 4) {
    // modulo_4: frames divisible by 4 but not by 16
    for (let i = chunkIndex; frames.length < framesPerChunk; i += 4) {
      if (i % 16 !== 0) {
        frames.push(i)
      }
    }
  } else if (modulo === 1) {
    // modulo_1: frames NOT divisible by 4
    for (let i = chunkIndex; frames.length < framesPerChunk; i++) {
      if (i % 4 !== 0) {
        frames.push(i)
      }
    }
  }

  return frames
}

/**
 * Extract specific frames from Wasabi WebM chunks server-side
 * Returns buffers that can be used with sharp for image processing
 */
export async function extractFramesFromWasabi(
  videoId: string,
  frameIndices: number[],
  userId: string = PLACEHOLDER_USER_ID
): Promise<Buffer[]> {
  if (frameIndices.length === 0) {
    return []
  }

  // Use modulo 1 (finest resolution) for combined images
  const modulo = 1
  const availableChunks = await listChunks(videoId, modulo, userId)

  if (availableChunks.length === 0) {
    throw new Error(`No chunks found for video ${videoId} at modulo ${modulo}`)
  }

  // Determine which chunk each frame belongs to
  const frameToChunk = new Map<number, number>()
  const chunkToFrames = new Map<number, number[]>()

  for (const frameIndex of frameIndices) {
    // Find which chunk contains this frame
    let chunkIndex = -1
    for (const availableChunk of availableChunks) {
      const framesInChunk = getFramesInChunk(availableChunk, modulo)
      if (framesInChunk.includes(frameIndex)) {
        chunkIndex = availableChunk
        break
      }
    }

    if (chunkIndex === -1) {
      throw new Error(`Frame ${frameIndex} not found in any chunk`)
    }

    frameToChunk.set(frameIndex, chunkIndex)
    if (!chunkToFrames.has(chunkIndex)) {
      chunkToFrames.set(chunkIndex, [])
    }
    chunkToFrames.get(chunkIndex)!.push(frameIndex)
  }

  // Create temporary directory for processing
  const tempDir = await mkdtemp(join(tmpdir(), 'wasabi-frames-'))

  try {
    const frameBufferMap = new Map<number, Buffer>()

    // Process each chunk
    for (const [chunkIndex, framesInChunk] of chunkToFrames.entries()) {
      // Generate signed URL and download chunk
      const signedUrl = await generateSignedUrl(videoId, modulo, chunkIndex, userId)
      const chunkPath = join(tempDir, `chunk_${chunkIndex}.webm`)

      // Download chunk
      const response = await fetch(signedUrl)
      if (!response.ok) {
        throw new Error(`Failed to download chunk ${chunkIndex}: ${response.statusText}`)
      }
      const arrayBuffer = await response.arrayBuffer()
      await writeFile(chunkPath, Buffer.from(arrayBuffer))

      // Build the actual sequence of frames in this chunk
      const framesSequence = getFramesInChunk(chunkIndex, modulo)

      // Extract each frame from this chunk using ffmpeg
      for (const frameIndex of framesInChunk) {
        // Find position within chunk (0-indexed)
        const positionInChunk = framesSequence.indexOf(frameIndex)
        if (positionInChunk === -1) {
          throw new Error(`Frame ${frameIndex} not found in chunk ${chunkIndex}`)
        }

        const outputPath = join(tempDir, `frame_${frameIndex}.jpg`)

        // Use ffmpeg to extract the specific frame
        // -ss seeks to frame position, -i input file, -vframes 1 extracts one frame
        try {
          await execFileAsync('ffmpeg', [
            '-y', // Overwrite output files
            '-loglevel',
            'error',
            '-i',
            chunkPath,
            '-vf',
            `select=eq(n\\,${positionInChunk})`,
            '-vframes',
            '1',
            '-q:v',
            '2', // High quality
            outputPath,
          ])
        } catch (error) {
          throw new Error(
            `Failed to extract frame ${frameIndex} from chunk ${chunkIndex}: ${(error as Error).message}`
          )
        }

        // Read the extracted frame
        const buffer = await readFile(outputPath)
        frameBufferMap.set(frameIndex, buffer)
      }
    }

    // Return buffers in the order requested
    return frameIndices.map(idx => {
      const buffer = frameBufferMap.get(idx)
      if (!buffer) {
        throw new Error(`Frame ${idx} was not extracted`)
      }
      return buffer
    })
  } finally {
    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true })
  }
}
