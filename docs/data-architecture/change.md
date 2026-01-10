Change so is no longer a 'local' file. Store in Wasabi somewhere:

### Caption Boundaries Training Database

Central SQLite database for ML training data.

**Location**: `local/caption_boundaries_training.db`
**ORM**: SQLAlchemy

**Tables**:
- `video_registry` - SHA256-indexed video registry
- `training_datasets` - Datasets with provenance tracking
- `training_samples` - Frame pairs with labels
- `ocr_visualizations` - Cached visualizations
- `training_frames` - Consolidated frame BLOBs
- `experiments` - W&B experiment tracking

---


Change to migrations per database. This was for the deprecated annotations.db:

## Migration System

**Current Version**: 2

### Migration Files <- Which database(s) is this for?

- `annotations-schema-v0.sql` - Legacy (testing)
- `annotations-schema-v1.sql` - v1 schema
- `annotations-schema-v2.sql` - Current production (22.6 KB)

### v1 → v2 Changes

- Added `image_needs_regen` column to `captions` table

### Migration Execution

```typescript
// Automatic during database open (read-write mode)
const db = await getWritableCaptionDb(videoId);
// Checks database_metadata.schema_version
// Applies pending migrations sequentially
```

## Related Files

**Schemas**:
- `apps/captionacc-web/app/db/annotations-schema-v2.sql`

---

Rename `captionacc_prefect` database to `prefect` database. 
