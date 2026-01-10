# SQLite Database Reference

CaptionA.cc uses a split database architecture where each video has multiple SQLite databases stored in Wasabi S3. This design optimizes for update frequency and minimizes data transfer.

## Split Database Architecture

```
{tenant_id}/{video_id}/
├── video.db      # Immutable - frames
├── fullOCR.db    # Occasional - OCR results
├── layout.db     # Frequent - layout annotations
└── captions.db   # Frequent - caption data
```

| Database | Update Frequency | Typical Size | Purpose |
|----------|------------------|--------------|---------|
| `video.db` | Once or Rarely   | 15-70 MB | Full-resolution frames at 0.1Hz |
| `fullOCR.db` | Occasional       | 0.5-5 MB | OCR detection results |
| `layout.db` | Frequent         | 0.05-20 MB | Layout annotations, trained model |
| `captions.db` | Frequent         | 0.1-2 MB | Caption boundaries and text |

## video.db

Stores full-resolution video frames extracted at 0.1Hz (1 frame per 10 seconds).

### Tables

#### `metadata` <- Added table

| Column | Type | Description   |
|--------|------|---------------|
| `width` | INTEGER | Video width   |
| `height` | INTEGER | Video height  |


#### `full_frames` <- Some columns removed

| Column | Type | Description |
|--------|------|-------------|
| `frame_index` | INTEGER PK | Frame position in video |
| `image_data` | BLOB NOT NULL | JPEG-compressed image |
| `file_size` | INTEGER NOT NULL | JPEG blob size in bytes |
| `created_at` | TEXT NOT NULL | ISO 8601 timestamp |

### Usage

- **Update pattern**: Set at video ingestion (maybe frames added later)
- **Frame rate**: 0.1Hz (6 frames per minute)
- **Compression**: JPEG binary blobs

---

## fullOCR.db (Occasional Updates)

Stores OCR detection results from EasyOCR or similar engines.

### Tables

#### `full_frame_ocr`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment ID |
| `frame_index` | INTEGER NOT NULL | Frame this detection belongs to |
| `box_index` | INTEGER NOT NULL | Position in OCR results for frame |
| `text` | TEXT NOT NULL | Detected text content |
| `confidence` | REAL NOT NULL | OCR confidence score (0-1) |
| `x` | REAL NOT NULL | Left position (0-1, fractional) |
| `y` | REAL NOT NULL | Bottom position (0-1, fractional) |
| `width` | REAL NOT NULL | Box width (0-1, fractional) |
| `height` | REAL NOT NULL | Box height (0-1, fractional) |
| `timestamp_seconds` | REAL | Video timestamp |
| `predicted_label` | TEXT | Model prediction ('in' or 'out') |
| `predicted_confidence` | REAL | Model confidence |
| `model_version` | TEXT | Model version used |
| `predicted_at` | TEXT | Prediction timestamp |
| `created_at` | TEXT NOT NULL | Record creation timestamp |

**Constraints**: `UNIQUE(frame_index, box_index)`

### Usage

- **Update pattern**: Only when OCR is re-run (~1-5% of videos at a time)

---

## layout.db (Frequent Updates)

Stores layout annotations, crop bounds, and the trained classification model.

### Tables

#### `full_frame_box_labels`

User annotations marking OCR boxes as inside/outside caption region.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment ID |
| `frame_index` | INTEGER NOT NULL | Frame this label belongs to |
| `box_index` | INTEGER NOT NULL | OCR box being labeled |
| `label` | TEXT NOT NULL | 'in' or 'out' |
| `created_at` | TEXT NOT NULL | Label creation timestamp |

#### `box_classification_model`

Trained Naive Bayes model (111 Gaussian parameters).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Single row (id=1) |
| `model_data` | BLOB | Serialized model parameters |
| `model_version` | TEXT | Version identifier |
| `trained_at` | TEXT | Training timestamp |

#### `video_layout_config`

Crop bounds and layout configuration.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Single row (id=1) |
| `width` | INTEGER | Video width                          |
| `height` | INTEGER | Video height                         |
| `crop_left` | INTEGER NOT NULL | Left crop boundary |
| `crop_top` | INTEGER NOT NULL | Top crop boundary |
| `crop_right` | INTEGER NOT NULL | Right crop boundary |
| `crop_bottom` | INTEGER NOT NULL | Bottom crop boundary |
| `selection_left/top/right/bottom` | INTEGER | User selection rectangle |
| `vertical_position` | INTEGER | Mode vertical center position |
| `vertical_std` | REAL | Bayesian prior std dev |
| `box_height` | INTEGER | Mode box height |
| `box_height_std` | REAL | Box height std dev |
| `anchor_type` | TEXT | 'left', 'center', or 'right' |
| `anchor_position` | INTEGER | Anchor pixel position |
| `top_edge_std/bottom_edge_std` | REAL | Edge std devs |
| `horizontal_std_slope/intercept` | REAL | Horizontal std parameters |
| `crop_bounds_version` | INTEGER NOT NULL | Version for cache invalidation |
| `analysis_model_version` | TEXT | Analysis model version |
| `ocr_visualization_image` | BLOB | PNG visualization |
| `updated_at` | TEXT NOT NULL | Last update timestamp |

