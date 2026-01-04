import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { rm } from 'fs/promises'

import Database from 'better-sqlite3'
import { type ActionFunctionArgs } from 'react-router'

import { getDbPath, getVideoDir, getVideoMetadata } from '~/utils/video-paths'

/**
 * Cancel Prefect flows for a video UUID
 * Queries running flows and cancels any that match the video_id parameter
 */
async function cancelPrefectFlows(videoUuid: string): Promise<void> {
  return new Promise(resolve => {
    console.log(`[VideoDelete] Looking for Prefect flows to cancel for: ${videoUuid}`)

    // Use Python to query and cancel flows via Prefect API
    const script = `
import asyncio
from prefect import get_client

async def cancel_flows():
    async with get_client() as client:
        # Get running/pending flows with video_id parameter matching
        flows = await client.read_flow_runs(
            flow_run_filter={
                "state": {"type": {"any_": ["PENDING", "RUNNING", "SCHEDULED"]}},
            },
            limit=100
        )

        cancelled = 0
        for flow in flows:
            # Check if this flow has video_id parameter matching our UUID
            if flow.parameters and flow.parameters.get("video_id") == "${videoUuid}":
                try:
                    await client.set_flow_run_state(flow.id, state_type="CANCELLED")
                    print(f"Cancelled flow run {flow.id}")
                    cancelled += 1
                except Exception as e:
                    print(f"Failed to cancel {flow.id}: {e}")

        print(f"Cancelled {cancelled} flow(s)")

asyncio.run(cancel_flows())
`

    const proc = spawn('uv', ['run', 'python', '-c', script], {
      cwd: process.cwd(),
      stdio: 'pipe',
    })

    let output = ''
    proc.stdout?.on('data', data => {
      output += data.toString()
    })

    proc.stderr?.on('data', data => {
      output += data.toString()
    })

    proc.on('close', code => {
      if (code === 0) {
        console.log(`[VideoDelete] Prefect flow cancellation complete: ${output.trim()}`)
      } else {
        console.log(`[VideoDelete] Prefect cancellation failed (code ${code}): ${output}`)
      }
      resolve()
    })

    // Don't wait forever
    setTimeout(() => {
      proc.kill()
      resolve()
    }, 10000)
  })
}

/**
 * Background cleanup function - cancels flows, kills process, and deletes files
 */
async function cleanupVideo(videoId: string, videoDir: string, pid: string | null) {
  console.log(`[VideoDelete] Starting cleanup for: ${videoId}`)

  // Get the UUID for Prefect flow cancellation
  const metadata = getVideoMetadata(videoId)
  if (metadata?.videoId) {
    await cancelPrefectFlows(metadata.videoId)
  }

  // Kill processing job if running
  if (pid) {
    try {
      const pidNum = parseInt(pid)
      process.kill(pidNum, 'SIGTERM')
      console.log(`[VideoDelete] Killed processing job PID: ${pidNum}`)

      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Force kill if still running
      try {
        process.kill(pidNum, 'SIGKILL')
      } catch {
        // Process already dead, that's fine
      }
    } catch {
      console.log(`[VideoDelete] Process ${pid} already terminated or not found`)
    }
  }

  // Delete the entire video directory
  try {
    if (existsSync(videoDir)) {
      await rm(videoDir, { recursive: true, force: true })
      console.log(`[VideoDelete] Successfully deleted files for: ${videoId}`)
    }
  } catch (error) {
    console.error(`[VideoDelete] Failed to delete files for ${videoId}:`, error)
    // Don't throw - we've already marked as deleted
  }
}

/**
 * DELETE - Soft delete a video and trigger background cleanup
 *
 * This implements a soft-delete pattern:
 * 1. Mark video as deleted in database (immediate)
 * 2. Kill processing job if running (background)
 * 3. Delete files (background)
 * 4. Return success immediately (no user wait)
 */
export async function action({ params }: ActionFunctionArgs) {
  const { videoId: encodedVideoId } = params

  if (!encodedVideoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const videoId = decodeURIComponent(encodedVideoId)

  try {
    // Resolve video paths (videoId can be display_path or UUID)
    const dbPath = getDbPath(videoId)
    const videoDir = getVideoDir(videoId)

    if (!dbPath || !videoDir) {
      return new Response(
        JSON.stringify({
          error: 'Video not found',
          videoId,
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Soft delete: mark as deleted and get PID
    let pid: string | null = null
    const db = new Database(dbPath)
    try {
      // Get current job ID (PID) before marking deleted
      const status = db
        .prepare(
          `
        SELECT current_job_id FROM processing_status WHERE id = 1
      `
        )
        .get() as { current_job_id: string | null } | undefined

      pid = status?.current_job_id ?? null

      // Mark as deleted
      db.prepare(
        `
        UPDATE processing_status
        SET deleted = 1,
            deleted_at = datetime('now')
        WHERE id = 1
      `
      ).run()

      console.log(`[VideoDelete] Marked as deleted: ${videoId} (PID: ${pid ?? 'none'})`)
    } finally {
      db.close()
    }

    // Trigger background cleanup (don't await)
    cleanupVideo(videoId, videoDir, pid).catch(error => {
      console.error(`[VideoDelete] Background cleanup failed for ${videoId}:`, error)
    })

    // Return success immediately
    return new Response(
      JSON.stringify({
        success: true,
        videoId,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error deleting video:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        videoId,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
