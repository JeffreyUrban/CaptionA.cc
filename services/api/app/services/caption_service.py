"""
Caption database management service.
Handles operations on captions.db files stored in Wasabi.
"""
from typing import Optional, Protocol


class CaptionService(Protocol):
    """
    Interface for caption database operations.

    Caption data is stored in captions.db.gz files in Wasabi.
    This service manages download/modify/upload cycles for these files.

    Note:
        Flows call internal API endpoints which use this service.
        The API decides when to download and when to upload based on:
        - Caching strategy
        - Concurrent request handling
        - Transaction boundaries
    """

    def update_caption_ocr(
        self,
        video_id: str,
        tenant_id: str,
        caption_id: int,
        ocr_text: str,
        confidence: float,
    ) -> None:
        """
        Update caption OCR text in captions.db.

        Args:
            video_id: Video UUID
            tenant_id: Tenant UUID (for path scoping)
            caption_id: Caption record ID
            ocr_text: OCR text result
            confidence: OCR confidence score (0.0 to 1.0)

        Implementation:
            1. Download captions.db.gz from Wasabi (if not cached)
            2. Decompress to SQLite
            3. Update caption record with OCR text and confidence
            4. Compress to gzip
            5. Upload to Wasabi
            6. Invalidate client caches (trigger CR-SQLite sync)

        Note:
            captions.db contains the OCR text for offline client access.
            This is the authoritative source for caption content.
        """
        ...

    def update_caption_status(
        self,
        video_id: str,
        tenant_id: str,
        caption_id: int,
        status: str,
        error_message: Optional[str] = None,
    ) -> None:
        """
        Update caption processing status.

        Args:
            video_id: Video UUID
            tenant_id: Tenant UUID
            caption_id: Caption record ID
            status: Processing status (queued, processing, completed, error)
            error_message: Error message if status is 'error'

        Note:
            This may also update Supabase for real-time status updates to client.
        """
        ...


# Concrete implementation
class CaptionServiceImpl:
    """
    Concrete implementation of CaptionService.

    Manages captions.db files with caching and transaction support.
    """

    def __init__(self, wasabi_service, supabase_service):
        """
        Initialize caption service.

        Args:
            wasabi_service: Wasabi S3 service for file operations
            supabase_service: Supabase service for real-time updates
        """
        self.wasabi = wasabi_service
        self.supabase = supabase_service
        # TODO: Add caching layer

    def update_caption_ocr(
        self,
        video_id: str,
        tenant_id: str,
        caption_id: int,
        ocr_text: str,
        confidence: float,
    ) -> None:
        """
        Update caption OCR text in captions.db.

        Args:
            video_id: Video UUID
            tenant_id: Tenant UUID (for path scoping)
            caption_id: Caption record ID
            ocr_text: OCR text result
            confidence: OCR confidence score (0.0 to 1.0)

        Implementation:
            1. Download captions.db.gz from Wasabi (if not cached)
            2. Decompress to SQLite
            3. Update caption record with OCR text and confidence
            4. Compress to gzip
            5. Upload to Wasabi
            6. Invalidate client caches (trigger CR-SQLite sync)
        """
        import gzip
        import sqlite3
        import tempfile
        from datetime import datetime
        from pathlib import Path

        # Generate S3 key
        s3_key = f"{tenant_id}/client/videos/{video_id}/captions.db.gz"

        # Create temporary file for local processing
        with tempfile.TemporaryDirectory() as temp_dir:
            local_db_path = Path(temp_dir) / "captions.db"
            local_gz_path = Path(temp_dir) / "captions.db.gz"

            # Download compressed database from Wasabi
            self.wasabi.download_file(s3_key, str(local_gz_path))

            # Decompress
            with gzip.open(local_gz_path, "rb") as f_in:
                with open(local_db_path, "wb") as f_out:
                    f_out.write(f_in.read())

            # Update caption in SQLite
            conn = sqlite3.connect(str(local_db_path))
            try:
                conn.execute(
                    """
                    UPDATE captions
                    SET caption_ocr = ?,
                        caption_ocr_status = 'completed',
                        caption_ocr_processed_at = ?,
                        text_pending = 1
                    WHERE id = ?
                    """,
                    (ocr_text, datetime.utcnow().isoformat(), caption_id),
                )
                conn.commit()
            finally:
                conn.close()

            # Compress updated database
            with open(local_db_path, "rb") as f_in:
                with gzip.open(local_gz_path, "wb", compresslevel=6) as f_out:
                    f_out.write(f_in.read())

            # Upload back to Wasabi
            self.wasabi.upload_from_path(
                s3_key,
                str(local_gz_path),
                content_type="application/gzip",
            )

        # TODO: Trigger CR-SQLite sync notification for clients

    def update_caption_status(
        self,
        video_id: str,
        tenant_id: str,
        caption_id: int,
        status: str,
        error_message: Optional[str] = None,
    ) -> None:
        """
        Update caption processing status.

        Args:
            video_id: Video UUID
            tenant_id: Tenant UUID
            caption_id: Caption record ID
            status: Processing status (queued, processing, completed, error)
            error_message: Error message if status is 'error'

        Note:
            This may also update Supabase for real-time status updates to client.
        """
        import gzip
        import sqlite3
        import tempfile
        from pathlib import Path

        # Generate S3 key
        s3_key = f"{tenant_id}/client/videos/{video_id}/captions.db.gz"

        # Create temporary file for local processing
        with tempfile.TemporaryDirectory() as temp_dir:
            local_db_path = Path(temp_dir) / "captions.db"
            local_gz_path = Path(temp_dir) / "captions.db.gz"

            # Download compressed database from Wasabi
            self.wasabi.download_file(s3_key, str(local_gz_path))

            # Decompress
            with gzip.open(local_gz_path, "rb") as f_in:
                with open(local_db_path, "wb") as f_out:
                    f_out.write(f_in.read())

            # Update caption status in SQLite
            conn = sqlite3.connect(str(local_db_path))
            try:
                if error_message:
                    conn.execute(
                        """
                        UPDATE captions
                        SET caption_ocr_status = ?,
                            caption_ocr_error = ?
                        WHERE id = ?
                        """,
                        (status, error_message, caption_id),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE captions
                        SET caption_ocr_status = ?
                        WHERE id = ?
                        """,
                        (status, caption_id),
                    )
                conn.commit()
            finally:
                conn.close()

            # Compress updated database
            with open(local_db_path, "rb") as f_in:
                with gzip.open(local_gz_path, "wb", compresslevel=6) as f_out:
                    f_out.write(f_in.read())

            # Upload back to Wasabi
            self.wasabi.upload_from_path(
                s3_key,
                str(local_gz_path),
                content_type="application/gzip",
            )

        # TODO: Update Supabase for real-time status notification if needed
