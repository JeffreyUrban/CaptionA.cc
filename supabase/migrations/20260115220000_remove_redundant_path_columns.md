# Migration: Remove Redundant Path Columns

## What Changed

Removed `storage_key` and `video_path` columns from `videos` table:
- **`storage_key`**: Can be computed as `{tenant_id}/client/videos/{id}/video.mp4`
- **`video_path`**: Redundant with `display_path`

Only `display_path` is now stored for user-facing organization.

## Post-Migration Steps

After running this migration, regenerate TypeScript types:

```bash
cd apps/captionacc-web
npm run supabase:types
```

This will update `app/types/supabase.ts` to reflect the schema changes.

## Design Rationale

- `tenant_id` + `video_id` provides stable reference
- `storage_key` is deterministic and can be computed on-demand
- `display_path` is the only user-facing path that changes with rename/move
- Simpler schema, less redundancy, cleaner design
