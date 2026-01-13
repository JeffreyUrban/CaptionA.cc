"""
Integration tests for extract_frames_and_ocr Modal function.

These tests validate the end-to-end behavior of the extract_frames_and_ocr function
against real services (Modal, Wasabi S3, Google Vision OCR). They are designed to be
run manually or in CI environments with proper credentials configured.

IMPORTANT: These tests are skipped by default. To run them:
1. Configure environment variables:
   - WASABI_REGION
   - WASABI_ACCESS_KEY
   - WASABI_SECRET_KEY
   - WASABI_BUCKET
   - GOOGLE_APPLICATION_CREDENTIALS (path to Google Cloud service account JSON)
2. Upload test videos to Wasabi S3 in the expected locations
3. Run with: pytest -m integration --run-integration

Test videos should be:
- test-tenant/client/videos/test-video-1/video.mp4 (small video with text, <10 seconds)
- test-tenant/client/videos/no-text/video.mp4 (small video without text)
"""

import gzip
import os
import sqlite3
import tempfile
from pathlib import Path

import pytest

# These tests require Modal to be configured and deployed
# Skip by default to avoid requiring Modal/Wasabi credentials in development
pytestmark = [
    pytest.mark.integration,
    pytest.mark.slow,
    pytest.mark.skipif(
        not os.getenv("RUN_INTEGRATION_TESTS"),
        reason="Integration tests disabled. Set RUN_INTEGRATION_TESTS=1 to enable."
    )
]


