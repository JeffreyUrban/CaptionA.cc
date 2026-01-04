# CaptionA.cc Orchestrator

Python-based video processing workflow orchestration using Prefect Cloud (Hobby plan).

## Overview

This service replaces the TypeScript in-process orchestration (`processing-coordinator.ts`, `video-processing.ts`, `crop-frames-processing.ts`) with a Python-native solution that:

- ✅ Decouples processing from the web server (workers run independently)
- ✅ Provides durable job queues (survives server restarts)
- ✅ Tracks asset lineage automatically (see what data depends on what)
- ✅ Scales processing independently from the UI
- ✅ Includes built-in monitoring, retries, and error handling
- ✅ **No separate API server needed** - uses CLI commands like your existing pipelines

## Simplified Architecture

```
TypeScript App (apps/captionacc-web)
    ↓ spawn('uv', ['run', 'python', 'services/orchestrator/queue_flow.py', ...])
Python CLI (queue_flow.py)
    ↓ Queue flow run
Prefect Cloud (Hobby plan - free)
    ↓ Poll for work
Prefect Worker (start_worker.py)
    ↓ Execute flows
Python Pipelines (data-pipelines/full_frames, crop_frames, etc.)
```

**Key difference from old approach:**
- **Old:** TypeScript spawns `uv run python -m full_frames analyze ...` (runs pipeline directly)
- **New:** TypeScript spawns `uv run python queue_flow.py full-frames ...` (queues to Prefect)

## Prefect Cloud Hobby Plan

**What you get (free):**
- 2 users, 1 workspace
- Up to 5 deployments
- 7 days run retention
- **Asset lineage visualization** 🎉

## Quick Start

### Prerequisites