---

## captions.db (Frequent Updates)

Main annotation database storing caption boundaries, text, and metadata.

**Schema Version**: 2

### Tables

#### `captions`

Primary annotation storage.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment ID |
| `start_frame_index` | INTEGER NOT NULL | Caption start frame |
| `end_frame_index` | INTEGER NOT NULL | Caption end frame |
| **Boundary Annotation** | | |
| `boundary_state` | TEXT NOT NULL | 'predicted', 'confirmed', 'gap', 'issue' |
| `boundary_pending` | INTEGER NOT NULL | Needs review flag |
| `boundary_updated_at` | TEXT NOT NULL | Last boundary update |
| **Text Annotation** | | |
| `text` | TEXT | Caption text (NULL = not annotated) |
| `text_pending` | INTEGER NOT NULL | Needs review flag |
| `text_status` | TEXT | 'valid_caption', 'ocr_error', 'partial_caption', etc. |
| `text_notes` | TEXT | Annotator notes |
| `text_ocr_combined` | TEXT | Cached OCR result |
| `text_updated_at` | TEXT | Last text update |
| **Processing State** | | |
| `image_needs_regen` | INTEGER NOT NULL | Regeneration flag |
| `median_ocr_status` | TEXT NOT NULL | 'pending', 'queued', 'processing', 'complete', 'error' |
| `median_ocr_error` | TEXT | Error message if failed |
| `median_ocr_processed_at` | TEXT | Processing timestamp |
| `created_at` | TEXT NOT NULL | Record creation timestamp |

#### `database_metadata`

Schema versioning.

| Column | Type | Description |
|--------|------|-------------|
| `schema_version` | INTEGER NOT NULL | Current schema version |
| `created_at` | TEXT NOT NULL | Database creation timestamp |
| `migrated_at` | TEXT | Last migration timestamp |

### Indexes

```sql
-- Fast frame range lookups
CREATE INDEX idx_captions_frame_range ON captions(start_frame_index, end_frame_index);

-- Granular lookups (by 100s)
CREATE INDEX idx_captions_granularity ON captions(start_frame_index / 100);

-- Finding items needing review
CREATE INDEX idx_captions_boundary_pending ON captions(boundary_pending) WHERE boundary_pending = 1;
CREATE INDEX idx_captions_text_pending ON captions(text_pending) WHERE text_pending = 1;
CREATE INDEX idx_captions_text_null ON captions(id) WHERE text IS NULL;
```

---

## Specialized Databases

### Boundaries Inference Database

Per-run, immutable database storing ML inference results.

**Location**: Various (data pipeline outputs)
**Naming**: `v{frames_version}_model-{model_hash[:8]}_run-{uuid}.db`

#### `run_metadata`

| Column | Type | Description |
|--------|------|-------------|
| `cropped_frames_version` | INTEGER NOT NULL | Input frames version |
| `model_version` | TEXT NOT NULL | Model identifier |
| `model_checkpoint_path` | TEXT | Checkpoint location |
| `run_id` | TEXT PK | Unique run identifier |
| `started_at/completed_at` | TEXT NOT NULL | Run timestamps |
| `total_pairs` | INTEGER NOT NULL | Frame pairs processed (~25k typical) |
| `processing_time_seconds` | REAL | Total processing time |

#### `pair_results`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment ID |
| `frame1_index/frame2_index` | INTEGER NOT NULL | Frame pair |
| `forward_predicted_label` | TEXT NOT NULL | 'same', 'different', 'empty_empty', 'empty_valid', 'valid_empty' |
| `forward_confidence` | REAL NOT NULL | Prediction confidence |
| `forward_prob_*` | REAL NOT NULL | Class probabilities |
| `backward_*` | | Same fields for reverse direction |
| `processing_time_ms` | REAL | Per-pair processing time |

---

## Database Access

### TypeScript (Web App)

Location: `apps/captionacc-web/app/utils/database.ts`

```typescript
// Read-only access
const db = await getCaptionDb(videoId);

// Read-write with migration
const db = await getWritableCaptionDb(videoId);

// Create if missing
const db = await getOrCreateCaptionDb(videoId);

// Transaction wrapper
const result = await withDatabase(videoId, async (db) => {
  // ... operations
}, { readonly: false });
```

### Python (Data Pipelines)

```python
# Full frames
from full_frames.database import write_frames_to_database

# OCR
from ocr_utils.database import write_ocr_result_to_database, load_ocr_for_frame

# Generic frame storage
from frames_db.storage import write_frame_to_db, write_frames_batch
```

---

## Related Files

**Schemas**:
- `data-pipelines/caption_boundaries/src/caption_boundaries/database/boundaries_schema.sql`
- `data-pipelines/caption_boundaries/src/caption_boundaries/database/schema.py`

**Access Layers**:
- `apps/captionacc-web/app/utils/database.ts`
- `apps/captionacc-web/app/utils/video-paths.ts`
- `apps/captionacc-web/app/db/migrate.ts`
