# Image Regeneration Strategy

## Overview

Combined images for annotations are regenerated asynchronously to avoid blocking the UI during "Save & Next" operations. This document explains the strategy and best practices.

## Architecture

### Dirty Flag Pattern

- Annotations have an `image_needs_regen` flag in the database
- When boundaries change, the flag is set to `1` and old image is deleted
- Background processes regenerate images and clear the flag

### Processing Strategies

## ✅ Currently Implemented: Opportunistic Processing

**How it works:**

- Runs automatically during natural workflow pauses (3 second idle time)
- Processes small batches (3 images) to avoid blocking
- Resets timer on any annotation save or navigation
- Integrated into `annotate.boundaries.tsx` via `useImageRegeneration` hook

**Advantages:**

- Zero configuration - works out of the box
- Processes images while user is thinking/reviewing
- Low resource usage (small batches)
- No separate infrastructure needed

**Limitations:**

- Only runs while annotation page is open
- Pauses during active annotation work
- May not process all images in one session

**When to use:** Development, single-user workflows, desktop applications

## Alternative Strategies (Not Implemented)

### Option 2: Periodic Background Worker

**Implementation:**

```typescript
// In a separate Node.js process or worker thread
import { processPendingRegenerations } from '~/services/image-regen-queue'

setInterval(async () => {
  const videos = getAllActiveVideos() // Get all videos being worked on
  for (const videoId of videos) {
    await processPendingRegenerations(videoId, 10)
  }
}, 60000) // Every 60 seconds
```

**Advantages:**

- Runs independently of UI
- Processes all pending images eventually
- Predictable resource usage

**Limitations:**

- Requires separate process/infrastructure
- May compete with active annotation work
- Needs video tracking mechanism

**When to use:** Multi-user server deployments, production systems

### Option 3: Job Queue System

**Implementation:**

```typescript
// Using BullMQ or similar
import Queue from 'bull'

const imageRegenQueue = new Queue('image-regeneration', {
  redis: { host: 'localhost', port: 6379 },
})

// Add job when marking dirty
await imageRegenQueue.add('regenerate', {
  videoId,
  annotationId,
  startFrame,
  endFrame,
})

// Worker processes jobs
imageRegenQueue.process('regenerate', async job => {
  await regenerateAnnotationImage(job.data.videoId, job.data.annotationId)
})
```

**Advantages:**

- Enterprise-grade reliability
- Retry logic, priority queues
- Distributed processing
- Monitoring & metrics

**Limitations:**

- Requires Redis or similar infrastructure
- Overkill for small deployments
- Added complexity

**When to use:** Large-scale production systems, microservices

### Option 4: On-Demand (Text Workflow)

**Implementation:**

```typescript
// In text annotation workflow, regenerate on-demand
async function loadAnnotationForTextReview(annotationId) {
  const annotation = await getAnnotation(videoId, annotationId)

  if (annotation.imageNeedsRegen) {
    // Regenerate now before showing to user
    await regenerateAnnotationImage(videoId, annotationId)
  }

  return annotation
}
```

**Advantages:**

- Images always fresh when needed
- No background processing needed
- Simple to understand

**Limitations:**

- User waits for regeneration
- Defeats purpose of async approach
- Only useful as fallback

**When to use:** Fallback for critical workflows, when image MUST be current

## Best Practices

### For Current Implementation (Opportunistic)

1. **Monitor pending count:**

   ```typescript
   import { getPendingRegenerationCount } from '~/services/image-regen-queue'

   const pendingCount = getPendingRegenerationCount(videoId)
   // Show indicator if count is high
   ```

2. **Adjust idle delay based on workflow:**
   - Fast annotators: `idleDelay: 5000` (5 seconds)
   - Careful reviewers: `idleDelay: 2000` (2 seconds)
   - Training mode: `idleDelay: 10000` (10 seconds)

3. **Adjust batch size based on performance:**
   - Fast SSD: `maxBatch: 5`
   - Slow disk: `maxBatch: 2`
   - Long annotations (>50 frames): `maxBatch: 1`

4. **Manual trigger for cleanup:**
   ```bash
   # Process all pending images for a video
   curl -X POST "http://localhost:3000/api/annotations/{videoId}/process-regen-queue?maxBatch=100"
   ```

### Migration Path to Production

If you need to scale up later:

1. **Start with opportunistic** (current implementation)
2. **Add periodic worker** when multiple users annotating simultaneously
3. **Add job queue** when you have distributed workers or need reliability guarantees

Each step is backward-compatible - the dirty flag mechanism supports all strategies.

## Monitoring

### Check regeneration health:

```typescript
import { getPendingRegenerationCount } from '~/services/image-regen-queue'

// In a monitoring dashboard
const videos = getAllVideos()
for (const video of videos) {
  const pending = getPendingRegenerationCount(video.id)
  if (pending > 50) {
    console.warn(`Video ${video.id} has ${pending} pending regenerations`)
  }
}
```

### Performance metrics:

```typescript
// In process-regen-queue.tsx, add timing
const start = Date.now()
const processed = await processPendingRegenerations(videoId, maxBatch)
const duration = Date.now() - start

console.log(`Processed ${processed} images in ${duration}ms (${duration / processed}ms per image)`)
```

## Troubleshooting

### Images not regenerating?

1. Check if hook is enabled: `useImageRegeneration({ enabled: true })`
2. Verify idle delay isn't too long
3. Check console for errors
4. Manually trigger: `POST /api/annotations/{videoId}/process-regen-queue`

### Performance issues?

1. Reduce `maxBatch` to process fewer images at once
2. Increase `idleDelay` to wait longer between batches
3. Check if disk I/O is bottleneck (use SSD)
4. Profile image generation (median calculation is O(n²) for pixels)

### Images regenerating during active work?

1. Increase `idleDelay` (currently 3 seconds)
2. Ensure events are firing correctly (`annotation-saved`, `annotation-navigated`)
3. Check that timer is resetting on activity
