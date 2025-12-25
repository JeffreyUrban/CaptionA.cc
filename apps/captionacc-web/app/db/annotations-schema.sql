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

-- Frames table for per-frame OCR data (linked to annotations)
CREATE TABLE IF NOT EXISTS frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    annotation_id INTEGER NOT NULL,
    frame_index INTEGER NOT NULL,
    ocr_text TEXT,
    ocr_confidence REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (annotation_id) REFERENCES annotations(id) ON DELETE CASCADE
);

-- Frames OCR table for per-frame OCR data (independent of annotations)
CREATE TABLE IF NOT EXISTS frames_ocr (
    frame_index INTEGER PRIMARY KEY,
    ocr_text TEXT,
    ocr_annotations TEXT,  -- JSON: [[text, conf, [x, y, w, h]], ...]
    ocr_confidence REAL,
    crop_bounds_version INTEGER DEFAULT 1,  -- Invalidation tracking
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- OCR box annotations table for user annotations on character boxes
-- Note: No foreign key to frames_ocr because we annotate caption_layout frames
-- which are not in frames_ocr (they're sampled at 0.1Hz vs 10Hz)
CREATE TABLE IF NOT EXISTS ocr_box_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_index INTEGER NOT NULL,
    box_index INTEGER NOT NULL,

    -- Box identification (ORIGINAL non-cropped absolute pixel coords)
    box_text TEXT NOT NULL,
    box_left INTEGER NOT NULL,
    box_top INTEGER NOT NULL,
    box_right INTEGER NOT NULL,
    box_bottom INTEGER NOT NULL,

    -- Annotation
    label TEXT NOT NULL CHECK(label IN ('in', 'out')),
    annotation_source TEXT NOT NULL CHECK(annotation_source IN ('user', 'model')),

    -- Model prediction (for comparison)
    predicted_label TEXT CHECK(predicted_label IN ('in', 'out')),
    predicted_confidence REAL CHECK(predicted_confidence >= 0.0 AND predicted_confidence <= 1.0),
    model_version TEXT,

    -- Metadata
    annotated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(frame_index, box_index)
);

-- Video layout configuration (one row per video)
CREATE TABLE IF NOT EXISTS video_layout_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),

    -- Frame dimensions (required for coordinate conversions)
    frame_width INTEGER NOT NULL,
    frame_height INTEGER NOT NULL,

    -- Cropping bounds (absolute pixel coords in original frame)
    crop_left INTEGER NOT NULL DEFAULT 0,
    crop_top INTEGER NOT NULL,  -- No default - set from video analysis
    crop_right INTEGER NOT NULL,  -- No default - set to frame_width
    crop_bottom INTEGER NOT NULL,  -- No default - set to frame_height

    -- Selection rectangle constraint (absolute pixels within original frame)
    selection_left INTEGER,
    selection_top INTEGER,
    selection_right INTEGER,
    selection_bottom INTEGER,
    selection_mode TEXT NOT NULL DEFAULT 'hard' CHECK(selection_mode IN ('hard', 'soft', 'disabled')),

    -- Layout parameters (Bayesian priors, absolute pixels in original frame)
    vertical_position INTEGER,  -- Mode vertical center position
    vertical_std REAL,  -- Standard deviation for Bayesian prior
    box_height INTEGER,  -- Mode box height
    box_height_std REAL,  -- Standard deviation for Bayesian prior
    anchor_type TEXT CHECK(anchor_type IN ('left', 'center', 'right')),
    anchor_position INTEGER,  -- Mode anchor position

    -- Invalidation tracking
    crop_bounds_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Note: video_layout_config initialized when video is first analyzed
-- (requires frame dimensions from video)

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

-- Indexes for frames_ocr table

-- Index for invalidation queries
CREATE INDEX IF NOT EXISTS idx_frames_ocr_crop_version
ON frames_ocr(crop_bounds_version);

-- Indexes for ocr_box_annotations table

-- Index for fast lookups by frame
CREATE INDEX IF NOT EXISTS idx_ocr_box_annotations_frame
ON ocr_box_annotations(frame_index);

-- Index for finding user annotations (for training data)
CREATE INDEX IF NOT EXISTS idx_ocr_box_annotations_user
ON ocr_box_annotations(annotation_source, annotated_at)
WHERE annotation_source = 'user';

-- Index for model version tracking
CREATE INDEX IF NOT EXISTS idx_ocr_box_annotations_model_version
ON ocr_box_annotations(model_version, annotation_source);

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
