-- Migration: Add 'issue' boundary_state option
-- SQLite doesn't support modifying CHECK constraints directly, so we need to recreate the table

PRAGMA foreign_keys=off;

BEGIN TRANSACTION;

-- Create new table with updated CHECK constraint
CREATE TABLE captions_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_frame_index INTEGER NOT NULL,
    end_frame_index INTEGER NOT NULL,

    -- Boundary annotation fields (updated to include 'issue')
    -- CHECK constraint values defined in: app/types/boundaries.ts ANNOTATION_STATES
    boundary_state TEXT NOT NULL DEFAULT 'predicted' CHECK(boundary_state IN ('predicted', 'confirmed', 'gap', 'issue')),
    boundary_pending INTEGER NOT NULL DEFAULT 0 CHECK(boundary_pending IN (0, 1)),
    boundary_updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Text annotation fields
    text TEXT,
    text_pending INTEGER NOT NULL DEFAULT 0 CHECK(text_pending IN (0, 1)),
    text_status TEXT CHECK(text_status IN ('valid_caption', 'ocr_error', 'partial_caption', 'text_unclear', 'other_issue', 'confirmed')),
    text_notes TEXT,
    text_ocr_combined TEXT,
    text_updated_at TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copy data from old table to new table
INSERT INTO captions_new SELECT * FROM captions;

-- Drop old table
DROP TABLE captions;

-- Rename new table to original name
ALTER TABLE captions_new RENAME TO captions;

-- Recreate indexes
CREATE INDEX idx_captions_frame_range ON captions(start_frame_index, end_frame_index);
CREATE INDEX idx_captions_granularity ON captions((start_frame_index / 100) * 100);
CREATE INDEX idx_captions_boundary_pending ON captions(boundary_pending, boundary_state, start_frame_index);
CREATE INDEX idx_captions_text_pending ON captions(text_pending, start_frame_index);
CREATE INDEX idx_captions_text_null ON captions((text IS NULL), text_pending, start_frame_index);

-- Recreate triggers
CREATE TRIGGER update_boundary_timestamp
AFTER UPDATE OF start_frame_index, end_frame_index, boundary_state, boundary_pending ON captions
BEGIN
    UPDATE captions
    SET boundary_updated_at = datetime('now')
    WHERE id = NEW.id;
END;

CREATE TRIGGER update_text_timestamp
AFTER UPDATE OF text, text_status, text_notes ON captions
BEGIN
    UPDATE captions
    SET text_updated_at = datetime('now')
    WHERE id = NEW.id;
END;

COMMIT;

PRAGMA foreign_keys=on;
