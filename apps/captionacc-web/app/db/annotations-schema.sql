-- Annotations database schema
-- One database per video

CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_frame_index INTEGER NOT NULL,
    end_frame_index INTEGER NOT NULL,

    -- Boundary annotation fields
    boundary_state TEXT NOT NULL DEFAULT 'predicted' CHECK(boundary_state IN ('predicted', 'confirmed', 'gap')),
    boundary_pending INTEGER NOT NULL DEFAULT 0 CHECK(boundary_pending IN (0, 1)),
    boundary_updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Text annotation fields
    text TEXT,  -- NULL = not annotated, empty string = annotated as "no caption"
    text_pending INTEGER NOT NULL DEFAULT 0 CHECK(text_pending IN (0, 1)),
    text_status TEXT CHECK(text_status IN ('valid_caption', 'ocr_error', 'partial_caption', 'text_unclear', 'other_issue')),
    text_notes TEXT,
    text_ocr_combined TEXT,  -- Cached OCR result from combined image
    text_updated_at TEXT,  -- NULL until first text annotation save

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Frames table for per-frame OCR data
CREATE TABLE IF NOT EXISTS frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    annotation_id INTEGER NOT NULL,
    frame_index INTEGER NOT NULL,
    ocr_text TEXT,
    ocr_confidence REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (annotation_id) REFERENCES annotations(id) ON DELETE CASCADE
);

-- Indexes for annotations table

-- Index for fast lookups by frame range
CREATE INDEX IF NOT EXISTS idx_annotations_frame_range
ON annotations(start_frame_index, end_frame_index);

-- Index by granularity (100s place) for fast proximity lookups
CREATE INDEX IF NOT EXISTS idx_annotations_granularity
ON annotations((start_frame_index / 100) * 100);

-- Index for finding boundary pending annotations
CREATE INDEX IF NOT EXISTS idx_annotations_boundary_pending
ON annotations(boundary_pending, boundary_state, start_frame_index);

-- Index for finding text pending annotations
CREATE INDEX IF NOT EXISTS idx_annotations_text_pending
ON annotations(text_pending, start_frame_index);

-- Index for finding annotations needing text (NULL text or text_pending)
CREATE INDEX IF NOT EXISTS idx_annotations_text_null
ON annotations((text IS NULL), text_pending, start_frame_index);

-- Indexes for frames table

-- Index for looking up frames by annotation
CREATE INDEX IF NOT EXISTS idx_frames_annotation
ON frames(annotation_id);

-- Unique index to prevent duplicate frame entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_frames_unique
ON frames(annotation_id, frame_index);

-- Triggers

-- Triggers to update timestamp fields
CREATE TRIGGER IF NOT EXISTS update_boundary_timestamp
AFTER UPDATE OF start_frame_index, end_frame_index, boundary_state, boundary_pending ON annotations
BEGIN
    UPDATE annotations
    SET boundary_updated_at = datetime('now')
    WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_text_timestamp
AFTER UPDATE OF text, text_status, text_notes ON annotations
BEGIN
    UPDATE annotations
    SET text_updated_at = datetime('now')
    WHERE id = NEW.id;
END;