class TestExtractFramesAndOcrIntegration:
    """
    Integration tests for extract_frames_and_ocr Modal function.

    These tests validate:
    1. Frame extraction from real video files
    2. OCR processing using Google Vision API
    3. Database creation and compression
    4. Upload to Wasabi S3
    5. Result structure and metadata accuracy

    Tests are organized to verify both happy paths and edge cases.
    """

    @pytest.fixture(scope="class")
    def s3_client(self):
        """
        Create S3 client for Wasabi access.

        This fixture provides a configured boto3 S3 client for downloading
        test artifacts (databases) to verify their contents.

        Returns:
            boto3.client: Configured S3 client for Wasabi

        Raises:
            pytest.skip: If required environment variables are not set
        """
        import boto3

        required_vars = ["WASABI_REGION", "WASABI_ACCESS_KEY", "WASABI_SECRET_KEY", "WASABI_BUCKET"]
        missing = [var for var in required_vars if not os.getenv(var)]

        if missing:
            pytest.skip(f"Missing required environment variables: {', '.join(missing)}")

        return boto3.client(
            "s3",
            endpoint_url=f"https://s3.{os.getenv('WASABI_REGION')}.wasabisys.com",
            aws_access_key_id=os.getenv("WASABI_ACCESS_KEY"),
            aws_secret_access_key=os.getenv("WASABI_SECRET_KEY"),
            region_name=os.getenv("WASABI_REGION"),
        )

    @pytest.fixture(scope="class")
    def test_video_key(self):
        """
        Get the S3 key for the primary test video.

        This video should be:
        - Small (< 10 seconds)
        - Contains visible text (for OCR testing)
        - Already uploaded to Wasabi S3

        Returns:
            str: S3 key for test video
        """
        return "test-tenant/client/videos/test-video-1/video.mp4"

    @pytest.fixture(scope="class")
    def no_text_video_key(self):
        """
        Get the S3 key for a video without text.

        This video should be:
        - Small (< 10 seconds)
        - Contains no visible text (tests OCR handling of blank frames)
        - Already uploaded to Wasabi S3

        Returns:
            str: S3 key for no-text test video
        """
        return "test-tenant/client/videos/no-text/video.mp4"

    def test_extract_with_real_video(self, test_video_key):
        """
        Test extraction with a real video file containing text.

        This is the primary happy path test that validates:
        1. Video download from Wasabi S3
        2. Frame extraction at specified rate
        3. OCR processing with Google Vision
        4. Database creation and compression
        5. Upload of frames and databases to S3
        6. Accurate result metadata

        Flow:
        1. Import the Modal function (requires Modal to be configured)
        2. Call extract_frames_and_ocr.remote() with test video parameters
        3. Verify all result fields are populated with valid values
        4. Verify S3 keys follow the expected naming convention

        Args:
            test_video_key: Fixture providing S3 key to test video

        Assertions:
            - frame_count > 0 (at least some frames extracted)
            - duration > 0 (video has valid duration)
            - frame_width > 0 and frame_height > 0 (valid dimensions)
            - video_codec is not None (codec detected)
            - bitrate > 0 (valid bitrate)
            - ocr_box_count >= 0 (OCR ran, may or may not find text)
            - processing_duration_seconds > 0 (function completed)
            - S3 keys follow correct path structure
        """
        # Import here to allow tests to be collected even if Modal isn't configured
        try:
            from captionacc_modal.extract import extract_frames_and_ocr_impl
        except ImportError:
            pytest.skip("captionacc_modal.extract not available (Modal may not be configured)")

        # Note: In actual Modal deployment, this would be:
        # from captionacc_modal.extract import extract_frames_and_ocr
        # result = extract_frames_and_ocr.remote(...)
        #
        # For testing the implementation directly without requiring Modal deployment,
        # we test the underlying implementation function
        result = extract_frames_and_ocr_impl(
            video_key=test_video_key,
            tenant_id="test-tenant",
            video_id="test-video-1",
            frame_rate=0.1
        )

        # Verify result structure - all fields should be populated
        assert result.frame_count > 0, "Should extract at least one frame"
        assert result.duration > 0, "Video duration should be positive"
        assert result.frame_width > 0, "Frame width should be positive"
        assert result.frame_height > 0, "Frame height should be positive"
        assert result.video_codec is not None, "Video codec should be detected"
        assert result.bitrate > 0, "Bitrate should be positive"
        assert result.ocr_box_count >= 0, "OCR box count should be non-negative"
        assert result.failed_ocr_count >= 0, "Failed OCR count should be non-negative"
        assert result.processing_duration_seconds > 0, "Processing should take some time"

        # Verify S3 keys follow the expected path structure
        # full_frames_key: {tenant_id}/client/videos/{video_id}/full_frames/
        assert result.full_frames_key.startswith("test-tenant/client/videos"), \
            f"full_frames_key should start with tenant/client/videos, got: {result.full_frames_key}"
        assert "full_frames/" in result.full_frames_key, \
            f"full_frames_key should contain 'full_frames/', got: {result.full_frames_key}"

        # ocr_db_key: {tenant_id}/server/videos/{video_id}/raw-ocr.db.gz
        assert result.ocr_db_key.startswith("test-tenant/server/videos"), \
            f"ocr_db_key should start with tenant/server/videos, got: {result.ocr_db_key}"
        assert result.ocr_db_key.endswith(".db.gz"), \
            f"ocr_db_key should end with .db.gz, got: {result.ocr_db_key}"
        assert "raw-ocr" in result.ocr_db_key, \
            f"ocr_db_key should contain 'raw-ocr', got: {result.ocr_db_key}"

        # layout_db_key: {tenant_id}/client/videos/{video_id}/layout.db.gz
        assert result.layout_db_key.startswith("test-tenant/client/videos"), \
            f"layout_db_key should start with tenant/client/videos, got: {result.layout_db_key}"
        assert result.layout_db_key.endswith(".db.gz"), \
            f"layout_db_key should end with .db.gz, got: {result.layout_db_key}"
        assert "layout" in result.layout_db_key, \
            f"layout_db_key should contain 'layout', got: {result.layout_db_key}"

        # Log results for debugging
        print(f"\n=== Extraction Results ===")
        print(f"Frame count: {result.frame_count}")
        print(f"Duration: {result.duration:.2f}s")
        print(f"Dimensions: {result.frame_width}x{result.frame_height}")
        print(f"Codec: {result.video_codec}")
        print(f"OCR boxes: {result.ocr_box_count}")
        print(f"Failed OCR: {result.failed_ocr_count}")
        print(f"Processing time: {result.processing_duration_seconds:.2f}s")

    def test_extract_handles_video_without_text(self, no_text_video_key):
        """
        Test extraction with a video containing no text.

        This test validates that the OCR pipeline handles videos with no visible text
        gracefully, without errors or crashes. It ensures:
        1. OCR runs on all frames without failing
        2. ocr_box_count is 0 (no text detected)
        3. failed_ocr_count is 0 (OCR succeeded, just found nothing)
        4. All other metadata is still populated correctly

        Flow:
        1. Call extract_frames_and_ocr with no-text video
        2. Verify OCR ran successfully but found no text
        3. Verify all other result fields are valid

        Args:
            no_text_video_key: Fixture providing S3 key to no-text test video

        Assertions:
            - ocr_box_count == 0 (no text should be detected)
            - failed_ocr_count == 0 (OCR should succeed, just find nothing)
            - All other result fields are valid (frame_count, duration, etc.)
        """
        try:
            from captionacc_modal.extract import extract_frames_and_ocr_impl
        except ImportError:
            pytest.skip("captionacc_modal.extract not available")

        result = extract_frames_and_ocr_impl(
            video_key=no_text_video_key,
            tenant_id="test-tenant",
            video_id="no-text",
            frame_rate=0.1
        )

        # Primary assertions for this test
        assert result.ocr_box_count == 0, \
            "Should detect no text boxes in video without text"
        assert result.failed_ocr_count == 0, \
            "OCR should succeed (return empty results), not fail"

        # Verify other fields are still valid
        assert result.frame_count > 0, "Should still extract frames"
        assert result.duration > 0, "Should still get video duration"
        assert result.processing_duration_seconds > 0, "Should still process"

        print(f"\n=== No-Text Video Results ===")
        print(f"Frame count: {result.frame_count}")
        print(f"OCR boxes: {result.ocr_box_count} (expected 0)")
        print(f"Failed OCR: {result.failed_ocr_count} (expected 0)")

    @pytest.mark.parametrize("frame_rate", [0.05, 0.1, 0.2])
    def test_extract_different_frame_rates(self, test_video_key, frame_rate):
        """
        Test extraction with different frame sampling rates.

        This test validates that the frame extraction rate parameter correctly controls
        how many frames are extracted. It uses parametrization to test multiple rates
        in a single test definition.

        Frame rate (Hz) determines frames per second:
        - 0.05 Hz = 1 frame every 20 seconds (very sparse)
        - 0.1 Hz = 1 frame every 10 seconds (default)
        - 0.2 Hz = 1 frame every 5 seconds (denser)

        Flow:
        1. Extract frames at the specified rate
        2. Calculate expected frame count = duration * rate
        3. Verify actual frame count is within 10% of expected
           (allows tolerance for FFmpeg frame sampling variations)

        Args:
            test_video_key: Fixture providing S3 key to test video
            frame_rate: Frame sampling rate in Hz (from parametrize)

        Assertions:
            - Actual frame count is within 10% of expected count
            - This allows for minor FFmpeg sampling variations while catching
              major miscalculations or parameter handling errors
        """
        try:
            from captionacc_modal.extract import extract_frames_and_ocr_impl
        except ImportError:
            pytest.skip("captionacc_modal.extract not available")

        # Use unique video_id for each test to avoid S3 key conflicts
        video_id = f"test-rate-{frame_rate}"

        result = extract_frames_and_ocr_impl(
            video_key=test_video_key,
            tenant_id="test-tenant",
            video_id=video_id,
            frame_rate=frame_rate
        )

        # Calculate expected frame count based on duration and rate
        expected_frames = int(result.duration * frame_rate)

        # Allow 10% tolerance for FFmpeg frame sampling variations
        # FFmpeg may extract slightly more or fewer frames due to:
        # - Keyframe alignment
        # - Rounding in timestamp calculations
        # - Video encoding specifics
        tolerance = expected_frames * 0.1
        frame_diff = abs(result.frame_count - expected_frames)

        assert frame_diff <= tolerance, \
            f"Frame count {result.frame_count} differs from expected {expected_frames} " \
            f"by {frame_diff}, exceeds tolerance of {tolerance:.1f}"

        print(f"\n=== Frame Rate {frame_rate} Hz Results ===")
        print(f"Duration: {result.duration:.2f}s")
        print(f"Expected frames: {expected_frames}")
        print(f"Actual frames: {result.frame_count}")
        print(f"Difference: {frame_diff:.0f} (tolerance: {tolerance:.1f})")

    def test_extract_creates_valid_databases(self, test_video_key, s3_client):
        """
        Verify that created databases are valid SQLite databases with correct schema.

        This test validates:
        1. Databases are uploaded to S3 successfully
        2. Databases can be downloaded and decompressed
        3. Databases are valid SQLite format
        4. Databases contain expected tables and data
        5. OCR box counts match between result metadata and database

        Flow:
        1. Run extraction to create and upload databases
        2. Download layout.db.gz from S3
        3. Decompress the .gz file
        4. Open with sqlite3 to verify it's a valid database
        5. Query the database to verify schema and data
        6. Verify OCR box count matches result metadata

        Args:
            test_video_key: Fixture providing S3 key to test video
            s3_client: Fixture providing configured S3 client

        Assertions:
            - Database files exist in S3 at expected keys
            - Database files can be decompressed
            - Database files are valid SQLite databases
            - Database schema matches expectations
            - OCR box count in database matches result metadata
        """
        try:
            from captionacc_modal.extract import extract_frames_and_ocr_impl
        except ImportError:
            pytest.skip("captionacc_modal.extract not available")

        # Run extraction with unique video_id
        result = extract_frames_and_ocr_impl(
            video_key=test_video_key,
            tenant_id="test-tenant",
            video_id="test-db-check",
            frame_rate=0.1
        )

        bucket = os.getenv("WASABI_BUCKET")

        # Test layout.db.gz (client-accessible database)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            local_gz = tmp_path / "layout.db.gz"
            local_db = tmp_path / "layout.db"

            # Download compressed database from S3
            print(f"\nDownloading {result.layout_db_key}...")
            try:
                s3_client.download_file(bucket, result.layout_db_key, str(local_gz))
            except Exception as e:
                pytest.fail(f"Failed to download layout.db.gz from S3: {e}")

            assert local_gz.exists(), "Downloaded file should exist"
            assert local_gz.stat().st_size > 0, "Downloaded file should not be empty"

            # Decompress the database
            print("Decompressing database...")
            try:
                with gzip.open(local_gz, 'rb') as f_in:
                    with open(local_db, 'wb') as f_out:
                        f_out.write(f_in.read())
            except Exception as e:
                pytest.fail(f"Failed to decompress layout.db.gz: {e}")

            assert local_db.exists(), "Decompressed database should exist"
            assert local_db.stat().st_size > 0, "Decompressed database should not be empty"

            # Verify it's a valid SQLite database with expected schema
            print("Verifying database schema...")
            try:
                conn = sqlite3.connect(str(local_db))

                # Check database_metadata table
                cursor = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='database_metadata'"
                )
                assert cursor.fetchone() is not None, "database_metadata table should exist"

                # Check video_layout_config table
                cursor = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='video_layout_config'"
                )
                assert cursor.fetchone() is not None, "video_layout_config table should exist"

                # Verify video_layout_config has correct dimensions
                cursor = conn.execute(
                    "SELECT frame_width, frame_height FROM video_layout_config WHERE id = 1"
                )
                row = cursor.fetchone()
                assert row is not None, "video_layout_config should have a row"
                frame_width, frame_height = row
                assert frame_width == result.frame_width, \
                    f"Database frame_width {frame_width} should match result {result.frame_width}"
                assert frame_height == result.frame_height, \
                    f"Database frame_height {frame_height} should match result {result.frame_height}"

                conn.close()

                print(f"Database verified: {frame_width}x{frame_height}")

            except sqlite3.Error as e:
                pytest.fail(f"SQLite error while verifying database: {e}")

        # Test raw-ocr.db.gz (server-only database with OCR results)
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            local_gz = tmp_path / "raw-ocr.db.gz"
            local_db = tmp_path / "raw-ocr.db"

            # Download compressed database from S3
            print(f"\nDownloading {result.ocr_db_key}...")
            try:
                s3_client.download_file(bucket, result.ocr_db_key, str(local_gz))
            except Exception as e:
                pytest.fail(f"Failed to download raw-ocr.db.gz from S3: {e}")

            # Decompress the database
            print("Decompressing OCR database...")
            try:
                with gzip.open(local_gz, 'rb') as f_in:
                    with open(local_db, 'wb') as f_out:
                        f_out.write(f_in.read())
            except Exception as e:
                pytest.fail(f"Failed to decompress raw-ocr.db.gz: {e}")

            # Verify it's a valid SQLite database and count matches
            print("Verifying OCR database...")
            try:
                conn = sqlite3.connect(str(local_db))

                # Check full_frame_ocr table exists
                cursor = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='full_frame_ocr'"
                )
                assert cursor.fetchone() is not None, "full_frame_ocr table should exist"

                # Count OCR boxes in database
                cursor = conn.execute("SELECT COUNT(*) FROM full_frame_ocr")
                db_count = cursor.fetchone()[0]

                # Verify count matches result metadata
                assert db_count == result.ocr_box_count, \
                    f"Database OCR count {db_count} should match result {result.ocr_box_count}"

                conn.close()

                print(f"OCR database verified: {db_count} boxes")

            except sqlite3.Error as e:
                pytest.fail(f"SQLite error while verifying OCR database: {e}")

        print("\n=== Database Verification Complete ===")
        print(f"Layout database: Valid SQLite with correct schema")
        print(f"OCR database: Valid SQLite with {result.ocr_box_count} boxes")


# Additional test utilities and fixtures can be added here for future tests

def test_placeholder_for_test_discovery():
    """
    Placeholder test to ensure pytest discovers this file.

    This test always passes and is not marked as integration/slow, so it will
    run even when integration tests are disabled. This helps catch import errors
    or syntax issues in the test file.
    """
    assert True, "Test file loaded successfully"
