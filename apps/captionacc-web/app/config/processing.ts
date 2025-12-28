/**
 * Video Processing Configuration
 *
 * Tune these settings based on your system resources (CPU cores, RAM, disk I/O)
 */

/**
 * Maximum concurrent video processing jobs across ALL pipelines
 *
 * This includes:
 * - full_frames: Background processing of newly uploaded videos (frame extraction + OCR + layout analysis)
 * - crop_frames: User-initiated frame cropping after layout approval
 *
 * TUNING GUIDE:
 * - Each job uses significant CPU (ffmpeg, OCR) and disk I/O
 * - Start with 2 for most systems
 * - Increase to 3-4 if you have 8+ cores and 16+ GB RAM
 * - Decrease to 1 if processing causes system slowdowns or crashes
 * - Monitor: CPU usage, memory, disk I/O during processing
 *
 * CRASH PREVENTION:
 * - Too high → system resource exhaustion → server crash
 * - Too low → slow processing but stable system
 * - When in doubt, err on the conservative side
 */
export const MAX_TOTAL_CONCURRENT_PROCESSING = 2
