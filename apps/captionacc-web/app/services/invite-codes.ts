/**
 * Invite Code Service
 *
 * Handles invite code validation and signup with invite codes.
 */

import type { Database } from '~/types/supabase'
import { createServerSupabaseClient } from './supabase-client'

type InviteCodeRow = Database['captionacc_production']['Tables']['invite_codes']['Row']
type TenantInsert = Database['captionacc_production']['Tables']['tenants']['Insert']
type UserProfileInsert = Database['captionacc_production']['Tables']['user_profiles']['Insert']

export interface InviteCodeValidation {
  valid: boolean
  error?: string
  code?: string
}

/**
 * Validate an invite code (server-side only)
 *
 * @param code - The invite code to validate
 * @returns Validation result
 */
export async function validateInviteCode(code: string): Promise<InviteCodeValidation> {
  console.log('[validateInviteCode] Called with code:', code)

  if (!code || code.trim().length === 0) {
    console.log('[validateInviteCode] Code is empty')
    return { valid: false, error: 'Invite code is required' }
  }

  const supabase = createServerSupabaseClient()
  const normalizedCode = code.trim().toUpperCase()

  console.log('[validateInviteCode] Normalized code:', normalizedCode)
  console.log('[validateInviteCode] Querying invite_codes table...')

  const { data: inviteCode, error } = await supabase
    .from('invite_codes')
    .select('*')
    .eq('code', normalizedCode)
    .single()

  console.log('[validateInviteCode] Query result:', { data: inviteCode, error })

  if (error || !inviteCode) {
    console.log('[validateInviteCode] Invalid - error or no data')
    return { valid: false, error: 'Invalid invite code' }
  }

  // Check if expired
  if (inviteCode.expires_at && new Date(inviteCode.expires_at) < new Date()) {
    return { valid: false, error: 'Invite code has expired' }
  }

  // Check if max uses reached
  const usesCount = inviteCode.uses_count ?? 0
  const maxUses = inviteCode.max_uses ?? 1
  if (usesCount >= maxUses) {
    return { valid: false, error: 'Invite code has been fully used' }
  }

  return { valid: true, code: inviteCode.code }
}

/**
 * Mark invite code as used (server-side only)
 *
 * @param code - The invite code
 * @param userId - The user who used the code
 */
export async function markInviteCodeAsUsed(code: string, userId: string): Promise<void> {
  const supabase = createServerSupabaseClient()

  await supabase
    .from('invite_codes')
    .update({
      used_by: userId,
      used_at: new Date().toISOString(),
    })
    .eq('code', code)

  // Increment uses_count separately
  const { data: current } = await supabase
    .from('invite_codes')
    .select('uses_count')
    .eq('code', code)
    .single()

  if (current) {
    const currentCount = current.uses_count ?? 0
    await supabase
      .from('invite_codes')
      .update({ uses_count: currentCount + 1 })
      .eq('code', code)
  }
}

/**
 * Create a tenant for a new user (server-side only)
 *
 * @param userId - User UUID
 * @param email - User email
 * @returns Tenant ID
 */
export async function createTenantForUser(userId: string, email: string): Promise<string> {
  const supabase = createServerSupabaseClient()

  // Generate tenant name from email
  const tenantName = email.split('@')[0] + "'s Workspace"
  const tenantSlug = userId // Use user ID as slug for uniqueness

  // Check if tenant already exists
  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .single()

  if (existingTenant) {
    console.log('[createTenantForUser] Tenant already exists, reusing:', existingTenant.id)
    return existingTenant.id
  }

  const tenantData: TenantInsert = {
    name: tenantName,
    slug: tenantSlug,
    storage_quota_gb: 1, // 1GB default for preview (integer type)
  }

  const { data: tenant, error } = await supabase
    .from('tenants')
    .insert(tenantData)
    .select()
    .single()

  if (error || !tenant) {
    throw new Error('Failed to create tenant: ' + (error?.message ?? 'Unknown error'))
  }

  return tenant.id
}

/**
 * Create user profile with invite code tracking (server-side only)
 *
 * @param userId - User UUID
 * @param tenantId - Tenant UUID
 * @param fullName - User's full name
 * @param inviteCode - Invite code used (if any)
 */
export async function createUserProfile(
  userId: string,
  tenantId: string,
  fullName: string | undefined,
  inviteCode: string | null
): Promise<void> {
  const supabase = createServerSupabaseClient()

  // Check if profile already exists
  const { data: existingProfile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('id', userId)
    .single()

  if (existingProfile) {
    console.log('[createUserProfile] Profile already exists for user:', userId)
    return
  }

  const profileData: UserProfileInsert = {
    id: userId,
    tenant_id: tenantId,
    full_name: fullName ?? null,
    role: 'owner', // B2C: user is owner of their own tenant
  }

  const { error } = await supabase.from('user_profiles').insert(profileData)

  if (error) {
    throw new Error('Failed to create user profile: ' + error.message)
  }
}

/**
 * Complete signup with invite code (server-side endpoint)
 *
 * Call this after Supabase auth.signUp succeeds
 *
 * @param userId - New user's UUID
 * @param email - User's email
 * @param fullName - User's full name
 * @param inviteCode - Invite code (required)
 */
export async function completeSignupWithInviteCode(
  userId: string,
  email: string,
  fullName: string | undefined,
  inviteCode: string
): Promise<{ success: boolean; error?: string; tenantId?: string }> {
  try {
    // Validate invite code
    const validation = await validateInviteCode(inviteCode)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // Create tenant
    const tenantId = await createTenantForUser(userId, email)

    // Create user profile
    await createUserProfile(userId, tenantId, fullName, validation.code ?? null)

    // Mark invite code as used
    if (validation.code) {
      await markInviteCodeAsUsed(validation.code, userId)
    }

    return { success: true, tenantId }
  } catch (error) {
    console.error('Signup completion error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Signup failed',
    }
  }
}
