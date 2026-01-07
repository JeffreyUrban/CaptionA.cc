/**
 * Rename a video in the video library
 * Updates the display_path in Supabase (storage paths are immutable UUIDs)
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
    const { oldPath, newName } = body

    if (!oldPath || !newName) {
      return badRequestResponse('oldPath and newName are required')
    }

    // Validate new name
    const trimmedNewName = newName.trim()
    if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmedNewName)) {
      return badRequestResponse('Video name contains invalid characters')
    }

    // Calculate new display path (same parent directory, new name)
    const pathParts = oldPath.split('/')
    pathParts[pathParts.length - 1] = trimmedNewName
    const newPath = pathParts.join('/')

    const supabase = createServerSupabaseClient()

    // Find video by old display_path
    const { data: video, error: fetchError } = await supabase
      .from('videos')
      .select('id, display_path')
      .eq('display_path', oldPath)
      .is('deleted_at', null)
      .single()

    if (fetchError || !video) {
      return errorResponse('Video not found', 404)
    }

    // Verify ownership
    await requireVideoOwnership(authContext, video.id, request)

    // Check if new path already exists
    const { data: existingVideo } = await supabase
      .from('videos')
      .select('id')
      .eq('display_path', newPath)
      .is('deleted_at', null)
      .single()

    if (existingVideo) {
      return conflictResponse('A video with this name already exists')
    }

    // Update the display_path
    const { error: updateError } = await supabase
      .from('videos')
      .update({ display_path: newPath })
      .eq('id', video.id)

    if (updateError) {
      console.error('Failed to rename video:', updateError)
      return errorResponse('Failed to rename video', 500)
    }

    return jsonResponse({ success: true, oldPath, newPath })
  } catch (error) {
    console.error('Error renaming video:', error)
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500)
  }
}
