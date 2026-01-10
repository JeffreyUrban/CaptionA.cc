Things to deprecate:

`state.db`. Replaced with tables in supabase. 

`local/data/` directory (this was a previous implementation spanning all data).

Support for uploading video formats besides .mp4 

unique filenames for video files. Name all video files as video.mp4

video_search_index and related full-text search features

modulo_8 and modulo_2 

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
