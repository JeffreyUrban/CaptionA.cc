# Process New Videos System

## Overview

The video recovery system identifies and retries videos that failed to get picked up for processing. This ensures no videos are left in a stuck state.

## What Makes a Video "Stuck"?

A video is considered stuck if:
- Status is `uploading` or `pending`
- Created more than 10 minutes ago
- Not currently being processed
- Has no recent flow runs (last 5 minutes)

## Recovery Mechanisms

### 1. Automatic Recovery (Recommended)

A scheduled Prefect flow runs **every 15 minutes** to automatically find and retry stuck videos.

**Flow:** `captionacc-process-new-videos`
**Schedule:** `*/15 * * * *` (every 15 minutes)
**Location:** `app/flows/process_new_videos.py`

#### How It Works

```
Every 15 minutes:
  ↓
1. Query for stuck videos (age > 10 minutes)
  ↓
2. For each stuck video:
   ├─ Check for existing/active flow runs
   ├─ Check for recent completions (last 5 minutes)
   ├─ Skip if already being processed (race protection)
   └─ Trigger video_initial_processing if safe
  ↓
3. Log results for monitoring
```

#### Race Condition Protection

The system prevents duplicate processing by checking:
- **Active runs**: Won't retry if there's a PENDING/RUNNING/SCHEDULED flow run
- **Recent completions**: Won't retry if processed in last 5 minutes
- **Recent runs**: Checks last 100 flow runs for matching video_id

#### Monitoring Automatic Recovery

View recovery flow runs:
```bash
PREFECT_API_URL="..." prefect flow-run ls --flow-name captionacc-process-new-videos
```

Check recovery logs:
```bash
fly logs --app captionacc-api | grep "process-new-videos"
```

### 2. Manual Recovery Scripts

For manual intervention or debugging.

#### Find Stuck Videos

```bash
# Find videos stuck for >10 minutes
python scripts/find_stuck_videos.py

# Custom age threshold
python scripts/find_stuck_videos.py --age-minutes 30

# JSON output
python scripts/find_stuck_videos.py --json
```

**Output:**
```
Searching for videos stuck for >10 minutes...

Found 2 stuck video(s):

ID                                     Name                 Status       Age             Tenant ID
--------------------------------------------------------------------------------------------------------------------------------
ff952127-5892-404f-aeac-43d04e0c7878  04                   uploading    45m ago         8dd6b65a-30c0-4961-8b33-e17a2812b906
a1b2c3d4-5e6f-7890-abcd-ef1234567890  vacation-2024        pending      22m ago         8dd6b65a-30c0-4961-8b33-e17a2812b906

To retry these videos, run:
  python scripts/retry_stuck_videos.py
```

#### Retry Stuck Videos

```bash
# Dry run (show what would be retried)
python scripts/retry_stuck_videos.py --dry-run

# Retry all stuck videos
python scripts/retry_stuck_videos.py

# Retry specific video by ID
python scripts/retry_stuck_videos.py --video-id <uuid>

# Custom age threshold
python scripts/retry_stuck_videos.py --age-minutes 30
```

**Output:**
```
Searching for stuck videos (age > 10 minutes)...

Found 2 stuck video(s)

Retrying: 04 (ID: ff952127-5892-404f-aeac-43d04e0c7878)
  ✓ Triggered flow run 512177e7-c7cf-4b82-9608-cfad92c8ad06 for video ff952127-5892-404f-aeac-43d04e0c7878

Retrying: vacation-2024 (ID: a1b2c3d4-5e6f-7890-abcd-ef1234567890)
  ✗ Skipping video a1b2c3d4-5e6f-7890-abcd-ef1234567890: active_flow_runs

============================================================
RETRY SUMMARY
============================================================
Total videos found:    2
Successfully triggered: 1
Failed:                1
```

#### Environment Variables Required

```bash
export SUPABASE_URL="https://stbnsczvywpwjzbpfehp.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
export PREFECT_API_URL="https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api"
```

## Common Scenarios

### Scenario 1: Realtime Event Missed

**Problem:** Supabase Realtime notification wasn't received (network issue, API restart)

**Solution:** Automatic recovery will pick it up within 15 minutes

**Manual fix:**
```bash
python scripts/find_stuck_videos.py
python scripts/retry_stuck_videos.py
```

### Scenario 2: Deployments Didn't Exist

**Problem:** Video was uploaded before Prefect deployments were registered

**Solution:** Automatic recovery will retry now that deployments exist

**Manual fix:**
```bash
# Find old stuck videos (30+ minutes)
python scripts/find_stuck_videos.py --age-minutes 30
python scripts/retry_stuck_videos.py --age-minutes 30
```

### Scenario 3: API Was Down

**Problem:** API service was offline when video was uploaded

**Solution:** Automatic recovery will retry within 15 minutes of API coming back online

### Scenario 4: Prefect Worker Crash

**Problem:** Worker crashed before picking up the flow run

**Solution:**
1. Automatic recovery checks for abandoned flow runs
2. Retries if no active processing detected

