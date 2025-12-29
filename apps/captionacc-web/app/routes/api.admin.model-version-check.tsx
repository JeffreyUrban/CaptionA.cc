/**
 * Admin endpoint to trigger model version check across all videos
 *
 * POST /api/admin/model-version-check
 *
 * This endpoint runs the background model version monitoring process on demand.
 * Use this to manually trigger recalculation after model updates.
 */

import { type ActionFunctionArgs } from 'react-router'

import { runModelVersionCheck } from '~/services/model-version-monitor'

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    console.log('[AdminAPI] Starting model version check...')

    const results = await runModelVersionCheck()

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
        message: `Checked ${results.total} videos: ${results.upToDate} up-to-date, ${results.boundsChanged} bounds changed`,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('[AdminAPI] Model version check failed:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
