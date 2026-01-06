/**
 * Complete Signup API Endpoint
 *
 * POST /api/auth/complete-signup
 *
 * Called after Supabase auth.signUp succeeds.
 * Validates invite code, creates tenant, and creates user profile.
 */

import type { ActionFunctionArgs } from 'react-router'

import { completeSignupWithInviteCode } from '~/services/invite-codes'

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 })
  }

  try {
    const body = await request.json()
    const { userId, email, fullName, inviteCode } = body

    if (!userId || !email || !inviteCode) {
      return Response.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }

    const result = await completeSignupWithInviteCode(userId, email, fullName, inviteCode)

    if (!result.success) {
      return Response.json(
        { success: false, error: result.error ?? 'Signup failed' },
        { status: 400 }
      )
    }

    return Response.json({ success: true, tenantId: result.tenantId })
  } catch (error) {
    console.error('Complete signup error:', error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
