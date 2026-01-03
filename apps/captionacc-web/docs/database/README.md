# Database Architecture

## Per-Video SQLite Design

**Decision:** One `annotations.db` SQLite file per video, stored in hash-bucketed directories.

**Structure:**

```
local/data/
  {hash_prefix}/          # First 2 chars of video UUID (bucketing)
    {video_uuid}/         # Full video UUID
      annotations.db      # Video-specific database
      {video_id}.mp4
      crop_frames/
```

**Rationale:**

- ✅ **Parallel processing** - Multiple videos can be processed simultaneously without lock contention
- ✅ **Simple backup/restore** - Copy individual video directories
- ✅ **Isolated failures** - Corruption affects single video, not entire dataset
- ⚠️ **Cannot query across videos** - No cross-video analytics without aggregation layer
- ⚠️ **Many file handles** - Each video access opens separate database connection

## Video Identification

**Multiple ID types serve different purposes:**

- `video_id` (UUID) - Stable identifier, never changes, used for all references
- `video_hash` (SHA256) - Content hash for deduplication (same file = same hash)
- `display_path` - User-facing path (e.g., "category/item_01"), can change

**Why separate hash and ID:** Allows tracking when same video uploaded multiple times while maintaining stable references.

**Storage location:** Derived from `video_id` via hash-bucketing (`{video_id[0:2]}/{video_id}/`)

## Incomplete Databases

**Problem:** Some databases exist but lack core tables (e.g., only `captions` table, no `video_metadata`).

**Cause:** Processing interrupted or failed partway through initialization.

**Detection:**

- Missing `video_metadata` table = orphaned database
- `SELECT COUNT(*) FROM video_metadata` should return 1

**Migration Impact:** Migrations must check table existence before attempting modifications.

## File Locations

- Schema: `app/db/annotations-schema.sql`
- Migrations: `app/db/migrations/`
- Migration runner: `app/db/migrate.ts`
- Database utilities: `app/utils/database.ts`
- Video path resolution: `app/utils/video-paths.ts`
