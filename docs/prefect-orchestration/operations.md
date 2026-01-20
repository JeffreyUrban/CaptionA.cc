# Operations Guide

Monitoring, debugging, and recovery procedures for Prefect orchestration.

## Monitoring

### Dashboards

| Dashboard | URL                                              | Purpose |
|-----------|--------------------------------------------------|---------|
| Prefect UI | https://banchelabs-gateway.fly.dev/prefect/login | Flow runs, work pools, logs |
| Fly.io | https://fly.io/apps/banchelabs-gateway           | Machine status, metrics |
| Modal | https://modal.com/apps                           | Function invocations, GPU usage |
| Supabase | Project dashboard                                | Video status, database state |

### Key Metrics

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Flow run failures | Prefect | > 3 in 1 hour |
| Worker offline | Prefect | > 5 minutes |
| Machine restarts | Fly.io | > 3 in 1 hour |
| Modal timeouts | Modal | > 2 in 1 hour |
| Processing backlog | Prefect | > 10 pending runs |

### Health Checks

```bash
# Prefect server health
curl https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api/health

# Check worker status
curl https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api/work_pools/captionacc-workers/workers

# Fly.io machine status
fly status --app banchelabs-gateway
```

---

## Common Issues

### 1. Flow Run Stuck in "Pending"

**Symptoms**: Flow runs remain in pending state, never start.

**Causes**:
- Worker not running
- Work pool paused
- Concurrency limit reached

**Resolution**:

```bash
# Check worker status
fly ssh console --app banchelabs-gateway
ps aux | grep prefect

# Restart worker if needed
fly apps restart banchelabs-gateway

# Check work pool status via Prefect UI
# Work Pools → captionacc-workers → Status

# Check concurrency
# If at limit, wait for running flows to complete
```

### 2. Modal Function Timeout

**Symptoms**: Flow fails with Modal timeout error.

**Causes**:
- Video too large
- Network issues between Modal and Wasabi
- GPU contention

**Resolution**:

```python
# Check Modal logs for the function invocation
# Modal Dashboard → Functions → extract_frames_and_ocr → Logs

# If video is too large, consider:
# 1. Increasing timeout (up to 1 hour max)
# 2. Chunking large videos
# 3. Upgrading to faster GPU

# Retry the flow manually
prefect deployment run "captionacc-video-initial-processing" \
  --param video_id=xxx \
  --param tenant_id=xxx \
  --param storage_key=xxx
```

### 4. Server Lock Not Released

**Symptoms**: Video stuck in "processing" state, user cannot edit.

**Causes**:
- Flow crashed without releasing lock
- Fly.io machine terminated unexpectedly

**Resolution**:

```sql
-- Check lock status in Supabase
SELECT * FROM video_database_state
WHERE video_id = 'xxx';

-- Force release lock (use with caution)
UPDATE video_database_state
SET lock_holder_user_id = NULL,
    lock_type = NULL
WHERE video_id = 'xxx';

-- Update video status
UPDATE videos
SET caption_status = 'error'
WHERE id = 'xxx';
```

### 5. SQLite Database Corruption (Prefect)

**Symptoms**: Prefect server fails to start, database errors in logs.

**Causes**:
- Machine terminated during write
- Volume full

**Resolution**:

```bash
# SSH into machine
fly ssh console --app banchelabs-gateway

# Check volume usage
df -h /data

# Backup and recreate database if corrupted
cp /data/prefect.db /data/prefect.db.bak
rm /data/prefect.db

# Restart (will recreate database)
# Note: Loses flow run history
fly apps restart banchelabs-gateway
```

---

## Recovery Procedures

### Reprocess Failed Video

When initial processing fails, reprocess from scratch:

```bash
# 1. Reset video status in Supabase
UPDATE videos SET status = 'uploading' WHERE id = 'xxx';

# 2. Clear any partial outputs in Wasabi
aws s3 rm s3://captionacc-prod/{tenant}/client/videos/{id}/full_frames/ --recursive
aws s3 rm s3://captionacc-prod/{tenant}/server/videos/{id}/ --recursive
aws s3 rm s3://captionacc-prod/{tenant}/client/videos/{id}/layout.db.gz

# 3. Trigger reprocessing
prefect deployment run "captionacc-video-initial-processing" \
  --param video_id=xxx \
  --param tenant_id=xxx \
  --param storage_key=xxx
```

### Rerun Crop and Caption Frame Extents Inference

When captionacc-crop-and-infer-caption-frame-extents fails after partial completion:

