#!/usr/bin/env python3
"""Test script for FontCLIP embedding extraction on sample videos.

Tests:
1. Reference frame selection from video database
2. Frame loading from full_frames table
3. Font embedding extraction and caching
4. Verify caching works (second call should be instant)
"""

import sys
import time
from pathlib import Path

# Add src to path for direct execution
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from caption_boundaries.data import (
    get_or_create_font_embedding,
    get_reference_frame_stats,
    select_reference_frame,
)
from caption_boundaries.database import init_training_db


def test_video(video_db_path: Path, training_db_path: Path):
    """Test font embedding extraction on a single video."""
    print(f"\n{'='*80}")
    print(f"Testing: {video_db_path}")
    print(f"{'='*80}")

    # 1. Get reference frame statistics
    print("\n1. Analyzing reference frame candidates...")
    try:
        stats = get_reference_frame_stats(video_db_path)
        print(f"   Total frames with OCR: {stats['total_frames']}")
        print(f"   Max OCR boxes in single frame: {stats['max_ocr_boxes']}")
        print(f"   Mean OCR boxes per frame: {stats['mean_ocr_boxes']:.1f}")
        print(f"   Max mean confidence: {stats['max_confidence']:.3f}")
        print(f"   Frames with >=10 boxes: {stats['frames_above_threshold']}")
    except Exception as e:
        print(f"   ❌ Error getting stats: {e}")
        return False

    # 2. Select reference frame
    print("\n2. Selecting reference frame...")
    try:
        reference_frame = select_reference_frame(video_db_path)
        if reference_frame is None:
            print("   ❌ No suitable reference frames found")
            return False

        print(f"   ✓ Selected frame {reference_frame.frame_index}")
        print(f"     - OCR boxes: {reference_frame.num_ocr_boxes}")
        print(f"     - Mean confidence: {reference_frame.mean_confidence:.3f}")
    except Exception as e:
        print(f"   ❌ Error selecting frame: {e}")
        return False

    # 3. Extract font embedding (first time - should compute)
    print("\n3. Extracting font embedding (first time)...")
    try:
        start_time = time.time()
        embedding1 = get_or_create_font_embedding(video_db_path, training_db_path)
        elapsed1 = time.time() - start_time

        print(f"   ✓ Embedding extracted in {elapsed1:.2f}s")
        print(f"     - Dimension: {embedding1.embedding_dim}")
        print(f"     - Model version: {embedding1.fontclip_model_version}")
        print(f"     - Reference frame: {embedding1.reference_frame_index}")
        print(f"     - Embedding size: {len(embedding1.embedding):,} bytes")
    except Exception as e:
        print(f"   ❌ Error extracting embedding: {e}")
        import traceback

        traceback.print_exc()
        return False

    # 4. Extract font embedding (second time - should use cache)
    print("\n4. Extracting font embedding (second time - from cache)...")
    try:
        start_time = time.time()
        embedding2 = get_or_create_font_embedding(video_db_path, training_db_path)
        elapsed2 = time.time() - start_time

        print(f"   ✓ Retrieved from cache in {elapsed2:.2f}s")
        print(f"     - Speedup: {elapsed1/elapsed2:.1f}x faster")

        # Verify it's the same embedding
        assert embedding1.id == embedding2.id, "Different embedding IDs!"
        assert embedding1.embedding == embedding2.embedding, "Different embeddings!"
        print("   ✓ Cache verification passed")

    except Exception as e:
        print(f"   ❌ Error with cache: {e}")
        return False

    print(f"\n{'✓'*40}")
    print("All tests passed!")
    print(f"{'✓'*40}\n")
    return True


def main():
    """Run tests on sample videos."""
    # Use default training database location
    training_db_path = Path(__file__).parent.parent.parent.parent / "local" / "caption_boundaries_training.db"

    print(f"Training database: {training_db_path}")

    # Initialize training database if it doesn't exist or is empty
    if not training_db_path.exists():
        print("Initializing training database...")
        init_training_db(training_db_path)
        print("✓ Database initialized\n")
    elif training_db_path.stat().st_size == 0:
        print("Database file empty, recreating tables...")
        init_training_db(training_db_path, force=True)
        print("✓ Database initialized\n")
    else:
        print("✓ Database exists\n")

    # Find sample video databases
    data_dir = Path(__file__).parent.parent.parent.parent / "local" / "data"

    if not data_dir.exists():
        print(f"❌ Data directory not found: {data_dir}")
        sys.exit(1)

    # Find first 3 video databases
    video_dbs = sorted(data_dir.glob("*/*/annotations.db"))[:3]

    if not video_dbs:
        print(f"❌ No video databases found in {data_dir}")
        sys.exit(1)

    print(f"Found {len(video_dbs)} sample videos to test")

    # Test each video
    results = []
    for video_db in video_dbs:
        success = test_video(video_db, training_db_path)
        results.append((video_db, success))

    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    for video_db, success in results:
        status = "✓ PASS" if success else "❌ FAIL"
        print(f"{status}: {video_db.parent.parent.name}/{video_db.parent.name}")

    total_passed = sum(1 for _, success in results if success)
    print(f"\nTotal: {total_passed}/{len(results)} passed")

    if total_passed == len(results):
        print("\n🎉 All tests passed!")
        sys.exit(0)
    else:
        print(f"\n❌ {len(results) - total_passed} test(s) failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
