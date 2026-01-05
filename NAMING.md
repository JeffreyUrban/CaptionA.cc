# Fly.io Naming Convention

All CaptionA.cc services use the `captionacc-` prefix for easy identification.

## Current Apps

| App Name | Purpose | Directory |
|----------|---------|-----------|
| `captionacc-web` | Main web application | `apps/captionacc-web/` |
| `captionacc-ocr` | OCR batch processing service | `services/ocr-service/` |

## Future Apps

Follow the pattern: `captionacc-{service-name}`

Examples:
- `captionacc-api` - API service
- `captionacc-worker` - Background worker
- `captionacc-cdn` - CDN/media service

## Benefits

✓ All apps grouped together in Fly.io dashboard
✓ Easy to identify project apps vs other projects
✓ Consistent with monorepo structure
✓ Short enough to be practical

## Renaming an App

If you need to rename:

```bash
# Cannot rename directly on Fly.io
# Must create new app and migrate

# 1. Create new app with correct name
flyctl apps create captionacc-new-name

# 2. Deploy to new app
flyctl deploy --app captionacc-new-name

# 3. Migrate secrets
flyctl secrets list --app old-name
flyctl secrets set --app captionacc-new-name KEY=value

# 4. Update DNS/configuration

# 5. Delete old app
flyctl apps destroy old-name
```
