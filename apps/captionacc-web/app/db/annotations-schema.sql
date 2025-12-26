-- Annotations database schema
-- One database per video

CREATE TABLE IF NOT EXISTS captions (
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

-- Cropped frame OCR table for per-frame OCR data (10Hz frames, cropped)
-- Independent of annotations, invalidated when crop bounds change
CREATE TABLE IF NOT EXISTS cropped_frame_ocr (
    frame_index INTEGER PRIMARY KEY,
    ocr_text TEXT,
    ocr_annotations TEXT,  -- JSON: [[text, conf, [x, y, w, h]], ...]
    ocr_confidence REAL,
    crop_bounds_version INTEGER DEFAULT 1,  -- Invalidation tracking
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Full frame OCR boxes (0.1Hz sampled frames)
-- Stores raw OCR detection results from full (uncropped) frames
CREATE TABLE IF NOT EXISTS full_frame_ocr (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_index INTEGER NOT NULL,
    box_index INTEGER NOT NULL,  -- Position in OCR results for this frame

    -- OCR detection results
    text TEXT NOT NULL,
    confidence REAL NOT NULL,

    -- Bounding box coordinates (fractional [0-1] relative to original frame)
    -- Note: y is bottom-referenced (0 = bottom, 1 = top)
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(frame_index, box_index)
);

-- User labels for full frame OCR boxes (caption vs noise classification)
-- Links to full_frame_ocr via (frame_index, box_index)
CREATE TABLE IF NOT EXISTS full_frame_box_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_index INTEGER NOT NULL,
    box_index INTEGER NOT NULL,

    -- Box identification (absolute pixel coords for reference)
    box_text TEXT NOT NULL,
    box_left INTEGER NOT NULL,
    box_top INTEGER NOT NULL,
    box_right INTEGER NOT NULL,
    box_bottom INTEGER NOT NULL,

    -- Label
    label TEXT NOT NULL CHECK(label IN ('in', 'out')),
    label_source TEXT NOT NULL CHECK(label_source IN ('user', 'model')),

    -- Model prediction (for comparison)
    predicted_label TEXT CHECK(predicted_label IN ('in', 'out')),
    predicted_confidence REAL CHECK(predicted_confidence >= 0.0 AND predicted_confidence <= 1.0),
    model_version TEXT,

    -- Metadata
    labeled_at TEXT NOT NULL DEFAULT (datetime('now')),

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

    -- Selection rectangle (absolute pixels within original frame, optional)
    selection_left INTEGER,
    selection_top INTEGER,
    selection_right INTEGER,
    selection_bottom INTEGER,

    -- Layout parameters (Bayesian priors, absolute pixels in original frame)
    vertical_position INTEGER,  -- Mode vertical center position
    vertical_std REAL,  -- Standard deviation for Bayesian prior
    box_height INTEGER,  -- Mode box height
    box_height_std REAL,  -- Standard deviation for Bayesian prior
    anchor_type TEXT CHECK(anchor_type IN ('left', 'center', 'right')),
    anchor_position INTEGER,  -- Mode anchor position

    -- Distribution parameters for constraint expansion
    top_edge_std REAL,  -- Standard deviation of top edges for upward expansion
    bottom_edge_std REAL,  -- Standard deviation of bottom edges for downward expansion
    horizontal_std_slope REAL,  -- Linear model: horizontal_std = slope * distance_from_anchor + intercept
    horizontal_std_intercept REAL,  -- Linear model intercept

    -- Invalidation tracking
    crop_bounds_version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Note: video_layout_config initialized when video is first analyzed
-- (requires frame dimensions from video)

-- Indexes for captions table

-- Index for fast lookups by frame range
CREATE INDEX IF NOT EXISTS idx_captions_frame_range
ON captions(start_frame_index, end_frame_index);

-- Index by granularity (100s place) for fast proximity lookups
CREATE INDEX IF NOT EXISTS idx_captions_granularity
ON captions((start_frame_index / 100) * 100);

-- Index for finding boundary pending captions
CREATE INDEX IF NOT EXISTS idx_captions_boundary_pending
ON captions(boundary_pending, boundary_state, start_frame_index);

-- Index for finding text pending captions
CREATE INDEX IF NOT EXISTS idx_captions_text_pending
ON captions(text_pending, start_frame_index);

-- Index for finding captions needing text (NULL text or text_pending)
CREATE INDEX IF NOT EXISTS idx_captions_text_null
ON captions((text IS NULL), text_pending, start_frame_index);

-- Indexes for cropped_frame_ocr table

-- Index for invalidation queries
CREATE INDEX IF NOT EXISTS idx_cropped_frame_ocr_crop_version
ON cropped_frame_ocr(crop_bounds_version);

-- Indexes for full_frame_ocr table

-- Index for fast lookups by frame
CREATE INDEX IF NOT EXISTS idx_full_frame_ocr_frame
ON full_frame_ocr(frame_index);

-- Indexes for full_frame_box_labels table

-- Index for fast lookups by frame
CREATE INDEX IF NOT EXISTS idx_full_frame_box_labels_frame
ON full_frame_box_labels(frame_index);

-- Index for finding user labels (for training data)
CREATE INDEX IF NOT EXISTS idx_full_frame_box_labels_user
ON full_frame_box_labels(label_source, labeled_at)
WHERE label_source = 'user';

-- Index for model version tracking
CREATE INDEX IF NOT EXISTS idx_full_frame_box_labels_model_version
ON full_frame_box_labels(model_version, label_source);

-- Triggers

-- Triggers to update timestamp fields on captions
CREATE TRIGGER IF NOT EXISTS update_boundary_timestamp
AFTER UPDATE OF start_frame_index, end_frame_index, boundary_state, boundary_pending ON captions
BEGIN
    UPDATE captions
    SET boundary_updated_at = datetime('now')
    WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_text_timestamp
AFTER UPDATE OF text, text_status, text_notes ON captions
BEGIN
    UPDATE captions
    SET text_updated_at = datetime('now')
    WHERE id = NEW.id;
END;
