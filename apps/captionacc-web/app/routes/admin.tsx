/**
 * Admin dashboard for system management
 */

import { useEffect, useState } from 'react'
import { useLoaderData, useNavigate } from 'react-router'

import { AppLayout } from '~/components/AppLayout'
import { useAuth } from '~/components/auth/AuthProvider'
import type { DatabaseInfo, StatusSummary } from '~/services/database-admin-service'

interface FailedVideo {
  videoId: string
  displayPath: string
  errorMessage: string
  errorContext?: Record<string, unknown>
  processingStartedAt: string | null
}

interface ModelVersionStats {
  total: number
  upToDate: number
  recalculated: number
  cropRegionChanged: number
  errors: number
  changedVideos: Array<{ displayPath: string; oldVersion: string | null; newVersion: string }>
}

interface RepairSummary {
  total: number
  current: number
  repaired: number
  failed: number
  needsConfirmation: number
  schemaVersion: number
  hasDestructiveChanges: boolean
  destructiveActionsSummary?: {
    tablesToRemove: Record<string, { databases: number; totalRows: number }>
    columnsToRemove: Record<string, { databases: number }>
  }
  results: Array<{
    path: string
    status: string
    actions: string[]
    destructiveActions: string[]
    error?: string
  }>
}

interface DatabaseAdministrationProps {
  CURRENT_SCHEMA_VERSION: number
  LATEST_SCHEMA_VERSION: number
  hasLatestSchema: boolean
}

