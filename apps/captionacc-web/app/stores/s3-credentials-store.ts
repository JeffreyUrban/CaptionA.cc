/**
 * S3 Credentials Store - Zustand store for STS credentials
 *
 * This store manages:
 * - Current credentials state
 * - Loading and error states
 * - Auto-refresh before expiration
 * - Logout cleanup
 *
 * Persistence:
 * - Uses sessionStorage (cleared on tab close)
 * - Syncs across tabs via BroadcastChannel
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import {
  getS3Credentials,
  refreshS3Credentials,
  clearS3Credentials,
  subscribeToCredentialUpdates,
  getTimeUntilExpiration,
  type S3CredentialsResponse,
} from '~/services/s3-credentials'
import { onAuthStateChange } from '~/services/supabase-client'

// ============================================================================
// Types
// ============================================================================

export interface S3CredentialsStore {
  // State
  credentials: S3CredentialsResponse | null
  loading: boolean
  error: string | null
  expiresAt: string | null

  // Actions
  fetchCredentials: () => Promise<void>
  refreshIfNeeded: () => Promise<void>
  clearCredentials: () => void

  // Internal
  _setCredentials: (credentials: S3CredentialsResponse) => void
  _setLoading: (loading: boolean) => void
  _setError: (error: string | null) => void
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useS3CredentialsStore = create<S3CredentialsStore>()(
  persist(
    (set, get) => ({
      // Initial state
      credentials: null,
      loading: false,
      error: null,
      expiresAt: null,

      // Fetch credentials (use cache if valid)
      fetchCredentials: async () => {
        const state = get()

        // Don't fetch if already loading
        if (state.loading) {
          return
        }

        set({ loading: true, error: null })

        try {
          const credentials = await getS3Credentials()

          set({
            credentials,
            expiresAt: credentials.expiration,
            loading: false,
            error: null,
          })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          set({
            credentials: null,
            expiresAt: null,
            loading: false,
            error: errorMessage,
          })
        }
      },

      // Refresh credentials if needed (close to expiration)
      refreshIfNeeded: async () => {
        const state = get()

        // Don't refresh if no credentials
        if (!state.credentials) {
          return
        }

        // Check if needs refresh
        const timeUntilExpiration = getTimeUntilExpiration()

        if (timeUntilExpiration === null || timeUntilExpiration > 5 * 60 * 1000) {
          // More than 5 minutes until expiration
          return
        }

        // Refresh in background
        try {
          const credentials = await refreshS3Credentials()

          set({
            credentials,
            expiresAt: credentials.expiration,
            error: null,
          })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          console.error('[S3CredentialsStore] Failed to refresh credentials:', errorMessage)
          // Don't clear credentials on refresh failure - they may still be valid
        }
      },

      // Clear credentials (on logout)
      clearCredentials: () => {
        clearS3Credentials()
        set({
          credentials: null,
          expiresAt: null,
          loading: false,
          error: null,
        })
      },

      // Internal: Set credentials (for BroadcastChannel updates)
      _setCredentials: credentials => {
        set({
          credentials,
          expiresAt: credentials.expiration,
          error: null,
        })
      },

      // Internal: Set loading state
      _setLoading: loading => {
        set({ loading })
      },

      // Internal: Set error state
      _setError: error => {
        set({ error })
      },
    }),
    {
      name: 's3-credentials-store',
      storage: createJSONStorage(() => sessionStorage),
      // Only persist credentials and expiresAt (not loading/error)
      partialize: state => ({
        credentials: state.credentials,
        expiresAt: state.expiresAt,
      }),
    }
  )
)

// ============================================================================
// Auto-refresh Timer
// ============================================================================

let refreshInterval: NodeJS.Timeout | null = null

/**
 * Start auto-refresh timer (checks every minute)
 */
function startAutoRefresh() {
  if (refreshInterval) {
    return
  }

  refreshInterval = setInterval(
    () => {
      const store = useS3CredentialsStore.getState()
      void store.refreshIfNeeded()
    },
    60 * 1000 // Check every minute
  )
}

/**
 * Stop auto-refresh timer
 */
function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize store - subscribe to auth changes and credential updates
 *
 * Call this once when app starts (e.g., in root component)
 */
export function initializeS3CredentialsStore() {
  // Subscribe to auth state changes
  onAuthStateChange((event, session) => {
    const store = useS3CredentialsStore.getState()

    if (event === 'SIGNED_OUT' || !session) {
      // Clear credentials on logout
      store.clearCredentials()
      stopAutoRefresh()
    } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      // Start auto-refresh on login
      startAutoRefresh()
    }
  })

  // Subscribe to cross-tab credential updates
  subscribeToCredentialUpdates(credentials => {
    const store = useS3CredentialsStore.getState()

    if (credentials) {
      store._setCredentials(credentials)
    } else {
      store.clearCredentials()
    }
  })

  // Start auto-refresh if already signed in
  startAutoRefresh()
}
