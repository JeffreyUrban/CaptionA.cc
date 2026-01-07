# Boundary Inference Service Design

## Overview

On-demand GPU inference service for caption boundary detection. The service runs on Modal's serverless GPU infrastructure, processes frame pairs from VP9/WebM chunks, and stores results as immutable per-run SQLite databases in Wasabi.

## Architecture

### Storage Layout

```
Wasabi: videos/{tenant_id}/{video_id}/
├── layout.db                           # OCR visualization, crop config
├── captions.db                         # Boundary annotations
├── boundaries/                         # Inference results (per-run databases)
│   ├── v1_model-abc12345_run-550e8400.db
│   ├── v1_model-def45678_run-7c9e6679.db
│   └── v2_model-def45678_run-9f1a2b3c.db
└── cropped_frames/
    └── v{version}/
        └── modulo_{level}/
            └── chunk_{index}.webm
```

**Filename Convention**: `v{frames_version}_model-{model_hash[:8]}_run-{uuid}.db`

### Design Rationale

#### Per-Run Immutable Databases

Each inference run creates a separate SQLite database containing all results for that run. This approach provides:

**Flexibility**: Keep or delete specific runs independently. Useful for:
- Cleaning up old model versions
- Retaining only the latest N runs
- Archiving runs for specific model versions

**Immutability**: Each run is a complete snapshot with no updates or conflicts. Results never change after creation.

**Comparison**: Download two databases and diff predictions across model versions or frame versions.

**Simplicity**: No unique constraints, no upsert logic, no incremental update complexity.

**Storage**: ~2-5MB per database. Wasabi storage is inexpensive, and most use cases only need to keep recent runs.

#### Combined Forward/Backward Directions

Each row stores both forward (frame1→frame2) and backward (frame2→frame1) inferences:

**Efficiency**: 25k rows per video instead of 50k separate rows.

**Batch processing**: Run both directions together during inference, reducing GPU invocations.

**Query simplicity**: Single row lookup for frame pair gives both directions.

### SQLite Schema

Each boundaries database is self-contained with metadata and results:

```sql
-- Run metadata (self-describing file)
CREATE TABLE run_metadata (
  cropped_frames_version INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  model_checkpoint_path TEXT,
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  total_pairs INTEGER NOT NULL,
  processing_time_seconds REAL
);

-- Frame pair inference results (25k rows for typical video)
CREATE TABLE pair_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  frame1_index INTEGER NOT NULL,
  frame2_index INTEGER NOT NULL,

  -- Forward: frame1 → frame2
  forward_predicted_label TEXT NOT NULL,
  forward_confidence REAL NOT NULL,
  forward_prob_same REAL NOT NULL,
  forward_prob_different REAL NOT NULL,
  forward_prob_empty_empty REAL NOT NULL,
  forward_prob_empty_valid REAL NOT NULL,
  forward_prob_valid_empty REAL NOT NULL,

  -- Backward: frame2 → frame1
  backward_predicted_label TEXT NOT NULL,
  backward_confidence REAL NOT NULL,
  backward_prob_same REAL NOT NULL,
  backward_prob_different REAL NOT NULL,
  backward_prob_empty_empty REAL NOT NULL,
  backward_prob_empty_valid REAL NOT NULL,
  backward_prob_valid_empty REAL NOT NULL,

  processing_time_ms REAL,

  UNIQUE(frame1_index, frame2_index)
);

CREATE INDEX idx_pair_frames ON pair_results(frame1_index, frame2_index);
```

### Supabase Run Registry

Fast lookup registry for completed inference runs. Avoids slow Wasabi file listing (100-500ms) in favor of indexed queries (<10ms).

