-- Annotations database schema
-- One database per video
-- Schema version: 1

CREATE TABLE IF NOT EXISTS captions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_frame_index INTEGER NOT NULL,
    end_frame_index INTEGER NOT NULL,

    -- Boundary annotation fields
    -- CHECK constraint values defined in: app/types/boundaries.ts ANNOTATION_STATES
    boundary_state TEXT NOT NULL DEFAULT 'predicted' CHECK(boundary_state IN ('predicted', 'confirmed', 'gap', 'issue')),
    boundary_pending INTEGER NOT NULL DEFAULT 0 CHECK(boundary_pending IN (0, 1)),
    boundary_updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Text annotation fields
    text TEXT,  -- NULL = not annotated, empty string = annotated as "no caption"
    text_pending INTEGER NOT NULL DEFAULT 0 CHECK(text_pending IN (0, 1)),
    text_status TEXT CHECK(text_status IN ('valid_caption', 'ocr_error', 'partial_caption', 'text_unclear', 'other_issue', 'confirmed')),
    text_notes TEXT,
    text_ocr_combined TEXT,  -- Cached OCR result from combined image
    text_updated_at TEXT,  -- NULL until first text annotation save

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

    -- Temporal information
    timestamp_seconds REAL,  -- Timestamp in video (frame_index / index_framerate_hz)

    -- Predictions (NULL = not yet calculated)
    predicted_label TEXT CHECK(predicted_label IN ('in', 'out')),
    predicted_confidence REAL CHECK(predicted_confidence >= 0.0 AND predicted_confidence <= 1.0),
    model_version TEXT,  -- Which model version generated this prediction
    predicted_at TEXT,   -- When prediction was calculated

    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(frame_index, box_index)
);

-- User labels for OCR boxes (caption vs noise classification)
-- Supports annotations from both full frames and cropped frames
-- All coordinates stored in full-frame absolute pixels for consistent feature extraction
CREATE TABLE IF NOT EXISTS full_frame_box_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Source identification
    annotation_source TEXT NOT NULL DEFAULT 'full_frame' CHECK(annotation_source IN ('full_frame', 'cropped_frame')),
    frame_index INTEGER NOT NULL,  -- References full_frame_ocr.frame_index
    box_index INTEGER NOT NULL,    -- References box_index in OCR table

    -- Box identification (absolute pixel coords in original/full frame)
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
    crop_bounds_version INTEGER,  -- Which crop bounds were active when annotated (for cropped_frame source)
    labeled_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(annotation_source, frame_index, box_index)
);

