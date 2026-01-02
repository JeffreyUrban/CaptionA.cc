-- Migration: Drop cropped_frame_ocr table
-- This table is no longer used. OCR data is available from full_frame_ocr.

DROP TABLE IF EXISTS cropped_frame_ocr;
