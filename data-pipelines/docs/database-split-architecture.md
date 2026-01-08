# Split Database Architecture

## Overview

Video databases are split into 6 separate SQLite files based on update frequency patterns to optimize DVC versioning efficiency.

## Database Files

### DVC-Tracked Databases

#### video.db (Immutable)
**Tables:**
- `full_frames` - Raw frame images extracted from video
- `video_metadata` - Video information (path, duration, hash)

**Update Pattern:** Set once at video ingestion, never modified
**Size:** ~15-70 MB per video
**DVC Impact:** Uploaded once, never re-versioned

#### fullOCR.db (Occasional)
**Tables:**
- `full_frame_ocr` - OCR detection results (text, confidence, bounding boxes)

**Update Pattern:** Only when OCR is re-run (algorithm improvements, quality fixes)
**Size:** ~0.5-5 MB per video
**DVC Impact:** Re-versioned only when OCR updated (~1-5% of videos at a time)

#### cropping.db (Rare)
**Tables:**
- `cropped_frames` - Cropped frame images based on detected caption region
- `video_layout_config` - Crop bounds configuration

**Update Pattern:** When crop algorithm or layout configuration changes
**Size:** ~90-420 MB per video
**DVC Impact:** Re-versioned when crops regenerated (affects all videos but infrequent)

#### layout.db (Frequent)
**Tables:**
- `full_frame_box_labels` - User annotations marking OCR boxes as "in" or "out" of caption region
- `box_classification_model` - Trained Naive Bayes model (111 Gaussian parameters)

**Update Pattern:** During active layout annotation work
**Size:** ~0.05-20 MB per video (depends on annotation density and model)
**DVC Impact:** Re-versioned with each annotation session (~68 KB for labels, ~15 MB with model)

#### captions.db (Frequent)
**Tables:**
- `captions` - Caption boundary detection and text content

**Update Pattern:** During caption annotation and editing
**Size:** ~0.1-2 MB per video
**DVC Impact:** Re-versioned with each caption editing session (~248 KB typical)

### Local-Only Database (Not DVC-Tracked)

#### state.db (Ephemeral)
**Tables:**
- `video_preferences` - User UI preferences
- `processing_status` - Workflow state tracking
- `duplicate_resolution` - Temporary conflict resolution
- `database_metadata` - Database version info

**Update Pattern:** Frequently, user-specific state
**Size:** <100 KB
**DVC Impact:** None (local only, in .gitignore)

## Schema Relationships

### Cross-Database References

Applications must ATTACH databases to query across them:

```sql
-- Open primary database
ATTACH DATABASE 'video.db' AS video;
ATTACH DATABASE 'fullOCR.db' AS ocr;
ATTACH DATABASE 'cropping.db' AS cropping;
ATTACH DATABASE 'layout.db' AS layout;
ATTACH DATABASE 'captions.db' AS captions;
ATTACH DATABASE 'state.db' AS meta;

-- Query across databases
SELECT
    v.frame_index,
    v.image_data,
    o.text,
    o.confidence
FROM video.full_frames v
LEFT JOIN ocr.full_frame_ocr o ON v.frame_index = o.frame_index
WHERE o.confidence > 0.8;
```

### Foreign Key Relationships

**Key Relationships:**
- `full_frame_ocr.frame_index` → `full_frames.frame_index`
- `cropped_frames.frame_index` → `full_frames.frame_index` (implicit)
- `full_frame_box_labels.frame_index` → `full_frames.frame_index`
- `captions` may reference frame ranges

**Note:** SQLite doesn't enforce foreign keys across attached databases. Applications must maintain referential integrity.

## Workflow Patterns

### Pattern 1: Layout Annotation Workflow

**Steps:**
1. Load video.db (read-only) - get frames
2. Load fullOCR.db (read-only) - get OCR detections
3. Load cropping.db (read-only) - get cropped frames
4. Load layout.db (read-write) - annotate boxes
5. Save updates to layout.db only

**DVC Impact:** Only layout.db (~68 KB) is versioned

**Example:**
```python
import sqlite3

# Connect and attach
conn = sqlite3.connect('layout.db')
conn.execute("ATTACH DATABASE 'video.db' AS video")
conn.execute("ATTACH DATABASE 'fullOCR.db' AS ocr")

# Annotate
conn.execute("""
    INSERT INTO full_frame_box_labels (frame_index, box_index, label)
    VALUES (?, ?, ?)
""", (frame_idx, box_idx, 'in'))

conn.commit()
# Only layout.db is modified
```

### Pattern 2: Caption Annotation Workflow