-- Full frames binary storage (0.1Hz sampling, ~6 frames/min)
-- Stores JPEG-compressed frame images for full (uncropped) frames
CREATE TABLE IF NOT EXISTS full_frames (
    frame_index INTEGER PRIMARY KEY,
    image_data BLOB NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    file_size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cropped frames binary storage (10Hz sampling, 600 frames/min)
-- Stores JPEG-compressed frame images cropped to caption region
CREATE TABLE IF NOT EXISTS cropped_frames (
    frame_index INTEGER PRIMARY KEY,
    image_data BLOB NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    file_size INTEGER NOT NULL,
    crop_left INTEGER NOT NULL,  -- Actual crop bounds used (absolute pixels in original frame)
    crop_top INTEGER NOT NULL,
    crop_right INTEGER NOT NULL,
    crop_bottom INTEGER NOT NULL,
    crop_bounds_version INTEGER DEFAULT 1,  -- Version tracking for grouping/history
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    analysis_model_version TEXT,  -- Model version used for current crop bounds analysis

    -- OCR visualization (cropped to caption bounds)
    ocr_visualization_image BLOB,  -- PNG image showing OCR boxes, cropped to crop bounds

    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Note: video_layout_config initialized when video is first analyzed
-- (requires frame dimensions from video)

-- Box classification model (Gaussian Naive Bayes parameters)
-- Stores trained model parameters for predicting caption vs noise boxes
CREATE TABLE IF NOT EXISTS box_classification_model (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    model_version TEXT NOT NULL DEFAULT 'naive_bayes_v1',
    trained_at TEXT NOT NULL,
    n_training_samples INTEGER NOT NULL,

    -- Class priors
    prior_in REAL NOT NULL,
    prior_out REAL NOT NULL,

    -- Gaussian parameters for each feature (mean, std) per class
    -- Base geometric features
    -- "in" class (caption boxes)
    in_vertical_alignment_mean REAL,
    in_vertical_alignment_std REAL,
    in_height_similarity_mean REAL,
    in_height_similarity_std REAL,
    in_anchor_distance_mean REAL,
    in_anchor_distance_std REAL,
    in_crop_overlap_mean REAL,
    in_crop_overlap_std REAL,
    in_aspect_ratio_mean REAL,
    in_aspect_ratio_std REAL,
    in_normalized_y_mean REAL,
    in_normalized_y_std REAL,
    in_normalized_area_mean REAL,
    in_normalized_area_std REAL,

    -- "out" class (noise boxes)
    out_vertical_alignment_mean REAL,
    out_vertical_alignment_std REAL,
    out_height_similarity_mean REAL,
    out_height_similarity_std REAL,
    out_anchor_distance_mean REAL,
    out_anchor_distance_std REAL,
    out_crop_overlap_mean REAL,
    out_crop_overlap_std REAL,
    out_aspect_ratio_mean REAL,
    out_aspect_ratio_std REAL,
    out_normalized_y_mean REAL,
    out_normalized_y_std REAL,
    out_normalized_area_mean REAL,
    out_normalized_area_std REAL,

    -- Position features (normalized coordinates)
    in_normalized_left_mean REAL,
    in_normalized_left_std REAL,
    in_normalized_top_mean REAL,
    in_normalized_top_std REAL,
    in_normalized_right_mean REAL,
    in_normalized_right_std REAL,
    in_normalized_bottom_mean REAL,
    in_normalized_bottom_std REAL,

    out_normalized_left_mean REAL,
    out_normalized_left_std REAL,
    out_normalized_top_mean REAL,
    out_normalized_top_std REAL,
    out_normalized_right_mean REAL,
    out_normalized_right_std REAL,
    out_normalized_bottom_mean REAL,
    out_normalized_bottom_std REAL,

    -- Temporal features
    in_time_from_start_mean REAL,
    in_time_from_start_std REAL,
    in_time_from_end_mean REAL,
    in_time_from_end_std REAL,

    out_time_from_start_mean REAL,
    out_time_from_start_std REAL,
    out_time_from_end_mean REAL,
    out_time_from_end_std REAL,

    -- Character set features (language detection)
    in_is_roman_mean REAL,
    in_is_roman_std REAL,
    in_is_hanzi_mean REAL,
    in_is_hanzi_std REAL,
    in_is_arabic_mean REAL,
    in_is_arabic_std REAL,
    in_is_korean_mean REAL,
    in_is_korean_std REAL,
    in_is_hiragana_mean REAL,
    in_is_hiragana_std REAL,
    in_is_katakana_mean REAL,
    in_is_katakana_std REAL,
    in_is_cyrillic_mean REAL,
    in_is_cyrillic_std REAL,
    in_is_devanagari_mean REAL,
    in_is_devanagari_std REAL,
    in_is_thai_mean REAL,
    in_is_thai_std REAL,
    in_is_digits_mean REAL,
    in_is_digits_std REAL,
    in_is_punctuation_mean REAL,
    in_is_punctuation_std REAL,

    out_is_roman_mean REAL,
    out_is_roman_std REAL,
    out_is_hanzi_mean REAL,
    out_is_hanzi_std REAL,
    out_is_arabic_mean REAL,
    out_is_arabic_std REAL,
    out_is_korean_mean REAL,
    out_is_korean_std REAL,
    out_is_hiragana_mean REAL,
    out_is_hiragana_std REAL,
    out_is_katakana_mean REAL,
    out_is_katakana_std REAL,
    out_is_cyrillic_mean REAL,
    out_is_cyrillic_std REAL,
    out_is_devanagari_mean REAL,
    out_is_devanagari_std REAL,
    out_is_thai_mean REAL,
    out_is_thai_std REAL,
    out_is_digits_mean REAL,
    out_is_digits_std REAL,
    out_is_punctuation_mean REAL,
    out_is_punctuation_std REAL,

    -- User annotation features
    in_user_annotated_in_mean REAL,
    in_user_annotated_in_std REAL,
    in_user_annotated_out_mean REAL,
    in_user_annotated_out_std REAL,

    out_user_annotated_in_mean REAL,
    out_user_annotated_in_std REAL,
    out_user_annotated_out_mean REAL,
    out_user_annotated_out_std REAL,

    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

-- Indexes for cropped_frames table

-- Index for invalidation queries
CREATE INDEX IF NOT EXISTS idx_cropped_frames_crop_version
ON cropped_frames(crop_bounds_version);

-- Video preferences (one row per video)
CREATE TABLE IF NOT EXISTS video_preferences (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    layout_approved INTEGER NOT NULL DEFAULT 0 CHECK(layout_approved IN (0, 1)),
    text_size REAL DEFAULT 3.0,  -- Text size as percentage of image width (1.0-10.0)
    padding_scale REAL DEFAULT 0.75,  -- Padding scale multiplier (0.0-2.0)
    text_anchor TEXT DEFAULT 'left' CHECK(text_anchor IN ('left', 'center', 'right')),  -- Text alignment
    index_framerate_hz REAL DEFAULT 10.0,  -- Sampling rate for indexed frames (used for timestamp calculation)
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Video metadata (one row per video)
-- Storage uses UUID-based hash-bucketed paths (local/data/{uuid[:2]}/{uuid}/)
-- User-facing paths (display_path) are abstraction for folder management
CREATE TABLE IF NOT EXISTS video_metadata (
    id INTEGER PRIMARY KEY CHECK(id = 1),

    -- Video identity
    video_id TEXT NOT NULL,  -- UUID v4 for this video (stable identifier)
    video_hash TEXT NOT NULL,  -- SHA256 hash for deduplication detection
    storage_path TEXT NOT NULL,  -- Hash-bucketed path (e.g., "a4/a4f2b8c3-1234-5678-90ab-cdef12345678")

    -- User-facing organization
    display_path TEXT NOT NULL,  -- User-facing path (e.g., "level1/video_name")

    -- Original file info
    original_filename TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,

    -- Upload info
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    upload_method TEXT CHECK(upload_method IN ('web_upload', 'api_upload', 'manual')),

    -- Video properties (populated after upload)
    duration_seconds REAL,
    width INTEGER,
    height INTEGER,
    fps REAL,
    codec TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Duplicate resolution tracking (one row per video if duplicate detected)
CREATE TABLE IF NOT EXISTS duplicate_resolution (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    duplicate_of_video_id TEXT NOT NULL,      -- UUID of the existing duplicate video
    duplicate_of_display_path TEXT NOT NULL,  -- Display path of the existing video
    detected_at TEXT NOT NULL,                -- When duplicate was detected
    user_decision TEXT CHECK(user_decision IN ('keep_both', 'replace_existing', 'cancel_upload')),
    resolved_at TEXT                          -- When user made their decision
);

-- Processing status tracking (one row per video)
CREATE TABLE IF NOT EXISTS processing_status (
    id INTEGER PRIMARY KEY CHECK(id = 1),

    -- Overall status
    status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN (
        'uploading',                      -- File upload in progress
        'upload_complete',                -- Upload done, queued for processing
        'pending_duplicate_resolution',   -- Duplicate detected, awaiting user decision
        'extracting_frames',              -- Running full_frames extraction
        'running_ocr',                    -- Running OCR on frames
        'analyzing_layout',               -- Running layout analysis
        'processing_complete',            -- All processing complete
        'error'                           -- Processing failed
    )),

    -- Processing progress (0.0 to 1.0)
    upload_progress REAL DEFAULT 0.0,
    frame_extraction_progress REAL DEFAULT 0.0,
    ocr_progress REAL DEFAULT 0.0,
    layout_analysis_progress REAL DEFAULT 0.0,

    -- Error tracking
    error_message TEXT,
    error_details TEXT,  -- JSON with detailed error info

    -- Processing job tracking
    current_job_id TEXT,  -- PID of background processing job
    processing_attempts INTEGER NOT NULL DEFAULT 0,  -- Number of processing attempts
    last_heartbeat_at TEXT,  -- Last time processing job checked in

    -- Deletion tracking
    deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1)),  -- Soft delete flag
    deleted_at TEXT,  -- When deletion was initiated

    -- Timestamps
    upload_started_at TEXT,
    upload_completed_at TEXT,
    processing_started_at TEXT,
    processing_completed_at TEXT,
    error_occurred_at TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

-- Database metadata (schema versioning)
-- Tracks schema version and verification state
CREATE TABLE IF NOT EXISTS database_metadata (
    id INTEGER PRIMARY KEY CHECK(id = 1),

    -- Schema version tracking
    schema_version INTEGER NOT NULL,
    schema_checksum TEXT,              -- SHA256 of schema for verification

    -- Lifecycle tracking
    created_at TEXT NOT NULL,
    migrated_at TEXT,                  -- When last migration applied
    verified_at TEXT                   -- When schema last verified
);