```bash
# 1. Release any server lock
UPDATE video_database_state
SET lock_holder_user_id = NULL, lock_type = NULL
WHERE video_id = 'xxx' AND database_name = 'layout';

# 2. Clear partial outputs
aws s3 rm s3://captionacc-prod/{tenant}/client/videos/{id}/cropped_frames_v*/ --recursive
aws s3 rm s3://captionacc-prod/{tenant}/server/videos/{id}/caption_frame_extents.db.gz
aws s3 rm s3://captionacc-prod/{tenant}/client/videos/{id}/captions.db.gz

# 3. Reset status
UPDATE videos SET caption_status = NULL WHERE id = 'xxx';

# 4. User can re-approve layout to trigger again
```

### Full System Recovery

If Prefect infrastructure needs complete rebuild:

```bash
# 1. Export any important data from logs
fly logs --app banchelabs-gateway > prefect-logs-backup.txt

# 2. Destroy and recreate volume (loses history)
fly volumes destroy prefect_data
fly volumes create prefect_data --size 1 --region iad

# 3. Redeploy
fly deploy --app banchelabs-gateway

# 4. Verify
curl https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api/health

# 5. Check for stuck videos in Supabase and reprocess
SELECT id, status, caption_status FROM videos
WHERE status = 'processing' OR caption_status = 'processing';
```

---

## Deployment Process

### Standard Deployment

```bash
# 1. Run tests
cd services/api
pytest tests/

# 2. Deploy API service to Fly.io (includes Prefect worker and flow registration)
fly deploy

# 3. Verify Prefect server health
curl https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api/health

# 4. Check worker connected
# Prefect UI → Work Pools → captionacc-workers
```

### Rolling Back

**API Service (flows and worker):**
```bash
# List recent deployments
fly releases --app captionacc-api

# Rollback to previous version
fly deploy --app captionacc-api --image registry.fly.io/captionacc-api:v123
```

**Prefect Server (gateway):**
```bash
# List recent deployments
fly releases --app banchelabs-gateway

# Rollback to previous version
fly deploy --app banchelabs-gateway --image registry.fly.io/banchelabs-gateway:v123
```

### Updating Flow Definitions

1. Update flow code in `services/api/app/flows/`
2. If adding a new flow, add its deployment to `services/api/prefect.yaml`
3. Deploy the API service: `cd services/api && fly deploy`
4. Deployments are automatically re-registered via the release command

```bash
# Verify deployments after update
export PREFECT_API_URL=https://banchelabs-gateway.fly.dev/prefect-internal/prefect/api
prefect deployment ls
```

---

## Debugging

### View Flow Run Logs

```bash
# Via Prefect UI
# Flow Runs → Select run → Logs tab

# Via CLI (if connected to Prefect server)
prefect flow-run logs <flow-run-id>
```

### View Fly.io Logs

```bash
# Real-time logs
fly logs --app banchelabs-gateway

# Historical logs
fly logs --app banchelabs-gateway --since 1h
```

### View Modal Logs

```bash
# Via Modal CLI
modal logs <function-name>

# Or via Modal Dashboard
# Functions → select function → Logs
```

### SSH into Prefect Machine

```bash
fly ssh console --app banchelabs-gateway

# Check processes
ps aux

# Check database
sqlite3 /data/prefect.db "SELECT * FROM flow_run LIMIT 10;"

# Check environment
env | grep PREFECT
```

---

## Runbooks

### Daily Operations

1. Check Prefect UI for failed runs
2. Review Fly.io metrics for anomalies
3. Check Modal dashboard for cost trends

### Weekly Operations

1. Review processing success rate
2. Check for stuck videos in Supabase
3. Review and clean up old flow runs
4. Verify backup procedures

### Incident Response

1. **Identify**: Check dashboards for failure indicators
2. **Contain**: Pause work pool if needed to stop new runs
3. **Investigate**: Check logs (Prefect → Fly.io → Modal)
4. **Fix**: Apply resolution from common issues
5. **Recover**: Reprocess affected videos
6. **Document**: Update runbook if new issue type

---

## Alerting Configuration

### Prefect Automations

```yaml
# Alert on flow failure
trigger:
  type: flow_run_state_change
  from_states: [RUNNING]
  to_states: [FAILED, CRASHED]
action:
  type: send_notification
  block_document_id: <slack-webhook-block-id>
```

### Fly.io Alerts

```bash
# Create alert for machine restarts
fly monitoring alerts create \
  --app banchelabs-gateway \
  --type machine_restart \
  --threshold 3 \
  --window 1h \
  --email alerts@captiona.cc
```

---

## Related Documentation

- [README](./README.md) - Architecture overview
- [Flows](./flows.md) - Flow specifications
- [Infrastructure](./infrastructure.md) - Deployment configuration
- [Modal Integration](./modal-integration.md) - Modal function details
