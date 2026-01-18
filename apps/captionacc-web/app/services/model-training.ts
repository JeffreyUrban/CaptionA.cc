/**
 * Background training service for box classification model.
 *
 * Triggers automatic model retraining when annotation thresholds are reached.
 */

import { exec } from 'child_process'
import { resolve } from 'path'

import { completeProcessing } from './processing-status-tracker'

/**
 * Get path to annotations database for a video.
 */
function getAnnotationsDatabasePath(videoId: string): string {
  return resolve(process.cwd(), '..', '..', 'local', 'data', ...videoId.split('/'), 'captions.db')
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
  const packageDir = resolve(process.cwd(), '..', '..', 'packages', 'box_classification')

  console.log(`[Model Training] Triggering retraining for ${videoId}`)

  // Run training command in background from the package directory
  exec(`uv run box-classification ${dbPath}`, { cwd: packageDir }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[Model Training] Failed for ${videoId}:`, error.message)
      if (stderr) {
        console.error(`[Model Training] stderr:`, stderr)
      }
      // Mark as complete even on error
      completeProcessing(videoId)
    } else {
      console.log(`[Model Training] Success for ${videoId}`)
      console.log(stdout)

      // Trigger prediction recalculation in background
      console.log(`[Model Training] Triggering prediction recalculation for ${videoId}`)
      fetch(
        `/videos/${encodeURIComponent(videoId)}/calculate-predictions`,
        {
          method: 'POST',
        }
      )
        .then(response => response.json())
        .then(result => {
          console.log(`[Model Training] Predictions recalculated:`, result)
          // Mark as complete after predictions recalculated
          completeProcessing(videoId)
        })
        .catch(err => {
          console.error(`[Model Training] Failed to recalculate predictions:`, err.message)
          // Mark as complete even on error
          completeProcessing(videoId)
        })
    }
  })
}
