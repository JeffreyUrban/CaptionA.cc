/**
 * Move a video to a different folder by updating its display_path
 */
import type { ActionFunctionArgs } from 'react-router'

import { createServerSupabaseClient } from '~/services/supabase-client'
import {
  badRequestResponse,
  conflictResponse,
  errorResponse,
  jsonResponse,
} from '~/utils/api-responses'
import { requireAuth, requireVideoOwnership } from '~/utils/api-auth'

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'PATCH') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    // Authenticate user
    const authContext = await requireAuth(request)

    const body = await request.json()
    const { videoPath, targetFolder } = body

    if (!videoPath) {
      return badRequestResponse('videoPath is required')
    }

    // targetFolder can be empty string (root folder)
    if (targetFolder === undefined || targetFolder === null) {
      return badRequestResponse('targetFolder is required (use empty string for root)')
    }

    // Validate target folder path if not empty
    if (targetFolder) {
      const trimmedTargetFolder = targetFolder.trim()
      if (trimmedTargetFolder.startsWith('/') || trimmedTargetFolder.endsWith('/')) {
        return badRequestResponse('Target folder should not start or end with /')
      }

      if (!/^[a-zA-Z0-9_\-/\s]+$/.test(trimmedTargetFolder)) {
        return badRequestResponse('Target folder contains invalid characters')
      }
    }

    const supabase = createServerSupabaseClient()

    // Find video by display_path
    const { data: video, error: fetchError } = await supabase
      .from('videos')
      .select('id, display_path')
      .eq('display_path', videoPath)
      .is('deleted_at', null)
      .single()

    if (fetchError || !video) {
      return errorResponse('Video not found', 404)
    }

    // Verify ownership
    await requireVideoOwnership(authContext, video.id, request)

    // Validate display_path exists
    if (!video.display_path) {
      return badRequestResponse('Video display_path is missing')
    }

    // Extract video name from current display_path
    const pathParts = video.display_path.split('/')
    const videoName = pathParts[pathParts.length - 1]

    // Build new display_path
    const newPath = targetFolder ? `${targetFolder}/${videoName}` : (videoName ?? '')

    // Prevent moving to current location
    if (video.display_path === newPath) {
      return badRequestResponse('Video is already in this location')
    }

    // Check for name conflict in target folder
    const { data: existingVideo } = await supabase
      .from('videos')
      .select('id')
      .eq('display_path', newPath)
      .is('deleted_at', null)
      .single()

    if (existingVideo) {
      return conflictResponse(
        `A video named "${videoName}" already exists in ${targetFolder ? `folder "${targetFolder}"` : 'the root folder'}`
      )
    }

    console.log(`[VideoMove] Moving "${video.display_path}" to "${newPath}"`)

    // Update display_path
    const { error: updateError } = await supabase
      .from('videos')
      .update({ display_path: newPath })
      .eq('id', video.id)

    if (updateError) {
      console.error('[VideoMove] Failed to update database:', updateError)
      return errorResponse('Failed to update video', 500)
    }

    console.log(`[VideoMove] Updated display_path: ${video.display_path} -> ${newPath}`)

    return jsonResponse({
      success: true,
      oldPath: video.display_path,
      newPath,
    })
  } catch (error) {
    console.error('Error moving video:', error)
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500)
  }
}
