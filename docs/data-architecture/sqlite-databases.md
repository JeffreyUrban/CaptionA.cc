# SQLite Database Reference

CaptionA.cc uses a split database architecture where each video has multiple SQLite databases stored in Wasabi S3. Databases are separated into **client-facing** (synced via CR-SQLite) and **server-only** (internal processing).

## Architecture Overview

```
{tenant_id}/{video_id}/
│
├── Client-Facing (gzip compressed, synced via CR-SQLite)
│   ├── layout.db.gz        # Boxes, user annotations, bounds
│   └── captions.db.gz      # Caption boundaries and text
│
├── Server-Only (internal, never sent to client)
│   ├── ocr-server.db       # Full OCR results, model predictions
│   └── layout-server.db    # ML model blob, analysis parameters
│
└── Static Assets (read-only, accessed via presigned URLs)
    └── full_frames/        # Individual .jpg files
        ├── frame_000000.jpg
        └── ...
```

## Client Access Pattern

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Client Database Access                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Browser                         Wasabi S3                    API       │
│   ───────                         ─────────                    ───       │
│                                                                          │
│   1. Request presigned URL ─────────────────────────────────► │         │
│                                                                │         │
│   2. ◄─────────────────────────────────────────────────────── URL       │
│                                                                          │
│   3. Download .db.gz file ──────────► layout.db.gz (compressed)         │
│      (direct from Wasabi)              (no server load)                 │
│                                                                          │
│   4. Decompress (gzip) and load into wa-sqlite + CR-SQLite              │
│      Make local edits (instant)                                         │
│                                                                          │
│   5. Sync changes via WebSocket ────────────────────────────► │         │
│      (only changed rows)                                       │         │
│                                                                │         │
│   6. ◄─────────────────────────────────────────────────────── ack       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

Key: Server only involved for presigned URLs and sync.
     Reads go directly to Wasabi - no server load.
     Files stored gzip compressed (~60-70% size reduction).
