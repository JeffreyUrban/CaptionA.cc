import { spawn } from 'child_process'

import { type ActionFunctionArgs } from 'react-router'

import { createServerSupabaseClient } from '~/services/supabase-client'
import { extractVideoId, errorResponse, jsonResponse } from '~/utils/api-responses'
import { requireAuth, requireVideoOwnership } from '~/utils/api-auth'

/**
 * Cancel Prefect flows for a video UUID
 * Queries running flows and cancels any that match the video_id parameter
 */
async function cancelPrefectFlows(videoUuid: string): Promise<void> {
  return new Promise(resolve => {
    // Use Python to query and cancel flows via Prefect API
    const script = `
import asyncio
from prefect import get_client
from prefect.client.schemas.filters import FlowRunFilter, FlowRunFilterState, FlowRunFilterStateType

async def cancel_flows():
    async with get_client() as client:
        # Get running/pending flows
        flow_filter = FlowRunFilter(
            state=FlowRunFilterState(
                type=FlowRunFilterStateType(any_=["PENDING", "RUNNING", "SCHEDULED"])
            )
        )
        flows = await client.read_flow_runs(flow_run_filter=flow_filter, limit=100)

        cancelled = 0
        for flow in flows:
            # Check if this flow has video_id parameter matching our UUID
            if flow.parameters and flow.parameters.get("video_id") == "${videoUuid}":
                try:
                    await client.set_flow_run_state(flow.id, state_type="CANCELLED")
                    cancelled += 1
                except Exception:
                    pass  # Silently ignore cancellation failures

        if cancelled > 0:
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

    // Capture stderr but don't log it - Prefect errors are non-critical here
    proc.stderr?.on('data', () => {
      // Silently ignore stderr - Prefect connection issues are non-critical
    })

    proc.on('close', code => {
      if (code === 0 && output.trim()) {
        console.log(`[VideoDelete] ${output.trim()}`)
      }
      // Don't log failures - Prefect cancellation is best-effort
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
 * Background cleanup function - cancels Prefect flows for video
 */
async function cleanupVideo(videoId: string) {
  // Cancel any running Prefect flows for this video
  await cancelPrefectFlows(videoId)

  // Note: Files in Wasabi are not deleted immediately to support restore
  // Physical deletion would be handled by a separate cleanup job
}

/**
 * DELETE - Soft delete a video and trigger background cleanup
 *
 * This implements a soft-delete pattern:
 * 1. Authenticate user and verify ownership
 * 2. Mark video as deleted in Supabase (immediate)
 * 3. Cancel Prefect flows (background)
 * 4. Return success immediately (no user wait)
 *
 * Note: Files in Wasabi are not deleted immediately to support restore.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  // Extract videoId from params
  const result = extractVideoId(params)
  if (!result.success) return result.response
  const videoId = result.value

  try {
    // Authenticate and authorize
    const authContext = await requireAuth(request)
    await requireVideoOwnership(authContext, videoId, request)

    const supabase = createServerSupabaseClient()

    // Check if video exists
    const { data: video, error: fetchError } = await supabase
      .from('videos')
      .select('id, deleted_at')
      .eq('id', videoId)
      .single()

    if (fetchError || !video) {
      return errorResponse('Video not found', 404)
    }

    if (video.deleted_at) {
      return errorResponse('Video already deleted', 400)
    }

    // Soft delete: mark with deleted_at timestamp
    const { error: deleteError } = await supabase
      .from('videos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', videoId)

    if (deleteError) {
      console.error(`[VideoDelete] Failed to mark as deleted:`, deleteError)
      return errorResponse('Failed to delete video', 500)
    }

    console.log(`[VideoDelete] Marked as deleted: ${videoId}`)

    // Trigger background cleanup (don't await)
    cleanupVideo(videoId).catch(error => {
      console.error(`[VideoDelete] Background cleanup failed for ${videoId}:`, error)
    })

    // Return success immediately
    return jsonResponse({ success: true, videoId })
  } catch (error) {
    // Re-throw Response objects (from auth failures)
    if (error instanceof Response) {
      throw error
    }
    console.error('Error deleting video:', error)
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500)
  }
}
