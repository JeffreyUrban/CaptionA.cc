/**
 * Model training service - triggers server-side model retraining.
 *
 * The actual model training happens server-side via the Python ocr_box_model package.
 * This service simply triggers the server API to start training.
 */

import { completeProcessing, startFullRetrain } from './processing-status-tracker'

/**
 * Trigger model training via server API.
 *
 * Calls the server-side calculate-predictions endpoint which will
 * train the model if needed and recalculate all predictions.
 *
 * @param videoId Video identifier (e.g., "showname/S01E01")
 */
export function triggerModelTraining(videoId: string): void {
  console.log(`[Model Training] Triggering server-side training for ${videoId}`)

  // Mark as processing
  startFullRetrain(videoId)

  // Call server API to train model and calculate predictions
  fetch(`/videos/${encodeURIComponent(videoId)}/calculate-predictions`, {
    method: 'POST',
  })
    .then(response => response.json())
    .then(result => {
      console.log(`[Model Training] Server training complete for ${videoId}:`, result)
      completeProcessing(videoId)
    })
    .catch(err => {
      console.error(`[Model Training] Failed for ${videoId}:`, err.message)
      completeProcessing(videoId)
    })
}
