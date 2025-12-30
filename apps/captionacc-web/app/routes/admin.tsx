/**
 * Admin dashboard for system management
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router'

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

export default function AdminPage() {
  const [failedVideos, setFailedVideos] = useState<FailedVideo[]>([])
  const [loadingFailed, setLoadingFailed] = useState(true)
  const [retryingVideos, setRetryingVideos] = useState<Set<string>>(new Set())
  const [modelVersionStats, setModelVersionStats] = useState<ModelVersionStats | null>(null)
  const [runningModelCheck, setRunningModelCheck] = useState(false)

  // Load failed videos on mount
  useEffect(() => {
    loadFailedVideos()
  }, [])

  const loadFailedVideos = async () => {
    setLoadingFailed(true)
    try {
      const response = await fetch('/api/admin/failed-crop-frames')
      const data = await response.json()
      setFailedVideos(data.videos || [])
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
            <Link
              to="/videos"
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← Back to Videos
            </Link>
          </div>
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
                onClick={loadFailedVideos}
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
                    onClick={retryAll}
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
                          onClick={() => retryVideo(video.videoId)}
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
              onClick={runModelVersionCheck}
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
                        <div
                          key={idx}
                          className="text-xs text-gray-600 dark:text-gray-400 font-mono"
                        >
                          {video.displayPath} ({video.oldVersion ?? 'null'} → {video.newVersion})
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* System Stats Section (placeholder for future) */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              System Stats
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Database statistics and health checks coming soon...
            </p>
          </div>

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
      </div>
    </div>
  )
}