function DatabaseAdministration({
  CURRENT_SCHEMA_VERSION,
  LATEST_SCHEMA_VERSION,
  hasLatestSchema,
}: DatabaseAdministrationProps) {
  const { session } = useAuth()
  const [summary, setSummary] = useState<StatusSummary | null>(null)
  const [databases, setDatabases] = useState<DatabaseInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showDetails, setShowDetails] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [repairResult, setRepairResult] = useState<RepairSummary | null>(null)

  useEffect(() => {
    loadStatus()
  }, [])

  // Helper function for authenticated API calls
  const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    if (!session?.access_token) {
      throw new Error('No access token available')
    }

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${session.access_token}`,
      },
    })
  }

  async function loadStatus() {
    setLoading(true)
    try {
      const response = await authenticatedFetch('/api/admin/databases/status')
      const data = await response.json()
      setSummary(data)
    } catch (error) {
      console.error('Failed to load database status:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadDetails() {
    try {
      const response = await authenticatedFetch('/api/admin/databases/list')
      const data = await response.json()
      setDatabases(data.databases)
      setShowDetails(true)
    } catch (error) {
      console.error('Failed to load database details:', error)
    }
  }

  async function repairDatabases(targetVersion: number, force: boolean = false) {
    // First pass: check for destructive changes
    if (!force) {
      setRepairing(true)
      setRepairResult(null)

      try {
        const response = await authenticatedFetch('/api/admin/databases/repair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetVersion, force: false }),
        })

        const result = await response.json()

        if (!response.ok) {
          alert(`Repair failed: ${result.error || 'Unknown error'}`)
          setRepairing(false)
          return
        }

        // Check if there are destructive changes that need confirmation
        if (result.hasDestructiveChanges) {
          const summary = result.destructiveActionsSummary
          let message = `⚠️ WARNING: This repair will delete data from ${result.needsConfirmation} databases!\n\n`

          if (summary?.tablesToRemove && Object.keys(summary.tablesToRemove).length > 0) {
            message += 'Tables to be removed:\n'
            for (const [table, info] of Object.entries(summary.tablesToRemove)) {
              const tableInfo = info as { databases: number; totalRows: number }
              message += `  - ${table}: ${tableInfo.databases} databases (${tableInfo.totalRows} rows total)\n`
            }
          }

          if (summary?.columnsToRemove && Object.keys(summary.columnsToRemove).length > 0) {
            message += '\nColumns to be removed:\n'
            for (const [column, info] of Object.entries(summary.columnsToRemove)) {
              const columnInfo = info as { databases: number }
              message += `  - ${column}: ${columnInfo.databases} databases\n`
            }
          }

          message += '\nContinue?'

          if (!confirm(message)) {
            setRepairing(false)
            return
          }

          // User confirmed, proceed with force
          setRepairResult(null)
          await repairDatabases(targetVersion, true)
          return
        }

        // No destructive changes, show result
        setRepairResult(result)
        await loadStatus()
        // Refresh video list if it's currently visible
        if (showDetails) {
          await loadDetails()
        }
      } catch (error) {
        console.error('Failed to repair databases:', error)
        alert('Failed to repair databases')
      } finally {
        setRepairing(false)
      }
      return
    }

    // Second pass: apply with force
    setRepairing(true)

    try {
      const response = await authenticatedFetch('/api/admin/databases/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetVersion, force: true }),
      })

      const result = await response.json()

      if (response.ok) {
        setRepairResult(result)
        await loadStatus()
        // Refresh video list if it's currently visible
        if (showDetails) {
          await loadDetails()
        }
      } else {
        alert(`Repair failed: ${result.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to repair databases:', error)
      alert('Failed to repair databases')
    } finally {
      setRepairing(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Database Administration
        </h2>
        <div className="text-center py-4">Loading...</div>
      </div>
    )
  }

  if (!summary) {
    return null
  }

  const hasProblems =
    summary.health.incomplete > 0 || summary.health.drift > 0 || summary.health.unversioned > 0

  // Calculate version range (support current and previous version)
  const minSupportedVersion = Math.max(0, CURRENT_SCHEMA_VERSION - 1)
  const maxSupportedVersion = CURRENT_SCHEMA_VERSION

  // Find actual version distribution
  const versionCounts = Object.entries(summary.byVersion)
    .map(([version, count]) => ({ version: Number(version), count }))
    .sort((a, b) => b.version - a.version)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Database Administration
          </h2>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
            <div>
              Schema versions supported: v{minSupportedVersion}–v{maxSupportedVersion}
            </div>
            <div>
              Current distribution:{' '}
              {versionCounts
                .map(({ version, count }) => {
                  const versionLabel = version === LATEST_SCHEMA_VERSION ? 'latest' : `v${version}`
                  return `${versionLabel} (${count})`
                })
                .join(', ')}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex flex-col gap-1">
            <div className="text-xs text-gray-600 dark:text-gray-400 font-medium">Repair to:</div>
            <div className="flex">
              {hasLatestSchema && (
                <button
                  onClick={() => {
                    void repairDatabases(LATEST_SCHEMA_VERSION)
                  }}
                  disabled={repairing}
                  className="px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-l-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Repair to latest unreleased schema (development)"
                >
                  {repairing ? 'Repairing...' : 'Latest'}
                </button>
              )}
              <button
                onClick={() => {
                  void repairDatabases(CURRENT_SCHEMA_VERSION)
                }}
                disabled={repairing}
                className={`px-3 py-1.5 bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed ${hasLatestSchema ? 'border-l border-blue-500' : 'rounded-l-md'}`}
              >
                v{CURRENT_SCHEMA_VERSION}
              </button>
              <button
                onClick={() => {
                  void repairDatabases(minSupportedVersion)
                }}
                disabled={repairing || minSupportedVersion === CURRENT_SCHEMA_VERSION}
                className="px-3 py-1.5 bg-blue-500 text-white text-sm font-medium rounded-r-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed border-l border-blue-400"
                title={`Repair to v${minSupportedVersion} (for testing)`}
              >
                v{minSupportedVersion}
              </button>
            </div>
          </div>
          <button
            onClick={() => {
              void loadStatus()
            }}
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
          <div className="text-xs text-gray-600 dark:text-gray-400">Total</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.total}</div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded p-3">
          <div className="text-xs text-green-600 dark:text-green-400">Valid</div>
          <div className="text-2xl font-bold text-green-700 dark:text-green-300">
            {summary.health.valid}
          </div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded p-3">
          <div className="text-xs text-yellow-600 dark:text-yellow-400">Schema Drift</div>
          <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
            {summary.health.drift}
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded p-3">
          <div className="text-xs text-red-600 dark:text-red-400">Issues</div>
          <div className="text-2xl font-bold text-red-700 dark:text-red-300">
            {summary.health.incomplete + summary.health.unversioned}
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Last scan: {new Date(summary.lastScan).toLocaleString()}
      </div>

      {repairResult && (
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">
            Repair Complete
          </h3>
          <div className="text-xs text-blue-800 dark:text-blue-400 space-y-1">
            <div>Total databases: {repairResult.total}</div>
            <div>
              No repair needed: {repairResult.current}{' '}
              <span className="text-gray-600 dark:text-gray-500">
                (already v{repairResult.schemaVersion})
              </span>
            </div>
            <div>Successfully repaired: {repairResult.repaired}</div>
            {repairResult.needsConfirmation > 0 && (
              <div className="text-yellow-600 dark:text-yellow-400 font-medium">
                Needs confirmation: {repairResult.needsConfirmation}
              </div>
            )}
            {repairResult.failed > 0 && (
              <div className="text-red-600 dark:text-red-400 font-medium">
                Failed: {repairResult.failed}
              </div>
            )}
            <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700 space-y-2">
              {repairResult.repaired > 0 && (
                <details className="cursor-pointer">
                  <summary className="font-medium">View repaired databases</summary>
                  <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                    {repairResult.results
                      .filter(r => r.status === 'repaired')
                      .map((r, i) => (
                        <div key={i} className="text-xs bg-white dark:bg-gray-800 p-2 rounded">
                          <div className="font-mono">{r.path}</div>
                          <div className="text-gray-600 dark:text-gray-400 ml-2">
                            {r.actions.map((action, j) => (
                              <div key={j}>• {action}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </details>
              )}
              {repairResult.needsConfirmation > 0 && (
                <details className="cursor-pointer" open>
                  <summary className="font-medium text-yellow-600 dark:text-yellow-400">
                    View databases needing confirmation
                  </summary>
                  <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                    {repairResult.results
                      .filter(r => r.status === 'needs_confirmation')
                      .map((r, i) => (
                        <div
                          key={i}
                          className="text-xs bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded border border-yellow-200 dark:border-yellow-800"
                        >
                          <div className="font-mono font-medium text-yellow-900 dark:text-yellow-300">
                            {r.path}
                          </div>
                          {r.destructiveActions.length > 0 && (
                            <div className="text-yellow-700 dark:text-yellow-400 ml-2 mt-1">
                              <div className="font-medium">Destructive changes required:</div>
                              {r.destructiveActions.map((action, j) => (
                                <div key={j} className="ml-2">
                                  • {action}
                                </div>
                              ))}
                            </div>
                          )}
                          {r.actions.length > 0 && (
                            <div className="text-yellow-600 dark:text-yellow-500 ml-2 mt-1">
                              <div className="font-medium">Actions attempted:</div>
                              {r.actions.map((action, j) => (
                                <div key={j} className="ml-2">
                                  • {action}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </details>
              )}
              {repairResult.failed > 0 && (
                <details className="cursor-pointer" open>
                  <summary className="font-medium text-red-600 dark:text-red-400">
                    View failed databases
                  </summary>
                  <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                    {repairResult.results
                      .filter(r => r.status === 'failed')
                      .map((r, i) => (
                        <div
                          key={i}
                          className="text-xs bg-red-50 dark:bg-red-900/20 p-2 rounded border border-red-200 dark:border-red-800"
                        >
                          <div className="font-mono font-medium text-red-900 dark:text-red-300">
                            {r.path}
                          </div>
                          <div className="text-red-700 dark:text-red-400 ml-2 mt-1">
                            <div className="font-medium">Error:</div>
                            <div className="ml-2">{r.error || 'Unknown error'}</div>
                          </div>
                          {r.actions.length > 0 && (
                            <div className="text-red-600 dark:text-red-500 ml-2 mt-1">
                              <div className="font-medium">Actions attempted:</div>
                              {r.actions.map((action, j) => (
                                <div key={j} className="ml-2">
                                  • {action}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => {
          if (showDetails) {
            setShowDetails(false)
          } else {
            void loadDetails()
          }
        }}
        className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
      >
        {showDetails ? 'Hide Databases ↑' : 'View All Databases →'}
      </button>

      {showDetails && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="text-left py-2">Video ID</th>
                  <th className="text-left py-2">Path</th>
                  <th className="text-center py-2">Version</th>
                  <th className="text-center py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {databases.slice(0, 50).map(db => (
                  <tr key={db.videoId} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 font-mono text-xs text-gray-900 dark:text-gray-300">
                      {db.videoId.slice(0, 8)}...
                    </td>
                    <td className="py-2 truncate max-w-[200px] text-gray-900 dark:text-gray-300">
                      {db.displayPath || '—'}
                    </td>
                    <td className="py-2 text-center text-gray-900 dark:text-gray-300">
                      {db.versionLabel}
                    </td>
                    <td className="py-2 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          db.status === 'valid'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : db.status === 'drift'
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {db.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {databases.length > 50 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Showing first 50 of {databases.length} databases
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Loader to get schema versions (server-side only)
export async function loader() {
  // Note: With localStorage auth, server-side auth checks are not possible
  // Admin protection is enforced at API endpoints (which check Authorization header)
  // Client-side: AppLayout checks admin status and shows/hides admin nav link

  // Import on server side only
  const { CURRENT_SCHEMA_VERSION, LATEST_SCHEMA_VERSION } = await import('~/db/migrate')
  const { hasLatestSchema } = await import('~/db/schema-loader')
  const { resolve } = await import('path')

  // Check if latest unreleased schema file exists
  const schemaDir = resolve(process.cwd(), 'app', 'db')
  const hasLatest = hasLatestSchema(schemaDir)

  return {
    CURRENT_SCHEMA_VERSION,
    LATEST_SCHEMA_VERSION,
    hasLatestSchema: hasLatest,
  }
}

export default function AdminPage() {
  const { CURRENT_SCHEMA_VERSION, LATEST_SCHEMA_VERSION, hasLatestSchema } =
    useLoaderData<typeof loader>()
  const { session, user } = useAuth()
  const navigate = useNavigate()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [failedVideos, setFailedVideos] = useState<FailedVideo[]>([])
  const [loadingFailed, setLoadingFailed] = useState(true)
  const [retryingVideos, setRetryingVideos] = useState<Set<string>>(new Set())
  const [modelVersionStats, setModelVersionStats] = useState<ModelVersionStats | null>(null)
  const [runningModelCheck, setRunningModelCheck] = useState(false)

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

  // Load failed videos on mount (only if admin check passes)
  useEffect(() => {
    if (isAdmin === true) {
      void loadFailedVideos()
    }
  }, [isAdmin])

  // Helper function for authenticated API calls
  const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    if (!session?.access_token) {
      throw new Error('No access token available')
    }

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${session.access_token}`,
      },
    })
  }

  const loadFailedVideos = async () => {
    setLoadingFailed(true)
    try {
      const response = await authenticatedFetch('/api/admin/failed-crop-frames')
      const data = await response.json()
      setFailedVideos(data.videos ?? [])
    } catch (error) {
      console.error('Failed to load failed videos:', error)
    } finally {
      setLoadingFailed(false)
    }
  }

  const retryVideo = async (videoId: string) => {
    setRetryingVideos(prev => new Set(prev).add(videoId))
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(videoId)}/retry-crop-frames`, {
        method: 'POST',
      })

      if (response.ok) {
        // Remove from failed list
        setFailedVideos(prev => prev.filter(v => v.videoId !== videoId))
      } else {
        const error = await response.json()
        alert(`Failed to retry: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to retry video:', error)
      alert('Failed to retry video')
    } finally {
      setRetryingVideos(prev => {
        const next = new Set(prev)
        next.delete(videoId)
        return next
      })
    }
  }

  const retryAll = async () => {
    for (const video of failedVideos) {
      await retryVideo(video.videoId)
    }
  }

  const runModelVersionCheck = async () => {
    setRunningModelCheck(true)
    try {
      const response = await authenticatedFetch('/api/admin/model-version-check', {
        method: 'POST',
      })

      if (response.ok) {
        const data = await response.json()
        setModelVersionStats(data)
      } else {
        const error = await response.json()
        alert(`Failed to run model version check: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to run model version check:', error)
      alert('Failed to run model version check')
    } finally {
      setRunningModelCheck(false)
    }
  }

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
          System management and administrative tasks
        </p>
      </div>

      {/* Grid of admin sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Failed Crop Frames Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Failed Crop Frames
            </h2>
            <button
              onClick={() => {
                void loadFailedVideos()
              }}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
            >
              Refresh
            </button>
          </div>

          {loadingFailed ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Loading...</p>
            </div>
          ) : failedVideos.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-600 dark:text-gray-400">No failed videos found ✓</p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {failedVideos.length} video{failedVideos.length !== 1 ? 's' : ''} with errors
                </p>
                <button
                  onClick={() => {
                    void retryAll()
                  }}
                  disabled={retryingVideos.size > 0}
                  className="mt-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Retry All
                </button>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {failedVideos.map(video => (
                  <div
                    key={video.videoId}
                    className="border border-gray-200 dark:border-gray-700 rounded-md p-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {video.displayPath}
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                          {video.errorMessage}
                        </p>
                        {video.processingStartedAt && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Failed at: {new Date(video.processingStartedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          void retryVideo(video.videoId)
                        }}
                        disabled={retryingVideos.has(video.videoId)}
                        className="ml-3 px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {retryingVideos.has(video.videoId) ? 'Retrying...' : 'Retry'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Model Version Check Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Model Version Check
            </h2>
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Check all videos for model version mismatches and trigger automatic recalculation.
          </p>

          <button
            onClick={() => {
              void runModelVersionCheck()
            }}
            disabled={runningModelCheck}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {runningModelCheck ? 'Running...' : 'Run Model Version Check'}
          </button>

          {modelVersionStats && (
            <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                Last Check Results
              </h3>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-gray-600 dark:text-gray-400">Total Videos</dt>
                  <dd className="font-medium text-gray-900 dark:text-white">
                    {modelVersionStats.total}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-600 dark:text-gray-400">Up to Date</dt>
                  <dd className="font-medium text-green-600 dark:text-green-400">
                    {modelVersionStats.upToDate}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-600 dark:text-gray-400">Recalculated</dt>
                  <dd className="font-medium text-blue-600 dark:text-blue-400">
                    {modelVersionStats.recalculated}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-600 dark:text-gray-400">Bounds Changed</dt>
                  <dd className="font-medium text-yellow-600 dark:text-yellow-400">
                    {modelVersionStats.cropRegionChanged}
                  </dd>
                </div>
              </dl>

              {modelVersionStats.changedVideos.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                    Videos with Changed Bounds
                  </h4>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {modelVersionStats.changedVideos.map((video, idx) => (
                      <div key={idx} className="text-xs text-gray-600 dark:text-gray-400 font-mono">
                        {video.displayPath} ({video.oldVersion ?? 'null'} → {video.newVersion})
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Database Administration */}
        <DatabaseAdministration
          CURRENT_SCHEMA_VERSION={CURRENT_SCHEMA_VERSION}
          LATEST_SCHEMA_VERSION={LATEST_SCHEMA_VERSION}
          hasLatestSchema={hasLatestSchema}
        />

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
