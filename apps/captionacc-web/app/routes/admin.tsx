/**
 * Admin dashboard for system management
 *
 * Provides administrative tools for:
 * - Database sync status monitoring (server/wasabi versions)
 * - Force sync capabilities for recovery
 * - Lock management and cleanup
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { useAuth } from '~/components/auth/AuthProvider'
import { API_CONFIG } from '~/config'

// Types for Python backend admin endpoints
interface DatabaseSyncInfo {
  videoId: string
  database: string
  serverVersion: number | null
  wasabiVersion: number | null
  lockHolder: string | null
  lastActivity: string | null
}

interface DatabaseListResponse {
  databases: DatabaseSyncInfo[]
  total: number
}

interface ForceSyncResult {
  success: boolean
  message: string
  videoId: string
  database: string
}

interface LockCleanupResult {
  success: boolean
  releasedCount: number
  locks: Array<{
    videoId: string
    database: string
    holder: string
    staleSince: string
  }>
}

// Database Sync Status Component
function DatabaseSyncStatus() {
  const { session } = useAuth()
  const [databases, setDatabases] = useState<DatabaseSyncInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncingDatabases, setSyncingDatabases] = useState<Set<string>>(new Set())
  const [syncResults, setSyncResults] = useState<Map<string, ForceSyncResult>>(new Map())

  useEffect(() => {
    loadDatabases()
  }, [])

  // Helper function for authenticated API calls to Python backend
  const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    if (!session?.access_token) {
      throw new Error('No access token available')
    }

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    })
  }

  async function loadDatabases() {
    setLoading(true)
    setError(null)
    try {
      const response = await authenticatedFetch(`${API_CONFIG.PYTHON_API_URL}/admin/databases`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to load databases')
      }
      const data: DatabaseListResponse = await response.json()
      setDatabases(data.databases)
    } catch (err) {
      console.error('Failed to load database status:', err)
      setError(err instanceof Error ? err.message : 'Failed to load databases')
    } finally {
      setLoading(false)
    }
  }

  async function forceSync(videoId: string, database: string) {
    const key = `${videoId}:${database}`
    setSyncingDatabases(prev => new Set(prev).add(key))
    setSyncResults(prev => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })

    try {
      const response = await authenticatedFetch(
        `${API_CONFIG.PYTHON_API_URL}/admin/databases/${encodeURIComponent(videoId)}/${encodeURIComponent(database)}/sync`,
        { method: 'POST' }
      )

      const result: ForceSyncResult = await response.json()

      if (!response.ok) {
        setSyncResults(prev =>
          new Map(prev).set(key, {
            success: false,
            message: result.message || 'Sync failed',
            videoId,
            database,
          })
        )
      } else {
        setSyncResults(prev => new Map(prev).set(key, result))
        // Refresh database list to show updated versions
        await loadDatabases()
      }
    } catch (err) {
      console.error('Failed to force sync:', err)
      setSyncResults(prev =>
        new Map(prev).set(key, {
          success: false,
          message: err instanceof Error ? err.message : 'Sync failed',
          videoId,
          database,
        })
      )
    } finally {
      setSyncingDatabases(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Database Sync Status
        </h2>
        <div className="text-center py-4">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Database Sync Status
        </h2>
        <div className="text-center py-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={() => {
              void loadDatabases()
            }}
            className="mt-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Database Sync Status
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {databases.length} database{databases.length !== 1 ? 's' : ''} tracked
          </p>
        </div>
        <button
          onClick={() => {
            void loadDatabases()
          }}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
        >
          Refresh
        </button>
      </div>

      {databases.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-gray-600 dark:text-gray-400">No databases found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left py-2 pr-2">Video ID</th>
                <th className="text-left py-2 px-2">Database</th>
                <th className="text-center py-2 px-2">Server Ver</th>
                <th className="text-center py-2 px-2">Wasabi Ver</th>
                <th className="text-left py-2 px-2">Lock Holder</th>
                <th className="text-left py-2 px-2">Last Activity</th>
                <th className="text-center py-2 pl-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {databases.map(db => {
                const key = `${db.videoId}:${db.database}`
                const isSyncing = syncingDatabases.has(key)
                const syncResult = syncResults.get(key)
                const isOutOfSync =
                  db.serverVersion !== null &&
                  db.wasabiVersion !== null &&
                  db.serverVersion !== db.wasabiVersion

                return (
                  <tr key={key} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pr-2 font-mono text-xs text-gray-900 dark:text-gray-300">
                      {db.videoId.slice(0, 8)}...
                    </td>
                    <td className="py-2 px-2 text-gray-900 dark:text-gray-300">{db.database}</td>
                    <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-300">
                      {db.serverVersion ?? '-'}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span
                        className={
                          isOutOfSync
                            ? 'text-yellow-600 dark:text-yellow-400 font-medium'
                            : 'text-gray-900 dark:text-gray-300'
                        }
                      >
                        {db.wasabiVersion ?? '-'}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-xs text-gray-600 dark:text-gray-400">
                      {db.lockHolder ? (
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 rounded">
                          {db.lockHolder.slice(0, 12)}...
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-xs text-gray-600 dark:text-gray-400">
                      {db.lastActivity ? new Date(db.lastActivity).toLocaleString() : '-'}
                    </td>
                    <td className="py-2 pl-2 text-center">
                      <button
                        onClick={() => {
                          void forceSync(db.videoId, db.database)
                        }}
                        disabled={isSyncing}
                        className="px-2 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSyncing ? 'Syncing...' : 'Force Sync'}
                      </button>
                      {syncResult && (
                        <div
                          className={`mt-1 text-xs ${syncResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                        >
                          {syncResult.success ? 'Synced' : syncResult.message}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Lock Management Component
function LockManagement() {
  const { session } = useAuth()
  const [cleaning, setCleaning] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<LockCleanupResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Helper function for authenticated API calls to Python backend
  const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    if (!session?.access_token) {
      throw new Error('No access token available')
    }

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    })
  }

  async function cleanupStaleLocks() {
    setCleaning(true)
    setError(null)
    setCleanupResult(null)

    try {
      const response = await authenticatedFetch(
        `${API_CONFIG.PYTHON_API_URL}/admin/locks/cleanup`,
        { method: 'POST' }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Failed to cleanup locks')
      }

      const result: LockCleanupResult = await response.json()
      setCleanupResult(result)
    } catch (err) {
      console.error('Failed to cleanup locks:', err)
      setError(err instanceof Error ? err.message : 'Failed to cleanup locks')
    } finally {
      setCleaning(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Lock Management</h2>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Release stale database locks that may be preventing sync operations. Use this to recover
        from crashed sessions or stuck locks.
      </p>

      <button
        onClick={() => {
          void cleanupStaleLocks()
        }}
        disabled={cleaning}
        className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-md hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {cleaning ? 'Cleaning Up...' : 'Release Stale Locks'}
      </button>

      {error && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {cleanupResult && (
        <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">
            Cleanup Results
          </h3>
          <div className="text-sm text-blue-800 dark:text-blue-400">
            {cleanupResult.releasedCount === 0 ? (
              <p>No stale locks found. All locks are active.</p>
            ) : (
              <>
                <p className="mb-2">
                  Released {cleanupResult.releasedCount} stale lock
                  {cleanupResult.releasedCount !== 1 ? 's' : ''}:
                </p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {cleanupResult.locks.map((lock, idx) => (
                    <div
                      key={idx}
                      className="text-xs bg-white dark:bg-gray-800 p-2 rounded font-mono"
                    >
                      <span className="text-gray-600 dark:text-gray-400">
                        {lock.videoId.slice(0, 8)}...
                      </span>
                      <span className="mx-1">/</span>
                      <span>{lock.database}</span>
                      <span className="mx-2 text-gray-400">|</span>
                      <span className="text-orange-600 dark:text-orange-400">
                        {lock.holder.slice(0, 12)}...
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminPage() {
  const { session, user } = useAuth()
  const navigate = useNavigate()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  // Check admin status on mount
  useEffect(() => {
    async function checkAdmin() {
      if (!session?.access_token || !user) {
        navigate('/login?redirectTo=/admin')
        return
      }

      try {
        const response = await fetch('/api/auth/is-platform-admin', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
        const data = (await response.json()) as { isPlatformAdmin: boolean }

        if (!data.isPlatformAdmin) {
          alert('Access denied: Platform admin privileges required')
          navigate('/')
          return
        }

        setIsAdmin(true)
      } catch (error) {
        console.error('Failed to check admin status:', error)
        navigate('/')
      }
    }

    void checkAdmin()
  }, [session, user, navigate])

  // Show loading while checking admin status
  if (isAdmin === null) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-olive-600 dark:border-olive-400"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Verifying admin access...</p>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Database sync management and lock administration for the Python backend
        </p>
      </div>

      {/* Grid of admin sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Database Sync Status */}
        <DatabaseSyncStatus />

        {/* Lock Management */}
        <LockManagement />

        {/* Background Jobs Section (placeholder for future) */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
            Background Jobs
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Monitor running background jobs and processing queue...
          </p>
        </div>
      </div>
    </AppLayout>
  )
}
