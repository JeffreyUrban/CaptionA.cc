import { type LoaderFunctionArgs } from 'react-router'

import { generateBatchSignedUrls, listChunks } from '~/services/wasabi-storage.server'

const FRAMES_PER_CHUNK = 32

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

    // Build a mapping of frame ranges to chunk indices
    // Each chunk contains 32 frames at the modulo spacing
    const chunkRanges: Array<{ chunkIndex: number; minFrame: number; maxFrame: number }> = []

    for (let i = 0; i < availableChunks.length; i++) {
      const chunkIndex = availableChunks[i]!
      const nextChunkIndex = availableChunks[i + 1]

      chunkRanges.push({
        chunkIndex,
        minFrame: chunkIndex,
        maxFrame: nextChunkIndex ? nextChunkIndex - 1 : Infinity,
      })
    }

    // Group requested frames by which chunk they belong to
    const chunkToFrames = new Map<number, number[]>()

    for (const frameIndex of frameIndices) {
      // Find which chunk this frame belongs to
      const chunk = chunkRanges.find(c => frameIndex >= c.minFrame && frameIndex <= c.maxFrame)

      if (chunk) {
        if (!chunkToFrames.has(chunk.chunkIndex)) {
          chunkToFrames.set(chunk.chunkIndex, [])
        }
        chunkToFrames.get(chunk.chunkIndex)!.push(frameIndex)
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