**Steps:**
1. Load video.db (read-only) - get frames
2. Load captions.db (read-write) - edit captions
3. Save updates to captions.db only

**DVC Impact:** Only captions.db (~248 KB) is versioned

### Pattern 3: OCR Re-run Workflow

**Steps:**
1. Load video.db (read-only) - get frames
2. Run OCR algorithm
3. Replace fullOCR.db entirely

**DVC Impact:** Only fullOCR.db (~756 KB) is versioned

### Pattern 4: Crop Regeneration Workflow

**Steps:**
1. Load video.db (read-only) - get full frames
2. Update video_layout_config
3. Regenerate cropped_frames
4. Replace cropping.db entirely

**DVC Impact:** Only cropping.db (~166 MB) is versioned (large but infrequent)

## Storage Efficiency Examples

### Example Video: 183 MB Original

**After Split:**
- video.db: 15 MB (8%)
- cropping.db: 166 MB (91%)
- fullOCR.db: 756 KB (0.4%)
- captions.db: 248 KB (0.1%)
- layout.db: 68 KB (0.04%)
- state.db: 20 KB (local)

**Annotation Workflow Savings:**

| Scenario | Old (Monolithic) | New (Split) | Savings |
|----------|------------------|-------------|---------|
| 100 layout annotation sessions | 18.3 GB | 2.2 GB | 88% |
| 50 caption editing sessions | 9.2 GB | 280 MB | 97% |
| 10 crop regenerations | 1.8 GB | 1.6 GB | 11% |
| 5 OCR re-runs | 915 MB | 78 MB | 91% |

## Application Integration Guide

### Python Example

```python
import sqlite3
from pathlib import Path

class VideoDatabase:
    """Multi-database video accessor."""

    def __init__(self, video_dir: Path):
        self.video_dir = video_dir
        self.connections = {}

    def __enter__(self):
        # Connect to main database (any will work as primary)
        self.primary = sqlite3.connect(self.video_dir / "video.db")

        # Attach all other databases
        self.primary.execute(
            "ATTACH DATABASE ? AS fullOCR",
            (str(self.video_dir / "fullOCR.db"),)
        )
        self.primary.execute(
            "ATTACH DATABASE ? AS cropping",
            (str(self.video_dir / "cropping.db"),)
        )
        self.primary.execute(
            "ATTACH DATABASE ? AS layout",
            (str(self.video_dir / "layout.db"),)
        )
        self.primary.execute(
            "ATTACH DATABASE ? AS captions",
            (str(self.video_dir / "captions.db"),)
        )
        self.primary.execute(
            "ATTACH DATABASE ? AS meta",
            (str(self.video_dir / "state.db"),)
        )

        return self.primary

    def __exit__(self, *args):
        self.primary.close()


# Usage
video_dir = Path("local/data/61/61c3123f-cb1f-4c0a-a6a9-b12650b17bd5")

with VideoDatabase(video_dir) as conn:
    cursor = conn.cursor()

    # Query across databases
    cursor.execute("""
        SELECT
            v.frame_index,
            o.text,
            l.label
        FROM video.full_frames v
        LEFT JOIN fullOCR.full_frame_ocr o
            ON v.frame_index = o.frame_index
        LEFT JOIN layout.full_frame_box_labels l
            ON o.frame_index = l.frame_index
            AND o.box_index = l.box_index
        WHERE v.frame_index = ?
    """, (100,))

    results = cursor.fetchall()
```

### Read-Only vs Read-Write

**Best Practice:** Only open databases as read-write if you intend to modify them.

```python
# Read-only access (for querying)
conn = sqlite3.connect('file:video.db?mode=ro', uri=True)

# Read-write access (for annotation)
conn = sqlite3.connect('layout.db')  # Default is read-write
```

## Migration from Monolithic Structure

### Before (Old Structure)
```
local/data/{hash}/{video_id}/
  captions.db          # 100-500 MB monolithic database
  20220219.mp4           # Source video
```

### After (New Structure)
```
local/data/{hash}/{video_id}/
  video.db               # 15-70 MB (immutable)
  fullOCR.db             # 0.5-5 MB (occasional)
  cropping.db            # 90-420 MB (rare)
  layout.db              # 0.05-20 MB (frequent)
  captions.db            # 0.1-2 MB (frequent)
  state.db            # <0.1 MB (local only)
  captions.db.old     # Backup of original
  20220219.mp4          # Source video
```

### Migration Script

Automated migration splits existing `captions.db` files:

