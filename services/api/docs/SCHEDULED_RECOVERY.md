# Scheduled Video Recovery

## Overview

The API automatically checks for stuck videos every 15 minutes using Fly.io's recommended scheduling approach with [Supercronic](https://github.com/aptible/supercronic).

## How It Works

1. **Supercronic** runs as a background process inside the API container (alongside the FastAPI server and Prefect worker)
2. Every 15 minutes, Supercronic executes `scripts/trigger_recovery.sh` based on the schedule in `crontab`
3. The script calls the internal endpoint `POST /internal/recovery/trigger`
4. This triggers the `captionacc-video-recovery` Prefect flow asynchronously
5. The recovery flow finds videos stuck in "uploading" or "processing" status for >10 minutes and retries them
6. Machine auto-stops when there's no external HTTP traffic and no active Prefect flows

## Duty Cycle

**When no stuck videos are found (typical case):**
- Recovery check runs: ~5-10 seconds
- Machine remains on for background processes (Prefect worker, Supercronic)
- **Machine auto-stops based on HTTP service activity: no external requests for ~5 minutes**

**When stuck videos are found:**
- Recovery check: ~5-10 seconds
- Video processing: variable (depends on number of videos and processing time)
- Machine stays on until all triggered flows complete
- **Auto-stop after last flow completes + 5 minutes of no external HTTP activity**

**Key characteristics:**
- Scheduled checks run every 15 minutes regardless of machine state
- Machine auto-stops based on HTTP service inactivity, not on background process activity
- Prefect worker and Supercronic run continuously but don't prevent auto-stop
- Only external HTTP requests and active flow runs keep the machine awake
- When a user accesses the API or a flow is running, machine stays on

## Files

- **`crontab`** - Cron schedule (every 15 minutes)
- **`scripts/trigger_recovery.sh`** - Script that calls the recovery endpoint
- **`scripts/start.sh`** - Startup script that launches both FastAPI and Supercronic
- **`app/routers/internal.py`** - Internal endpoints including `/internal/recovery/trigger`
- **`app/flows/video_recovery.py`** - Prefect flow that finds and retries stuck videos
- **`Dockerfile`** - Installs Supercronic and configures the container

## Configuration

### Schedule (crontab)
```cron
# Check for stuck videos every 15 minutes
*/15 * * * * bash /app/scripts/trigger_recovery.sh
```

### Recovery Parameters
- **Age threshold**: Videos stuck for >10 minutes
- **Retry priority**: 50 (medium priority)
- **Race condition protection**: Skips videos with active or recent flow runs

## Monitoring

### Cron Logs
Supercronic logs are written to `/tmp/recovery-cron.log` inside the container:
```bash
fly ssh console
tail -f /tmp/recovery-cron.log
```

### Recovery Flow Runs
View recovery flow runs in Prefect UI or via CLI:
```bash
prefect deployment run captionacc-video-recovery
```

Filter by tags:
- `recovery` - All recovery flows
- `scheduled` - Triggered by scheduler
- `trigger:internal-endpoint` - Triggered via HTTP endpoint

## Alternative Approaches Considered

### Fly.io Machines Schedule API
Fly.io supports basic machine scheduling with `hourly`, `daily`, `weekly`, `monthly` intervals, but:
- ❌ Cannot schedule every 15 minutes (only coarse intervals)
- ❌ Scheduled machines can't be started manually via API
- ✅ Would have lower duty cycle (machine fully stops between runs)

**Verdict:** Too coarse-grained for video recovery needs

### External Cron Service
Services like cron-job.org or GitHub Actions could trigger the endpoint:
- ✅ Fine-grained scheduling (every 15 minutes)
- ✅ Machine fully stops between checks
- ❌ Requires external service dependency
- ❌ Doesn't use "Fly.io's own scheduler"

**Verdict:** Rejected per user requirement to use Fly.io's scheduler

### Supercronic (Selected Approach)
Fly.io's recommended approach for cron-style scheduling:
- ✅ Fine-grained scheduling (every 15 minutes)
- ✅ Uses Fly.io's recommended tooling
- ✅ No external dependencies
- ✅ Fully contained within the API machine
- ⚠️ Background process runs continuously (but doesn't prevent HTTP-based auto-stop)

**Verdict:** Best fit for requirements

## References

- [Fly.io Task Scheduling Guide](https://fly.io/docs/blueprints/task-scheduling/)
- [Supercronic GitHub](https://github.com/aptible/supercronic)
- [Fly.io Autostop/Autostart Documentation](https://fly.io/docs/launch/autostop-autostart/)
