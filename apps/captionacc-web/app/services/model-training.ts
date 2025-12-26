/**
 * Background training service for box classification model.
 *
 * Triggers automatic model retraining when annotation thresholds are reached.
 */

import { exec } from 'child_process'
import { resolve } from 'path'

/**
 * Get path to annotations database for a video.
 */
function getAnnotationsDatabasePath(videoId: string): string {
  return resolve(
    process.cwd(),
    '..',
    '..',
    'local',
    'data',
    ...videoId.split('/'),
    'annotations.db'
  )
}

/**
 * Trigger asynchronous model training.
 *
 * Runs the box-classification training CLI command in the background.
 * Training happens asynchronously - this function returns immediately.
 *
 * @param videoId Video identifier (e.g., "showname/S01E01")
 */
export function triggerModelTraining(videoId: string): void {
  const dbPath = getAnnotationsDatabasePath(videoId)

  console.log(`[Model Training] Triggering retraining for ${videoId}`)

  // Run training command in background
  exec(`uv run box-classification train ${dbPath}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`[Model Training] Failed for ${videoId}:`, error.message)
      if (stderr) {
        console.error(`[Model Training] stderr:`, stderr)
      }
    } else {
      console.log(`[Model Training] Success for ${videoId}`)
      console.log(stdout)
    }
  })
}
