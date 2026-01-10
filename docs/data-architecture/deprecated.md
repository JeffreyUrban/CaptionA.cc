Things to deprecate:

cropped_frames table 

captions.db tables:
`video_metadata`
`video_layout_config`
`video_preferences`
`processing_status`
`text_review_status`
`duplicate_resolution`
`vp9_encoding_status`

**Migration Scripts**:
- `apps/captionacc-web/scripts/init-annotations-db.ts`
- `scripts/migrate-split-databases.py`

Supabase tables:
`video_search_index`