## Avoiding False Positives

The system is designed to be conservative and avoid retrying videos that:
- Are currently being processed (any active flow runs)
- Were recently processed (last 5 minutes)
- Have large files still uploading to storage

## Disabling Automatic Recovery

If you need to temporarily disable automatic recovery:

```bash
# Pause the schedule
PREFECT_API_URL="..." prefect deployment pause captionacc-process-new-videos/captionacc-process-new-videos

# Resume later
PREFECT_API_URL="..." prefect deployment resume captionacc-process-new-videos/captionacc-process-new-videos
```

## Monitoring & Alerts

### View Recovery History

```bash
# Recent recovery runs
PREFECT_API_URL="..." prefect flow-run ls \
  --flow-name captionacc-process-new-videos \
  --limit 10

# View specific run details
PREFECT_API_URL="..." prefect flow-run inspect <flow-run-id>
```

### Check Recovery Logs

```bash
# API logs
fly logs --app captionacc-api | grep recovery

# Prefect UI
# Visit: https://banchelabs-gateway.fly.dev/prefect/flow-runs
```

### Metrics to Monitor

- Number of stuck videos found per run
- Success/skip/failure rates
- Time between video creation and recovery trigger
- Frequency of race condition skips

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Process New Videos Flow                    │
│                  (runs every 15 minutes)                 │
└─────────────────────────────────────────────────────────┘
                           │
                           ↓
              ┌────────────────────────┐
              │  find_stuck_videos     │
              │  - Query Supabase      │
              │  - Filter by age/status│
              └────────────────────────┘
                           │
                           ↓
          ┌─────────────────────────────────┐
          │   For each stuck video:          │
          └─────────────────────────────────┘
                           │
                           ↓
              ┌────────────────────────┐
              │ check_existing_runs    │
              │ - Query Prefect API    │
              │ - Check active runs    │
              │ - Check recent runs    │
              └────────────────────────┘
                           │
                 ┌─────────┴─────────┐
                 │                   │
            Can retry?           Already processing?
                 │                   │
                 ↓                   ↓
    ┌────────────────────┐   ┌──────────┐
    │ trigger_processing │   │   Skip   │
    │ - Create flow run  │   │          │
    │ - Tag: recovery    │   └──────────┘
    └────────────────────┘
```

## Implementation Details

### Scheduling with Supercronic

The API uses [Supercronic](https://github.com/aptible/supercronic) (Fly.io's recommended approach) for cron-style scheduling:

1. **Supercronic** runs as a background process inside the API container
2. Every 15 minutes, it executes `scripts/trigger_process_new_videos.sh`
3. The script calls the internal endpoint `POST /internal/process-new-videos/trigger`
4. This triggers the `captionacc-process-new-videos` Prefect flow

### Files

| File | Purpose |
|------|---------|
| `crontab` | Cron schedule (every 15 minutes) |
| `scripts/trigger_process_new_videos.sh` | Script that calls the trigger endpoint |
| `scripts/start.sh` | Startup script launching FastAPI + Supercronic |
| `app/routers/internal.py` | Internal endpoints including trigger |
| `app/flows/process_new_videos.py` | Prefect flow that finds and retries stuck videos |

### Duty Cycle

**When no stuck videos are found (typical):**
- Recovery check: ~5-10 seconds
- Machine auto-stops based on HTTP inactivity (~5 minutes)

**When stuck videos are found:**
- Recovery check: ~5-10 seconds
- Video processing: variable (depends on number of videos)
- Machine stays on until all triggered flows complete

### Why Supercronic?

| Approach | Pros | Cons |
|----------|------|------|
| Fly.io Machines Schedule | Lower duty cycle | Only hourly/daily intervals |
| External cron service | Fine-grained | External dependency |
| **Supercronic** | Fine-grained, no external deps | Background process runs continuously |

## Troubleshooting

### Recovery isn't running

Check deployment status:
```bash
PREFECT_API_URL="..." prefect deployment ls
```

Verify schedule:
```bash
PREFECT_API_URL="..." prefect deployment inspect \
  captionacc-process-new-videos/captionacc-process-new-videos
```

Check Supercronic logs:
```bash
fly ssh console
tail -f /tmp/recovery-cron.log
```

### Videos still stuck after recovery

1. Check recovery flow logs for errors
2. Verify video actually meets "stuck" criteria
3. Check if worker is running and healthy
4. Manually trigger processing:
   ```bash
   python scripts/retry_stuck_videos.py --video-id <uuid>
   ```

### Too many false positives

Increase age threshold in deployment schedule (edit `prefect.yaml`):
```yaml
parameters:
  age_minutes: 20  # Default is 10
```

Then redeploy:
```bash
fly deploy --app captionacc-api
```

## References

- [Fly.io Task Scheduling Guide](https://fly.io/docs/blueprints/task-scheduling/)
- [Supercronic GitHub](https://github.com/aptible/supercronic)
- [Fly.io Autostop/Autostart Documentation](https://fly.io/docs/launch/autostop-autostart/)
