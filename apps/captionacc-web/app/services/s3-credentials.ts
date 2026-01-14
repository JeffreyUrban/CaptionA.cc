/**
 * S3 Credentials Service - STS credential management
 *
 * Fetches temporary STS credentials from Supabase Edge Function for direct S3 access.
 * Implements:
 * - sessionStorage caching until expiration
 * - Auto-refresh 5 minutes before expiration
 * - Multi-tab coordination via BroadcastChannel API
 * - Never logs credentials (security)
 *
 * Edge Function Endpoint: GET /functions/v1/captionacc-s3-credentials
 * Authorization: Bearer <supabase_jwt>
 */

import { supabase } from './supabase-client'

// ============================================================================
// Types
// ============================================================================

export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration: string
}

export interface S3CredentialsResponse {
  credentials: S3Credentials
  expiration: string
  bucket: string
  region: string
  endpoint: string
  prefix: string
}

export interface CachedCredentials extends S3CredentialsResponse {
  cachedAt: number
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'captionacc-s3-credentials'
const BROADCAST_CHANNEL_NAME = 'captionacc-s3-creds'
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // 5 minutes before expiration

// ============================================================================
// BroadcastChannel Messages
// ============================================================================

type CredentialsMessage =
  | { type: 'CREDENTIALS_UPDATED'; credentials: CachedCredentials }
  | { type: 'CREDENTIALS_CLEARED' }

// ============================================================================
// BroadcastChannel Instance
// ============================================================================

let broadcastChannel: BroadcastChannel | null = null

/**
 * Initialize BroadcastChannel for multi-tab coordination
 */
function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
    return null
  }

  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
  }

  return broadcastChannel
}

// ============================================================================
// Storage Operations
// ============================================================================

/**
 * Load credentials from sessionStorage
 */
function loadFromStorage(): CachedCredentials | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return null
    }

    const credentials = JSON.parse(stored) as CachedCredentials
    return credentials
  } catch (error) {
    console.error('[S3Credentials] Failed to load from storage:', error)
    return null
  }
}

/**
 * Save credentials to sessionStorage
 */
function saveToStorage(credentials: CachedCredentials): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credentials))

    // Broadcast to other tabs
    const channel = getBroadcastChannel()
    if (channel) {
      channel.postMessage({
        type: 'CREDENTIALS_UPDATED',
        credentials,
      } as CredentialsMessage)
    }
  } catch (error) {
    console.error('[S3Credentials] Failed to save to storage:', error)
  }
}

/**
 * Clear credentials from sessionStorage
 */
function clearStorage(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    sessionStorage.removeItem(STORAGE_KEY)

    // Broadcast to other tabs
    const channel = getBroadcastChannel()
    if (channel) {
      channel.postMessage({
        type: 'CREDENTIALS_CLEARED',
      } as CredentialsMessage)
    }
  } catch (error) {
    console.error('[S3Credentials] Failed to clear storage:', error)
  }
}

// ============================================================================
// Credential Validation
// ============================================================================

/**
 * Check if credentials are expired or will expire soon
 */
function needsRefresh(credentials: CachedCredentials): boolean {
  const expirationTime = new Date(credentials.expiration).getTime()
  const now = Date.now()
  const timeUntilExpiration = expirationTime - now

  // Refresh if expired or within 5 minutes of expiration
  return timeUntilExpiration < REFRESH_BUFFER_MS
}

// ============================================================================
// API Operations
// ============================================================================

/**
 * Fetch fresh credentials from Supabase Edge Function
 */
async function fetchCredentialsFromAPI(): Promise<S3CredentialsResponse> {
  // Get current session
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError || !session) {
    throw new Error('No active session - please sign in')
  }

  const jwt = session.access_token

  // Call Edge Function
  const supabaseUrl = import.meta.env['VITE_SUPABASE_URL']
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL environment variable not set')
  }

  const response = await fetch(
    `${supabaseUrl}/functions/v1/captionacc-s3-credentials`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch S3 credentials: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as S3CredentialsResponse
  return data
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get valid S3 credentials (from cache or fetch fresh)
 *
 * @returns S3 credentials with endpoint configuration
 * @throws Error if not authenticated or API fails
 */
export async function getS3Credentials(): Promise<S3CredentialsResponse> {
  // Check cache first
  const cached = loadFromStorage()

  if (cached && !needsRefresh(cached)) {
    return cached
  }

  // Fetch fresh credentials
  const fresh = await fetchCredentialsFromAPI()

  // Cache with timestamp
  const cached_fresh: CachedCredentials = {
    ...fresh,
    cachedAt: Date.now(),
  }

  saveToStorage(cached_fresh)

  return fresh
}

/**
 * Force refresh credentials (ignore cache)
 */
export async function refreshS3Credentials(): Promise<S3CredentialsResponse> {
  const fresh = await fetchCredentialsFromAPI()

  const cached: CachedCredentials = {
    ...fresh,
    cachedAt: Date.now(),
  }

  saveToStorage(cached)

  return fresh
}

/**
 * Clear cached credentials (on logout)
 */
export function clearS3Credentials(): void {
  clearStorage()
}

/**
 * Subscribe to credential updates from other tabs
 *
 * @param callback Function to call when credentials are updated
 * @returns Cleanup function to remove listener
 */
export function subscribeToCredentialUpdates(
  callback: (credentials: CachedCredentials | null) => void
): () => void {
  const channel = getBroadcastChannel()

  if (!channel) {
    return () => {}
  }

  const handler = (event: MessageEvent<CredentialsMessage>) => {
    if (event.data.type === 'CREDENTIALS_UPDATED') {
      callback(event.data.credentials)
    } else if (event.data.type === 'CREDENTIALS_CLEARED') {
      callback(null)
    }
  }

  channel.addEventListener('message', handler)

  return () => {
    channel.removeEventListener('message', handler)
  }
}

/**
 * Get time until credentials expire (in milliseconds)
 */
export function getTimeUntilExpiration(): number | null {
  const cached = loadFromStorage()

  if (!cached) {
    return null
  }

  const expirationTime = new Date(cached.expiration).getTime()
  const now = Date.now()

  return Math.max(0, expirationTime - now)
}