```sql
-- Completed inference runs (metadata + Wasabi location)
CREATE TABLE captionacc_production.boundary_inference_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT UNIQUE NOT NULL,
  video_id UUID NOT NULL REFERENCES captionacc_production.videos(id),
  tenant_id UUID NOT NULL,

  cropped_frames_version INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  model_checkpoint_path TEXT,

  wasabi_storage_key TEXT NOT NULL,
  file_size_bytes BIGINT,

  total_pairs INTEGER NOT NULL,
  processing_time_seconds REAL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(video_id, cropped_frames_version, model_version)
);

CREATE INDEX idx_inference_runs_video ON boundary_inference_runs(video_id);
CREATE INDEX idx_inference_runs_version_model
  ON boundary_inference_runs(video_id, cropped_frames_version, model_version);
CREATE INDEX idx_inference_runs_model ON boundary_inference_runs(model_version);

-- Active job queue (transient, for monitoring)
CREATE TABLE captionacc_production.boundary_inference_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES captionacc_production.videos(id),
  tenant_id UUID NOT NULL,
  cropped_frames_version INTEGER NOT NULL,
  model_version TEXT NOT NULL,

  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'low')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,

  inference_run_id UUID REFERENCES boundary_inference_runs(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inference_jobs_video ON boundary_inference_jobs(video_id);
CREATE INDEX idx_inference_jobs_status ON boundary_inference_jobs(status);
CREATE INDEX idx_inference_jobs_priority_status
  ON boundary_inference_jobs(priority, status);
```

**Registry benefits**:
- Fast duplicate detection (check if run exists before starting)
- Cross-video queries (find all videos using specific model version)
- Analytics (aggregate processing times, count runs per model)
- Audit trail with timestamps

## GPU Infrastructure

### Modal Serverless