```

## Database Summary

| Database | Visibility | Sync | Size (raw) | Size (gzip) | Purpose |
|----------|------------|------|------------|-------------|---------|
| `layout.db.gz` | Client | CR-SQLite (bidirectional) | 0.5-5 MB | 0.2-2 MB | Boxes, annotations, bounds |
| `captions.db.gz` | Client | CR-SQLite (client→server) | 0.1-2 MB | 0.04-0.8 MB | Caption boundaries, text |
| `ocr-server.db` | Server-only | None | 0.5-5 MB | N/A | Full OCR results |
| `layout-server.db` | Server-only | None | 0.1-20 MB | N/A | ML model, analysis params |
| `full_frames/*.jpg` | Client (read-only) | None | 15-70 MB | N/A | Video frames at 0.1Hz |

---

# Client-Facing Databases

These databases are downloaded directly by the client from Wasabi and synced using CR-SQLite.

## layout.db

Client-facing layout data: box positions, user annotations, server-pushed predictions, and crop bounds.

**Sync:** Bidirectional via CR-SQLite
- **Fixed (from OCR):** Box positions, text
- **Client writes:** Box annotations (in/out/clear)
- **Server writes:** Box predictions, confidence, crop bounds, anchor, vertical center

### Tables

#### `database_metadata`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Single row (id=1) |
| `schema_version` | INTEGER NOT NULL | Current schema version |
| `created_at` | TEXT NOT NULL | Database creation timestamp |

#### `boxes`

OCR box data with user annotations and server predictions.

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `id` | INTEGER PK | — | Auto-increment ID |
| `frame_index` | INTEGER NOT NULL | Fixed | Frame this box belongs to |
| `box_index` | INTEGER NOT NULL | Fixed | Box position in frame |
| `bbox_left` | REAL NOT NULL | Fixed | Left boundary (0-1) |
| `bbox_top` | REAL NOT NULL | Fixed | Top boundary (0-1) |
| `bbox_right` | REAL NOT NULL | Fixed | Right boundary (0-1) |
| `bbox_bottom` | REAL NOT NULL | Fixed | Bottom boundary (0-1) |
| `text` | TEXT | Fixed | OCR detected text |
| `label` | TEXT | **Client** | User annotation: 'in', 'out', 'clear', NULL |
| `label_updated_at` | TEXT | Client | Last annotation timestamp |
| `predicted_label` | TEXT | **Server** | Model prediction: 'in', 'out' |
| `predicted_confidence` | REAL | Server | Model confidence (0-1) |

**Constraints:** `UNIQUE(frame_index, box_index)`

#### `layout_config`

Crop bounds and anchor configuration. Single row, server-populated.

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `id` | INTEGER PK | — | Single row (id=1) |
| `frame_width` | INTEGER | Fixed | Video frame width |
| `frame_height` | INTEGER | Fixed | Video frame height |
| `crop_left` | REAL | **Server** | Left crop boundary (0-1) |
| `crop_top` | REAL | Server | Top crop boundary (0-1) |
| `crop_right` | REAL | Server | Right crop boundary (0-1) |
| `crop_bottom` | REAL | Server | Bottom crop boundary (0-1) |
| `anchor_type` | TEXT | Server | 'left', 'center', 'right' |
| `anchor_position` | REAL | Server | Anchor position (0-1) |
| `vertical_center` | REAL | Server | Vertical center (0-1) |
| `updated_at` | TEXT | Server | Last update timestamp |

#### `preferences`

User workflow preferences.

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `id` | INTEGER PK | — | Single row (id=1) |
| `layout_approved` | INTEGER | **Client** | 0=not approved, 1=approved |

**CR-SQLite Setup:**
```sql
SELECT crsql_as_crr('boxes');
SELECT crsql_as_crr('layout_config');
SELECT crsql_as_crr('preferences');
```

---

## captions.db

Caption boundaries, text, and annotation metadata.

**Sync:** Client → Server via CR-SQLite (during client workflow)
- **Fixed:** Schema, OCR-derived data, images
- **Client writes:** Boundaries (confirmed), text, text notes, pending status (disable)
- **Server writes (outside workflow):** Boundaries (predicted/gap/issue), pending status, OCR text

**Workflow Lock:** Client is read-only during server processing. Server is read-only during client editing.

**Schema Version:** 2

### Tables

#### `database_metadata`

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT PK | Metadata key |
| `value` | TEXT | Metadata value |

Keys: `schema_version`, `created_at`, `migrated_at`

#### `captions`

Primary caption storage.

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `id` | INTEGER PK | — | Auto-increment ID |
| **Boundaries** | | | |
| `start_frame_index` | INTEGER NOT NULL | Client/Server | Caption start frame |
| `end_frame_index` | INTEGER NOT NULL | Client/Server | Caption end frame |
| `boundary_state` | TEXT NOT NULL | Client/Server | 'predicted', 'confirmed', 'gap', 'issue' |
| `boundary_pending` | INTEGER NOT NULL | Client/Server | Needs review flag (1=pending) |
| `boundary_updated_at` | TEXT NOT NULL | Auto | Last boundary update |
| **Text Content** | | | |
| `text` | TEXT | Client/Server | Caption text |
| `text_pending` | INTEGER NOT NULL | Client/Server | Needs review flag |
| `text_status` | TEXT | **Client** | 'valid_caption', 'ocr_error', 'partial_caption', etc. |
| `text_notes` | TEXT | **Client** | Annotator notes |
| `text_ocr_combined` | TEXT | **Server** | Cached OCR result |
| `text_updated_at` | TEXT | Auto | Last text update |
| **Processing** | | | |
| `image_needs_regen` | INTEGER NOT NULL | Server | Regeneration flag |
| `median_ocr_status` | TEXT NOT NULL | Server | 'queued', 'processing', 'completed', 'error' |
| `median_ocr_error` | TEXT | Server | Error message if failed |
| `median_ocr_processed_at` | TEXT | Server | Processing timestamp |
| `created_at` | TEXT NOT NULL | Auto | Record creation timestamp |

### Indexes

```sql
CREATE INDEX idx_captions_frame_range ON captions(start_frame_index, end_frame_index);
CREATE INDEX idx_captions_boundary_pending ON captions(boundary_pending) WHERE boundary_pending = 1;
CREATE INDEX idx_captions_text_pending ON captions(text_pending) WHERE text_pending = 1;
```

**CR-SQLite Setup:**
```sql
SELECT crsql_as_crr('captions');
```

---

# Server-Only Databases

These databases contain proprietary ML data and full processing results. Clients never access these directly.

## ocr-server.db

Full OCR detection results from Google Vision API. Contains all metadata needed for server-side processing.

### Tables

#### `database_metadata`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Single row (id=1) |
| `schema_version` | INTEGER NOT NULL | Current schema version |
| `created_at` | TEXT NOT NULL | Database creation timestamp |
| `migrated_at` | TEXT | Last migration timestamp |

#### `full_frame_ocr`

Complete OCR results with confidence scores and positioning.

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
| `created_at` | TEXT NOT NULL | Record creation timestamp |

**Constraints:** `UNIQUE(frame_index, box_index)`

---

## layout-server.db

ML models, analysis parameters, and internal processing state. Never exposed to clients.

### Tables

#### `database_metadata`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Single row (id=1) |
| `schema_version` | INTEGER NOT NULL | Current schema version |
| `created_at` | TEXT NOT NULL | Database creation timestamp |
| `migrated_at` | TEXT | Last migration timestamp |

#### `box_classification_model`

Trained Naive Bayes model for box classification (proprietary).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Single row (id=1) |
| `model_data` | BLOB | Serialized model parameters (111 Gaussian params) |
| `model_version` | TEXT | Version identifier |
| `trained_at` | TEXT | Training timestamp |

#### `analysis_results`

Layout analysis parameters computed by ML pipeline.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Single row (id=1) |
| `vertical_position` | INTEGER | Mode vertical center position |
| `vertical_std` | REAL | Bayesian prior std dev |
| `box_height` | INTEGER | Mode box height |
| `box_height_std` | REAL | Box height std dev |
| `top_edge_std` | REAL | Top edge std dev |
| `bottom_edge_std` | REAL | Bottom edge std dev |
| `horizontal_std_slope` | REAL | Horizontal std slope |
| `horizontal_std_intercept` | REAL | Horizontal std intercept |
| `analysis_model_version` | TEXT | Analysis model version |
| `ocr_visualization_image` | BLOB | PNG visualization (debug) |
| `computed_at` | TEXT | Computation timestamp |

---

# Static Assets

## full_frames/ (Replaces video.db)

Individual JPEG frames extracted at 0.1Hz (1 frame per 10 seconds). Stored as separate files for direct access via presigned URLs.

**Structure:**
```
full_frames/
├── frame_000000.jpg
├── frame_000001.jpg
├── frame_000002.jpg
└── ...
```

**Access:** Client requests presigned URLs via `GET /videos/{id}/image-urls?frames=0,1,2`

**Metadata:** Video duration, frame count, and hash stored in Supabase `videos` table.

---

# CR-SQLite Sync Protocol

## Workflow Locks

Prevents concurrent writes between client and server:

```
┌──────────────────┐                      ┌─────────────────────┐
│  CLIENT_ACTIVE   │ ───server starts───► │  SERVER_PROCESSING  │
│                  │ ◄───server done───── │                     │
└──────────────────┘                      └─────────────────────┘

CLIENT_ACTIVE:      Client can edit, sync enabled
SERVER_PROCESSING:  Client read-only, sync paused
```

Lock state stored in Supabase `videos.workflow_lock` column. Client notified via WebSocket.

## Change Tracking

CR-SQLite provides automatic change tracking via the `crsql_changes` virtual table:

```sql
-- Get changes since last sync
SELECT "table", "pk", "cid", "val", "col_version", "db_version"
FROM crsql_changes
WHERE db_version > ?;

-- Apply remote changes
INSERT INTO crsql_changes ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq")
VALUES (...);
```

## Sync Flow

```
Client                                    Server
──────                                    ──────

1. GET presigned URL for layout.db / captions.db
2. Download directly from Wasabi (no server load)
3. Load wa-sqlite + CR-SQLite extension
   last_sync_version = db_version

4. User makes edit (instant, local)

5. Query changes:
   SELECT * FROM crsql_changes WHERE db_version > last_sync_version

6. WebSocket: { type: "sync", db: "captions", changes: [...] }
                                          ───────────────────►
                                                              Validate
                                                              Apply changes
                                                              Upload to Wasabi
                                          ◄───────────────────
   { type: "ack", version: 43 }

7. last_sync_version = 43
```

---

# Specialized Databases

## Boundaries Inference Database

Per-run, immutable database storing ML inference results. Internal to data pipeline.

**Location:** Data pipeline outputs
**Naming:** `v{frames_version}_model-{model_hash[:8]}_run-{uuid}.db`

### Tables

#### `run_metadata`

| Column | Type | Description |
|--------|------|-------------|
| `run_id` | TEXT PK | Unique run identifier |
| `cropped_frames_version` | INTEGER NOT NULL | Input frames version |
| `model_version` | TEXT NOT NULL | Model identifier |
| `model_checkpoint_path` | TEXT | Checkpoint location |
| `started_at` | TEXT NOT NULL | Run start timestamp |
| `completed_at` | TEXT NOT NULL | Run completion timestamp |
| `total_pairs` | INTEGER NOT NULL | Frame pairs processed (~25k typical) |
| `processing_time_seconds` | REAL | Total processing time |

#### `pair_results`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment ID |
| `frame1_index` | INTEGER NOT NULL | First frame in pair |
| `frame2_index` | INTEGER NOT NULL | Second frame in pair |
| `forward_predicted_label` | TEXT NOT NULL | 'same', 'different', 'empty_empty', etc. |
| `forward_confidence` | REAL NOT NULL | Prediction confidence |
| `forward_prob_same` | REAL NOT NULL | Probability of 'same' |
| `forward_prob_different` | REAL NOT NULL | Probability of 'different' |
| `backward_predicted_label` | TEXT NOT NULL | Reverse prediction |
| `backward_confidence` | REAL NOT NULL | Reverse confidence |
| `processing_time_ms` | REAL | Per-pair processing time |

---

# Migration Notes

## video.db → full_frames/

The `video.db` database (JPEG blobs in SQLite) is replaced with individual .jpg files:

1. Extract frames from `video.db.full_frames` table to `full_frames/*.jpg`
2. Move video metadata to Supabase `videos` table
3. Delete `video.db`

## fullOCR.db → ocr-server.db + layout.db

Original `fullOCR.db` is split:
- Full OCR data stays in `ocr-server.db` (server-only)
- Box positions/text copied to `layout.db` `boxes` table (client-synced)

## layout.db Decomposition

Original `layout.db` split into:
- `layout-server.db`: ML model blob, analysis parameters (server-only)
- `layout.db`: Boxes, annotations, bounds, preferences (client-synced)

---

# Related Documentation

- [Sync Protocol Reference](./sync-protocol.md) - WebSocket sync details
- [Wasabi Storage Reference](./wasabi-storage.md) - Bucket configuration, presigned URLs
- [Supabase Schema Reference](./supabase-schema.md) - PostgreSQL tables, RLS policies
