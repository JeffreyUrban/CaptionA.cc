-- Migration: Add ocr_visualization_image to video_layout_config
-- Stores PNG visualization of OCR boxes cropped to caption bounds

-- Add column for OCR visualization image
ALTER TABLE video_layout_config ADD COLUMN ocr_visualization_image BLOB;
