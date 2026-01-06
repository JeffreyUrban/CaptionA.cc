import { type LoaderFunctionArgs } from 'react-router'

import { generateBatchSignedUrls, listChunks } from '~/services/wasabi-storage.server'

const FRAMES_PER_CHUNK = 32

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
 * API endpoint: GET /api/frames/:videoId/batch-signed-urls?modulo=X&indices=1,2,3,...
 *
 * Returns signed Wasabi URLs for VP9 WebM chunks containing the requested frames.
 *
 * Response format:
 * {
 *   chunks: [
 *     { chunkIndex: 0, signedUrl: "https://...", frameIndices: [0, 1, 2, ..., 31] },
 *     { chunkIndex: 32, signedUrl: "https://...", frameIndices: [32, 33, ..., 63] },
 *     ...
 *   ]
 * }
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response('Missing videoId', { status: 400 })
  }

  const url = new URL(request.url)
  const moduloParam = url.searchParams.get('modulo')
  const indicesParam = url.searchParams.get('indices')

  if (!moduloParam) {
    return new Response('Missing modulo parameter', { status: 400 })
  }

  if (!indicesParam) {
    return new Response('Missing indices parameter', { status: 400 })
  }

  // Parse modulo level
  const modulo = parseInt(moduloParam, 10)
  if (isNaN(modulo) || ![16, 4, 1].includes(modulo)) {
    return new Response('Invalid modulo (must be 16, 4, or 1)', { status: 400 })
  }

  // Parse frame indices
  const frameIndices = indicesParam.split(',').map(idx => parseInt(idx.trim(), 10))

  if (frameIndices.some(idx => isNaN(idx))) {
    return new Response('Invalid frame indices', { status: 400 })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    // List all available chunks for this modulo level from Wasabi
    const availableChunks = await listChunks(videoId, modulo)

    if (availableChunks.length === 0) {
      return new Response(JSON.stringify({ chunks: [] }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // Group requested frames by which chunk they belong to (using non-duplicating strategy)
    const chunkToFrames = new Map<number, number[]>()

    for (const frameIndex of frameIndices) {
      // Find which chunk this frame belongs to
      let foundChunk: number | null = null

      for (const chunkIndex of availableChunks) {
        const framesInChunk = getFramesInChunk(chunkIndex, modulo)
        if (framesInChunk.includes(frameIndex)) {
          foundChunk = chunkIndex
          break
        }
      }

      if (foundChunk !== null) {
        if (!chunkToFrames.has(foundChunk)) {
          chunkToFrames.set(foundChunk, [])
        }
        chunkToFrames.get(foundChunk)!.push(frameIndex)
      }
    }

    // Generate signed URLs for chunks that have requested frames
    const uniqueChunkIndices = Array.from(chunkToFrames.keys())
    const signedUrlsData = await generateBatchSignedUrls(videoId, modulo, uniqueChunkIndices)

    // Build response with chunk metadata
    const chunks = signedUrlsData.map(({ chunkIndex, signedUrl }) => ({
      chunkIndex,
      signedUrl,
      frameIndices: chunkToFrames.get(chunkIndex)!.sort((a, b) => a - b),
    }))

    return new Response(JSON.stringify({ chunks }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour (same as signed URL expiry)
      },
    })
  } catch (error) {
    console.error('Error generating signed URLs:', error)
    return new Response('Failed to generate signed URLs', { status: 500 })
  }
}
