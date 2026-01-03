/**
 * Admin dashboard for system management
 */

import { useEffect, useState } from 'react'

import { AppLayout } from '~/components/AppLayout'
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
  boundsChanged: number
  errors: number
  changedVideos: Array<{ displayPath: string; oldVersion: string | null; newVersion: string }>
}

function DatabaseAdministration() {
  const [summary, setSummary] = useState<StatusSummary | null>(null)
  const [databases, setDatabases] = useState<DatabaseInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    loadStatus()
  }, [])

  async function loadStatus() {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/databases/status')
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
      const response = await fetch('/api/admin/databases/list')
      const data = await response.json()
      setDatabases(data.databases)
      setShowDetails(true)
    } catch (error) {
      console.error('Failed to load database details:', error)
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

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          Database Administration
        </h2>
        <button
          onClick={() => {
            void loadStatus()
          }}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
          <div className="text-xs text-gray-600 dark:text-gray-400">Total</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.total}</div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded p-3">
          <div className="text-xs text-green-600 dark:text-green-400">Current</div>
          <div className="text-2xl font-bold text-green-700 dark:text-green-300">
            {summary.health.current}
          </div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded p-3">
          <div className="text-xs text-yellow-600 dark:text-yellow-400">Outdated</div>
          <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">
            {summary.health.outdated}
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

      {!showDetails ? (
        <button
          onClick={() => {
            void loadDetails()
          }}
          className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
        >
          View All Databases →
        </button>
      ) : (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
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
                      v{db.version}
                    </td>
                    <td className="py-2 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          db.status === 'current'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : db.status === 'outdated'
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

export default function AdminPage() {
  const [failedVideos, setFailedVideos] = useState<FailedVideo[]>([])
  const [loadingFailed, setLoadingFailed] = useState(true)
  const [retryingVideos, setRetryingVideos] = useState<Set<string>>(new Set())
  const [modelVersionStats, setModelVersionStats] = useState<ModelVersionStats | null>(null)
  const [runningModelCheck, setRunningModelCheck] = useState(false)

  // Load failed videos on mount
  useEffect(() => {
    void loadFailedVideos()
  }, [])

  const loadFailedVideos = async () => {
    setLoadingFailed(true)
    try {
      const response = await fetch('/api/admin/failed-crop-frames')
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
      const response = await fetch('/api/admin/model-version-check', {
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
                    {modelVersionStats.boundsChanged}
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
        <DatabaseAdministration />

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