```bash
# Preview migration
python scripts/migrate-split-databases.py --dry-run

# Migrate all videos
python scripts/migrate-split-databases.py

# Migrate specific video
python scripts/migrate-split-databases.py --limit 1
```

## DVC Workflow

### Initial Setup

```bash
# After migration, track all DVC databases
python scripts/setup-dvc-tracking.py

# This tracks:
# - video.db
# - fullOCR.db
# - cropping.db
# - layout.db
# - captions.db
# (but NOT state.db)

# Commit .dvc files to git
git add 'local/data/**/*.dvc'
git commit -m "Set up DVC tracking for split databases"

# Push to DVC storage
dvc push

# Push to git
git push
```

### Annotation Workflow with DVC

```bash
# 1. Work on annotations (updates layout.db)
# ... annotate in your application ...

# 2. Track updated database
dvc add local/data/{hash}/{video_id}/layout.db

# 3. Commit to git
git add local/data/{hash}/{video_id}/layout.db.dvc
git commit -m "Annotated layout for video {video_id}"

# 4. Push to DVC storage (only layout.db uploads, ~68 KB)
dvc push

# 5. Push to git
git push
```

### Pulling Annotations

```bash
# Pull specific video's annotations
dvc pull local/data/{hash}/{video_id}/layout.db

# Pull all layout annotations
dvc pull 'local/data/**/layout.db'

# Pull everything
dvc pull
```

## Implementation Checklist

### Phase 1: Database Access Layer

- [ ] Create `VideoDatabase` context manager class
- [ ] Implement ATTACH logic for all databases
- [ ] Add connection pooling if needed
- [ ] Handle missing databases gracefully
- [ ] Add read-only mode support

### Phase 2: Application Updates

- [ ] Update frame loading to use `video.db`
- [ ] Update OCR access to use `fullOCR.db`
- [ ] Update crop loading to use `cropping.db`
- [ ] Update layout annotation to write to `layout.db`
- [ ] Update caption editing to write to `captions.db`
- [ ] Update preferences to use `state.db`

### Phase 3: Workflow Integration

- [ ] Test layout annotation workflow
- [ ] Test caption editing workflow
- [ ] Test OCR re-run workflow
- [ ] Test crop regeneration workflow
- [ ] Verify referential integrity
- [ ] Add error handling for missing databases

### Phase 4: DVC Integration

- [ ] Update DVC tracking scripts
- [ ] Add .gitignore rules for state.db
- [ ] Document DVC workflow for team
- [ ] Test push/pull workflows
- [ ] Verify deduplication works

### Phase 5: Migration & Cleanup

- [ ] Run migration on all videos
- [ ] Verify data integrity
- [ ] Test application with split databases
- [ ] Delete backup files after verification
- [ ] Update documentation

## Troubleshooting

### Database Locked Errors

```python
# Use WAL mode for concurrent access
conn.execute("PRAGMA journal_mode=WAL")
```

### Missing Database

```python
# Check if database exists before attaching
db_path = video_dir / "layout.db"
if db_path.exists():
    conn.execute(f"ATTACH DATABASE '{db_path}' AS layout")
else:
    # Handle gracefully - maybe create empty database
    pass
```

### Foreign Key Violations

```python
# Validate references before inserting
cursor.execute("SELECT frame_index FROM video.full_frames WHERE frame_index = ?", (frame_idx,))
if cursor.fetchone():
    # Safe to insert into other tables
    pass
```

## Performance Considerations

### Query Optimization

- **Index Usage:** Indices are preserved in split databases
- **ATTACH Overhead:** Minimal (~1ms per database)
- **Query Planning:** SQLite optimizes across attached databases

### Best Practices

1. **ATTACH once** at connection open, not per query
2. **Use prepared statements** for repeated queries
3. **Batch writes** to minimize transaction overhead
4. **Use transactions** for multi-database updates
5. **Close connections** promptly to release locks

## Future Enhancements

### Potential Improvements

1. **Lazy Loading:** Only attach databases when needed
2. **Connection Pooling:** Reuse connections across requests
3. **Read Replicas:** Separate read-only connections
4. **Async Access:** Non-blocking database operations
5. **Schema Versioning:** Track database schema migrations

### Scalability Considerations

- Current design supports **millions of frames** per video
- Split structure enables **parallel processing** (different workers on different databases)
- DVC deduplication supports **thousands of videos**
- Storage scales linearly with annotation density

## References

- SQLite ATTACH DATABASE: https://www.sqlite.org/lang_attach.html
- DVC Documentation: https://dvc.org/doc
- Migration Script: `scripts/migrate-split-databases.py`
- DVC Setup Script: `scripts/setup-dvc-tracking.py`
