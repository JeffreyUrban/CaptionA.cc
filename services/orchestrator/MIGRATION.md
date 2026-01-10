# Migration Guide: TypeScript to Prefect Orchestration

This guide shows how to migrate your existing TypeScript orchestration to Prefect.

## Summary

**Before:** TypeScript spawns Python pipelines directly
**After:** TypeScript queues flows to Prefect
**Benefit:** Workers run independently, durable queues, automatic retries

## Step 1: Start Prefect Flow Server

In JetBrains (PyCharm/IntelliJ):
1. Open Run Configurations dropdown
2. Select **"Prefect Flow Server"**
3. Click Run (or Debug)

Or from terminal:
```bash
cd services/orchestrator
make serve
```

Keep this running!

## Step 2: Update Upload Handler

**File:** `apps/captionacc-web/app/routes/api.upload.$.tsx`

### Before (lines 381-386):
```typescript
const { queueVideoProcessing } = await import('~/services/video-processing')
queueVideoProcessing({
  videoPath: displayPath,
  videoFile: finalVideoPath,
  videoId: metadata.metadata.videoId,
})
```

### After:
```typescript
const { queueFullFramesProcessing } = await import('~/services/prefect')
const { getVideoDir, getCaptionsDbPath } = await import('~/utils/video-paths')

try {
  const result = await queueFullFramesProcessing({
    videoId: metadata.metadata.videoId!,
    videoPath: finalVideoPath,
    dbPath: getCaptionsDbPath(metadata.metadata.videoId!),
    outputDir: resolve(getVideoDir(metadata.metadata.videoId!), 'full_frames'),
    frameRate: 0.1,
  })
  console.log(`[Prefect] Queued full frames: ${result.flowRunId}`)
} catch (error) {
  console.error('[Prefect] Failed to queue processing:', error)
  // Fallback: mark as error in database
}
```

## Step 3: Update Retry Full Frames Handler

**File:** `apps/captionacc-web/app/routes/api.videos.$videoId.retry-full-frames.tsx`

### Before:
```typescript
import { queueVideoProcessing } from '~/services/video-processing'

// In action function:
queueVideoProcessing({
  videoPath: video.displayPath,
  videoFile,
  videoId,
})
```

### After:
```typescript
import { queueFullFramesProcessing } from '~/services/prefect'

// In action function:
await queueFullFramesProcessing({
  videoId,
  videoPath: videoFile,
  dbPath: getCaptionsDbPath(videoId),
  outputDir: resolve(getVideoDir(videoId), 'full_frames'),
  frameRate: 0.1,
})
```

## Step 4: Update Crop Frames Queueing

**File:** Find where you call `queueCropFramesProcessing` (likely in layout approval handler)

### Before:
```typescript
import { queueCropFramesProcessing } from '~/services/crop-frames-processing'

queueCropFramesProcessing({
  videoId,
  videoPath,
  cropBounds: {
    left: layoutConfig.crop_left,
    top: layoutConfig.crop_top,
    right: layoutConfig.crop_right,
    bottom: layoutConfig.crop_bottom,
  },
})
```

### After:
```typescript
import { queueCropFramesProcessing } from '~/services/prefect'

const result = await queueCropFramesProcessing({
  videoId,
  videoPath: getVideoFile(videoId),
  dbPath: getCaptionsDbPath(videoId),
  outputDir: resolve(getVideoDir(videoId), 'crop_frames'),
  cropBounds: {
    left: layoutConfig.crop_left,
    top: layoutConfig.crop_top,
    right: layoutConfig.crop_right,
    bottom: layoutConfig.crop_bottom,
  },
  cropBoundsVersion: layoutConfig.crop_bounds_version,
})

console.log(`[Prefect] Queued crop frames: ${result.flowRunId}`)
```

## Step 5: Test

1. **Start Prefect server** (Run Config or `make serve`)
2. **Start web app** (`npm run dev`)
3. **Upload a test video**
4. **Watch logs** in Prefect server terminal
5. **Check database** - `processing_status` should update as before

## Step 6: Clean Up (After Testing)

Once you've validated that everything works:

```bash
# Delete old orchestration files
rm apps/captionacc-web/app/services/processing-coordinator.ts
rm apps/captionacc-web/app/services/video-processing.ts
rm apps/captionacc-web/app/services/crop-frames-processing.ts
```

## Troubleshooting

### "Flow not found"
- Make sure Prefect Flow Server is running
- Check terminal for errors

### "Failed to queue flow"
- Check `queue_flow.py` is in `services/orchestrator/`
- Verify Python paths are correct
- Check terminal output for Python errors

### Database not updating
- Flows use the same pipeline code, so database updates should work
- Check Prefect server logs for task execution errors
- Verify `db_path` is correct in queue call

### Want to see flow status?
```bash
# List recent flows
prefect flow-run ls --limit 10

# Watch a specific flow
prefect flow-run logs <flow-run-id>
```

## Migration Checklist

- [ ] Start Prefect Flow Server (Run Config created)
- [ ] Update upload handler (`api.upload.$.tsx`)
- [ ] Update retry handler (`api.videos.$videoId.retry-full-frames.tsx`)
- [ ] Update crop frames queueing (layout approval)
- [ ] Test full workflow with real video
- [ ] Verify database updates work
- [ ] Delete old orchestration files
- [ ] Update any other calls to `queueVideoProcessing` or `queueCropFramesProcessing`

## Benefits After Migration

✅ **Decoupled** - Workers run independently from web server
✅ **Durable** - Jobs survive server restarts
✅ **Retries** - Automatic retry on failures (3 attempts)
✅ **Logging** - Full execution logs in Prefect
✅ **Monitoring** - Can view flow history and status
✅ **Scalable** - Easy to add more workers or migrate to cloud

## Future: Deploy to Fly.io

When ready for production, you can self-host Prefect Server on Fly.io (~$5/mo) to get:
- Persistent UI with asset lineage visualization
- Remote access from anywhere
- Team collaboration
- Production-grade reliability

See `README.md` for Fly.io deployment guide.