The inference service runs on [Modal](https://modal.com), a serverless GPU platform:

**Cold starts**: <1 second with container caching
**GPU options**: A10, A100, H100 (using A10G: ~$1.10/hr)
**Billing**: Only charged when container is running
**Container idle timeout**: 5 minutes (keeps warm for follow-up requests)
**Auto-shutdown**: No charges after idle period

**Estimated costs**:
- Single video (50k inferences): ~$0.83 (40 min inference + 5 min warm time)
- Monthly (100 annotation jobs + 2 model updates): ~$172

**Rationale**: True pay-per-use model eliminates idle GPU costs. Fast cold starts enable on-demand execution without keeping instances running.

### Priority Queue

**High priority**: Annotation-driven inference (user waiting)
**Low priority**: Model update reprocessing (batch, non-urgent)

Low priority jobs yield to high priority requests. Modal's queue system handles scheduling automatically.

## Frame Access

Frames are stored as VP9/WebM chunks in Wasabi at hierarchical modulo levels. The inference service decodes chunks using OpenCV:

```python
import cv2
import requests
import tempfile

def extract_frame_from_chunk(
    signed_url: str,
    frame_index: int,
    modulo: int
) -> np.ndarray:
    """Extract frame from VP9 chunk."""
    # Download chunk
    response = requests.get(signed_url)
    with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as f:
        f.write(response.content)
        temp_path = f.name

    # Calculate position in chunk (non-duplicating strategy)
    frame_offset = calculate_frame_offset(frame_index, modulo)

    # Extract using OpenCV
    cap = cv2.VideoCapture(temp_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_offset)
    ret, frame = cap.read()
    cap.release()
    os.unlink(temp_path)

    return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
```

**Optimization strategy**:
- Determine required chunks upfront from frame pairs
- Download chunks in parallel (batch signed URL requests)
- Process all frame pairs, then cleanup
- No persistent caching needed within a job

## Usage Patterns

### Check for Existing Run

```python
from services.orchestrator.supabase_client import BoundaryInferenceRunRepository

repo = BoundaryInferenceRunRepository()
existing = repo.get_existing_run(
    video_id=video_id,
    cropped_frames_version=1,
    model_version="abc123def456..."
)

if existing:
    print(f"Run exists: {existing['wasabi_storage_key']}")
    print(f"Completed: {existing['completed_at']}")
    return  # Skip inference
```

### Run Inference

```python
def run_inference(
    video_id: str,
    tenant_id: str,
    cropped_frames_version: int,
    model_version: str,
    run_id: str
):
    """Execute inference and create immutable results database."""

    # Generate frame pairs (sorted: frame1 < frame2)
    pairs = generate_frame_pairs(video_id, cropped_frames_version)

    # Run inference (batched, forward + backward together)
    results = batch_inference_bidirectional(pairs)

    # Create SQLite database
    db_filename = f"v{cropped_frames_version}_model-{model_version[:8]}_run-{run_id}.db"
    db_path = create_boundaries_db(db_filename, results)

    # Upload to Wasabi
    wasabi_key = f"videos/{tenant_id}/{video_id}/boundaries/{db_filename}"
    upload_boundaries_db(db_path, wasabi_key)

    # Register in Supabase
    repo.register_run({
        'run_id': run_id,
        'video_id': video_id,
        'tenant_id': tenant_id,
        'cropped_frames_version': cropped_frames_version,
        'model_version': model_version,
        'wasabi_storage_key': wasabi_key,
        'file_size_bytes': db_path.stat().st_size,
        'total_pairs': len(results),
        'processing_time_seconds': processing_time,
        'started_at': start_time,
        'completed_at': datetime.now(),
    })
```

### Query Results

```python
# Download specific run
db_path = download_boundaries_db(
    tenant_id=tenant_id,
    video_id=video_id,
    filename="v1_model-abc12345_run-550e8400.db"
)

# Query results
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get metadata
cursor.execute("SELECT * FROM run_metadata")
metadata = cursor.fetchone()

# Get predictions for frame pair
cursor.execute("""
    SELECT forward_predicted_label, forward_confidence,
           backward_predicted_label, backward_confidence
    FROM pair_results
    WHERE frame1_index = ? AND frame2_index = ?
""", (100, 101))
result = cursor.fetchone()

conn.close()
```

### Find Videos Needing Model Update

```python
# Get all videos with old model version
runs_with_old_model = repo.get_runs_for_model("old_model_hash")

# Find videos missing new model
all_videos = get_all_videos()
videos_needing_update = [
    v for v in all_videos
    if not repo.get_existing_run(v.id, v.version, "new_model_hash")
]
```

### Storage Management

```python
# Keep only latest run per model version
def cleanup_old_runs(video_id: str, keep_latest_per_model: bool = True):
    runs = repo.get_runs_for_video(video_id)

    if keep_latest_per_model:
        # Group by model version, keep latest
        by_model = defaultdict(list)
        for run in runs:
            by_model[run['model_version']].append(run)

        for model_runs in by_model.values():
            sorted_runs = sorted(model_runs, key=lambda r: r['completed_at'])
            for old_run in sorted_runs[:-1]:
                delete_run(old_run['id'])

# Archive runs older than 30 days
def archive_old_runs(video_id: str, days: int = 30):
    cutoff = datetime.now() - timedelta(days=days)
    old_runs = [r for r in repo.get_runs_for_video(video_id)
                if r['completed_at'] < cutoff]

    for run in old_runs:
        archive_to_glacier(run['wasabi_storage_key'])
        repo.mark_archived(run['id'])
```

### Compare Model Versions

```python
# Download two runs
run1_db = download_boundaries_db(tenant, video, "v1_model-abc123_run-x.db")
run2_db = download_boundaries_db(tenant, video, "v1_model-def456_run-y.db")

# Compare predictions
differences = compare_predictions(run1_db, run2_db)
print(f"Changed predictions: {len(differences)}")
for diff in differences[:10]:
    print(f"Pair ({diff.frame1}, {diff.frame2}): {diff.old_label} → {diff.new_label}")
```

## Triggers

### High Priority: Annotation Workflow

When layout annotation is approved and cropped frames are regenerated:

1. Prefect `crop_frames_to_webm_flow` completes
2. Webhook triggers `boundary_inference_flow`
3. Flow checks Supabase for existing run
4. If not found, submits high-priority job to Modal
5. Modal container starts (<1s cold start)
6. Inference completes (~40 minutes)
7. Results uploaded to Wasabi, registered in Supabase
8. Webhook notifies completion

### Low Priority: Model Updates

When a new model version is released:

1. Admin triggers batch reprocessing
2. For each video: check if run exists for new model
3. Submit low-priority jobs to Modal queue
4. Jobs execute when no high-priority work pending
5. Low-priority jobs yield if high-priority request arrives

## Performance Considerations

### Benchmarking Required

The time estimates in this document are preliminary. Before production deployment:

- Benchmark single-video inference time on Modal A10G
- Measure actual cost per video (track Modal billing)
- Test concurrent job handling (multiple annotation jobs + model update)
- Benchmark chunk download parallelism

**Performance targets**:
- Cold start: <5s
- Single video (50k inferences): <10 minutes
- Cost per video: <$1.00
- Queue wait (high priority): <30s

### Scaling Options

If single-instance performance is insufficient:

**Parallel instances**: Split video into chunks, process on multiple GPUs
- 4x parallelism: 40 min → 10 min
- Same total cost (4x instances × 0.25x time)
- Adds complexity (coordinate/merge results)

**Recommendation**: Start with single instance, optimize if needed.

### Future Optimizations

**Skip confirmed annotation interiors**: Only infer pairs at boundaries with non-confirmed neighbors. Could save 30-50% of inferences.

**Trade-off**: Reduces model observability (no ground truth for confirmed interiors). Start with full inference to collect performance metrics, optimize later if needed.

## Implementation Files

### New Files

1. `data-pipelines/caption_boundaries/src/caption_boundaries/inference/service.py`
   - Modal inference functions (GPU workload)

2. `data-pipelines/caption_boundaries/src/caption_boundaries/inference/frame_extractor.py`
   - WebM chunk decoding (ported from web client)

3. `data-pipelines/caption_boundaries/src/caption_boundaries/inference/boundaries_db.py`
   - Boundaries DB creation, read/write operations, Wasabi upload/download

4. `data-pipelines/caption_boundaries/src/caption_boundaries/database/boundaries_schema.sql`
   - SQLite schema for boundaries DB (per-run)

5. `data-pipelines/caption_boundaries/scripts/deploy_inference.py`
   - Deploy service to Modal

6. `supabase/migrations/20260107000000_boundary_inference_tables.sql`
   - Schema for `boundary_inference_runs` (completed runs registry)
   - Schema for `boundary_inference_jobs` (active job queue)

7. `services/orchestrator/flows/boundary_inference.py`
   - Prefect flow to trigger Modal function

### Modified Files

1. `services/orchestrator/supabase_client.py`
   - Add `BoundaryInferenceRunRepository` for run tracking
   - Add `BoundaryInferenceJobRepository` for job status tracking

2. `services/orchestrator/wasabi_client.py`
   - Add methods: `upload_boundaries_db()`, `download_boundaries_db()`

3. `services/orchestrator/flows/crop_frames_to_webm.py`
   - Trigger inference on completion

## Implementation Phases

### Phase 1: Modal Setup & Frame Extraction
- Set up Modal account and deploy test function
- Port WebM chunk decoding from TypeScript to Python
- Test frame extraction with real Wasabi chunks
- Verify cold start performance

### Phase 2: Database Schema & Repository
- Create SQLite schema for boundaries DB
- Create Supabase migrations for run tracking
- Implement `boundaries_db.py` module
- Implement `BoundaryInferenceRunRepository`
- Test DB creation and Wasabi operations

### Phase 3: Full Service Implementation
- Implement complete Modal inference function
- Integrate with `BoundaryPredictor`
- Add error handling and retry logic
- Test on full video

### Phase 4: Prefect Integration
- Create boundary inference Prefect flow
- Update webhook to trigger inference
- Test end-to-end flow

### Phase 5: Priority Queue & Optimization
- Implement priority handling
- Test concurrent jobs
- Optimize batch size and chunk prefetching
- Add monitoring

### Phase 6: Testing & Documentation
- Integration tests with multiple videos
- Load testing (concurrent jobs)
- Test run registry (duplicate detection, cross-video queries)
- Write deployment guide
