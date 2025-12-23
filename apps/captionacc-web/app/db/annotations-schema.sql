-- Annotations database schema
-- One database per video

CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    start_frame_index INTEGER NOT NULL,
    end_frame_index INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('predicted', 'confirmed', 'gap')),
    pending INTEGER NOT NULL DEFAULT 0 CHECK(pending IN (0, 1)),
    text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for fast lookups by frame range
CREATE INDEX IF NOT EXISTS idx_annotations_frame_range
ON annotations(start_frame_index, end_frame_index);

-- Index by granularity (100s place) for fast proximity lookups
CREATE INDEX IF NOT EXISTS idx_annotations_granularity
ON annotations((start_frame_index / 100) * 100);

-- Index for finding pending and gap annotations
CREATE INDEX IF NOT EXISTS idx_annotations_pending_gap
ON annotations(pending, state, start_frame_index);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_annotations_timestamp
AFTER UPDATE ON annotations
BEGIN
    UPDATE annotations
    SET updated_at = datetime('now')
    WHERE id = NEW.id;
END;
