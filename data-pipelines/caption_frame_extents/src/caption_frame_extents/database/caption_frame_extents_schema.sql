-- SQLite schema for caption frame extents inference database
-- Each DB file contains results from ONE inference run (immutable)
-- Filename format: v{frames_version}_model-{model_hash[:8]}_run-{uuid}.db

-- Run metadata (self-describing file)
CREATE TABLE IF NOT EXISTS run_metadata (
  cropped_frames_version INTEGER NOT NULL,
  model_version TEXT NOT NULL,              -- Full checkpoint hash or identifier
  model_checkpoint_path TEXT,               -- Path to model checkpoint used
  run_id TEXT PRIMARY KEY,                  -- UUID for this inference run
  started_at TEXT NOT NULL,                 -- ISO 8601 timestamp
  completed_at TEXT NOT NULL,               -- ISO 8601 timestamp
  total_pairs INTEGER NOT NULL,             -- Number of frame pairs (typically ~25k)
  processing_time_seconds REAL              -- Total processing time
);

-- Frame pair inference results
-- Combined forward + backward in same row (25k rows instead of 50k)
CREATE TABLE IF NOT EXISTS pair_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Frame pair (ordered: frame1_index < frame2_index)
  frame1_index INTEGER NOT NULL,
  frame2_index INTEGER NOT NULL,

  -- Forward direction: frame1 → frame2
  forward_predicted_label TEXT NOT NULL CHECK (
    forward_predicted_label IN ('same', 'different', 'empty_empty', 'empty_valid', 'valid_empty')
  ),
  forward_confidence REAL NOT NULL CHECK (
    forward_confidence >= 0.0 AND forward_confidence <= 1.0
  ),
  forward_prob_same REAL NOT NULL CHECK (forward_prob_same >= 0.0 AND forward_prob_same <= 1.0),
  forward_prob_different REAL NOT NULL CHECK (forward_prob_different >= 0.0 AND forward_prob_different <= 1.0),
  forward_prob_empty_empty REAL NOT NULL CHECK (forward_prob_empty_empty >= 0.0 AND forward_prob_empty_empty <= 1.0),
  forward_prob_empty_valid REAL NOT NULL CHECK (forward_prob_empty_valid >= 0.0 AND forward_prob_empty_valid <= 1.0),
  forward_prob_valid_empty REAL NOT NULL CHECK (forward_prob_valid_empty >= 0.0 AND forward_prob_valid_empty <= 1.0),

  -- Backward direction: frame2 → frame1
  backward_predicted_label TEXT NOT NULL CHECK (
    backward_predicted_label IN ('same', 'different', 'empty_empty', 'empty_valid', 'valid_empty')
  ),
  backward_confidence REAL NOT NULL CHECK (
    backward_confidence >= 0.0 AND backward_confidence <= 1.0
  ),
  backward_prob_same REAL NOT NULL CHECK (backward_prob_same >= 0.0 AND backward_prob_same <= 1.0),
  backward_prob_different REAL NOT NULL CHECK (backward_prob_different >= 0.0 AND backward_prob_different <= 1.0),
  backward_prob_empty_empty REAL NOT NULL CHECK (backward_prob_empty_empty >= 0.0 AND backward_prob_empty_empty <= 1.0),
  backward_prob_empty_valid REAL NOT NULL CHECK (backward_prob_empty_valid >= 0.0 AND backward_prob_empty_valid <= 1.0),
  backward_prob_valid_empty REAL NOT NULL CHECK (backward_prob_valid_empty >= 0.0 AND backward_prob_valid_empty <= 1.0),

  -- Processing metadata
  processing_time_ms REAL,                   -- Combined time for both directions

  -- Unique constraint (no duplicates)
  UNIQUE(frame1_index, frame2_index)
);

-- Index for efficient frame pair lookups
CREATE INDEX IF NOT EXISTS idx_pair_frames ON pair_results(frame1_index, frame2_index);
