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


# Concrete implementation placeholder
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

    # Implement all methods from CaptionService protocol