1. Python 3.11+ (you already have this)
2. `uv` package manager (you already have this)
3. Prefect Cloud account (sign up at https://app.prefect.cloud/)

### Setup

```bash
cd services/orchestrator

# 1. Install Prefect (only new dependency)
make install

# 2. Run interactive setup
make setup

# 3. Deploy flows to Prefect Cloud
make deploy
```

### Running

You need **2 terminal windows** (not 3 anymore!):

#### Terminal 1: Prefect Worker
```bash
cd services/orchestrator
make worker
```

This worker:
- Polls Prefect Cloud for flow runs
- Executes video processing pipelines
- Limits to 2 concurrent jobs
- Runs continuously (leave it running)

#### Terminal 2: Your Web App (existing)
```bash
cd apps/captionacc-web
npm run dev
```

Your TypeScript app calls `queue_flow.py` just like it calls `full_frames` now!

## TypeScript Integration

### Update Upload Handler

Replace the direct pipeline spawn with flow queuing:

```typescript
// apps/captionacc-web/app/routes/api.upload.$.tsx (or wherever you handle uploads)

// OLD APPROACH:
/*
import { queueVideoProcessing } from '~/services/video-processing'

queueVideoProcessing({
  videoPath,
  videoFile,
  videoId
})
*/

// NEW APPROACH:
import { spawn } from 'child_process'
import { resolve } from 'path'

// After upload completes, queue Prefect flow
const queueCmd = spawn(
  'uv',
  [
    'run',
    'python',
    'services/orchestrator/queue_flow.py',
    'full-frames',
    '--video-id', videoId,
    '--video-path', videoFile,
    '--db-path', getDbPath(videoId),
    '--output-dir', resolve(getVideoDir(videoId), 'full_frames'),
  ],
  {
    cwd: resolve(process.cwd(), '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  }
)

let stdout = ''
queueCmd.stdout?.on('data', data => {
  stdout += data.toString()
})

queueCmd.on('close', code => {
  if (code === 0) {
    const result = JSON.parse(stdout)
    console.log(`[Prefect] Queued flow: ${result.flow_run_id}`)
  } else {
    console.error('[Prefect] Failed to queue flow')
  }
})
```

### Update Layout Approval Handler

```typescript
// When user approves layout, queue crop frames flow

const cropBounds = {
  left: layoutConfig.crop_left,
  top: layoutConfig.crop_top,
  right: layoutConfig.crop_right,
  bottom: layoutConfig.crop_bottom,
}

const queueCmd = spawn(
  'uv',
  [
    'run',
    'python',
    'services/orchestrator/queue_flow.py',
    'crop-frames',
    '--video-id', videoId,
    '--video-path', videoFile,
    '--db-path', getDbPath(videoId),
    '--output-dir', resolve(getVideoDir(videoId), 'crop_frames'),
    '--crop-bounds', JSON.stringify(cropBounds),
    '--crop-bounds-version', layoutConfig.crop_bounds_version.toString(),
  ],
  {
    cwd: resolve(process.cwd(), '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  }
)
```

### Helper Function (Recommended)

Create a reusable helper:

```typescript
// apps/captionacc-web/app/services/prefect.ts

import { spawn } from 'child_process'
import { resolve } from 'path'

export async function queuePrefectFlow(
  flowType: 'full-frames' | 'crop-frames',
  args: Record<string, string>
): Promise<{ flowRunId: string }> {
  const cmdArgs = [
    'run',
    'python',
    'services/orchestrator/queue_flow.py',
    flowType,
  ]

  // Convert args object to CLI flags
  for (const [key, value] of Object.entries(args)) {
    cmdArgs.push(`--${key}`, value)
  }

  return new Promise((resolve, reject) => {
    const cmd = spawn('uv', cmdArgs, {
      cwd: resolve(process.cwd(), '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    cmd.stdout?.on('data', data => {
      stdout += data.toString()
    })

    cmd.stderr?.on('data', data => {
      stderr += data.toString()
    })

    cmd.on('close', code => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout)
          resolve({ flowRunId: result.flow_run_id })
        } catch (e) {
          reject(new Error(`Failed to parse output: ${stdout}`))
        }
      } else {
        reject(new Error(`Flow queuing failed: ${stderr}`))
      }
    })
  })
}

// Usage:
await queuePrefectFlow('full-frames', {
  'video-id': videoId,
  'video-path': videoFile,
  'db-path': dbPath,
  'output-dir': outputDir,
})
```

## Status Tracking

**No changes needed!** Your existing database polling works the same:
- `processing_status` table tracks full_frames progress
- `crop_frames_status` table tracks crop_frames progress

The Prefect flows update these tables just like the old direct pipelines did.

## Monitoring

### Prefect Cloud UI

Visit https://app.prefect.cloud/ to see:
- Flow run history and status
- Asset lineage graph (visual dependency tracking)
- Logs from flow executions
- Performance metrics

### Local Logs

**Worker logs:** Check terminal running `make worker`
**Database status:** Query `processing_status` and `crop_frames_status` as before

## Migration Steps

### Phase 1: Setup (Today)
```bash
cd services/orchestrator
make install
make setup
make deploy
```

### Phase 2: Start Worker (Leave Running)
```bash
make worker  # Leave this running in a terminal/tmux/screen
```

### Phase 3: Update TypeScript (Gradual)

Start with **just one endpoint** to test:

1. Update upload handler to use `queuePrefectFlow` helper
2. Test with a real video upload
3. Verify in Prefect Cloud UI that flow runs
4. Check that database status updates correctly

Once working:

5. Update layout approval handler for crop frames
6. Test crop frames workflow
7. Delete old orchestration files:
   ```bash
   rm apps/captionacc-web/app/services/processing-coordinator.ts
   rm apps/captionacc-web/app/services/video-processing.ts
   rm apps/captionacc-web/app/services/crop-frames-processing.ts
   ```

## Future: Adding ML Workflows

When ready for ML training/inference:

```python
# flows/ml_training.py
from prefect import flow, task
from prefect.assets import materialize

@materialize("models://boundary-detection-{version}")
@task
def train_boundary_model(training_data_path: str, version: str):
    # Your ML training code
    pass

@flow(name="train-ml-models")
def train_models_flow(training_data_path: str, model_version: str):
    # Training pipeline
    pass
```

Add to `deploy.py`, then:
```bash
make deploy
```

**Deployment limit:** 5 total on Hobby plan (you'll have 3 free slots)

## Dependencies

**Only adds:** `prefect` (~10MB package)

**Reuses from your project:**
- Python 3.14
- uv
- All existing data-pipelines dependencies

**No conflicts** with existing pydantic, fastapi, etc.

## Troubleshooting

### "Failed to connect to Prefect"

```bash
prefect cloud login
prefect cloud workspace ls
```

### "Work pool not found"

```bash
prefect work-pool create video-processing-pool --type process
```

### Worker not picking up jobs

1. Worker running? `make worker` should show "polling"
2. Flows deployed? `prefect deployment ls`
3. Check Prefect Cloud UI for flow runs

## CLI Reference

### Queue Full Frames
```bash
uv run python queue_flow.py full-frames \
  --video-id UUID \
  --video-path /path/to/video.mp4 \
  --db-path /path/to/annotations.db \
  --output-dir /path/to/output \
  --frame-rate 0.1
```

### Queue Crop Frames
```bash
uv run python queue_flow.py crop-frames \
  --video-id UUID \
  --video-path /path/to/video.mp4 \
  --db-path /path/to/annotations.db \
  --output-dir /path/to/output \
  --crop-bounds '{"left":100,"top":50,"right":1820,"bottom":980}' \
  --crop-bounds-version 1
```

## Production Deployment

For production:

1. **Run worker as systemd service** (Linux) or equivalent
2. **Use environment variables** for Prefect API key
3. **Monitor worker health** (Prefect Cloud shows worker status)
4. **Consider upgrading** Prefect plan if you need:
   - More than 5 deployments
   - More than 7 days retention
   - More users

## Resources

- **Prefect Docs:** https://docs.prefect.io/
- **Prefect Cloud:** https://app.prefect.cloud/
- **Project Docs:** See /PROJECT.md for pipeline details
