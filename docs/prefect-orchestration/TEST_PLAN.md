# Prefect Orchestration Test Plan

**Status:** Ready for Implementation
**Date:** 2026-01-12
**Version:** 1.1 (Revised to focus on our implementation)

---

## Testing Philosophy: Our Code, Not Prefect

**IMPORTANT:** This test plan focuses exclusively on testing **our implementation**, not Prefect's functionality.

### What We Test ✅
- **Our business logic:** Priority calculation, lock management, data transformations
- **Our integration code:** How we call Prefect API, Modal functions, Supabase, Wasabi
- **Our flow orchestration:** The steps our flows take, error handling, status updates
- **Our error handling:** How we recover from failures in external services

### What We Don't Test ❌
- **Prefect's scheduling:** We trust Prefect schedules flows correctly
- **Prefect's priority queues:** We trust Prefect honors priority values
- **Prefect's worker reliability:** We trust Prefect workers execute flows
- **External service correctness:** We trust Supabase, Wasabi, Modal work as documented

### Testing Approach
1. **Unit tests:** Mock all external services, test our logic in isolation
2. **Integration tests:** Mock external responses, verify we call them correctly
3. **E2E tests:** Execute our flows directly (bypass Prefect scheduling), use real services

**Key Principle:** We test the boundary - that we integrate correctly with external services - not the services themselves.

---

## Overview

This document provides a comprehensive test plan for the Prefect orchestration system, covering all integration levels from unit tests to production validation.

### Test Pyramid Strategy

```
                  ┌─────────────┐
                  │  Manual E2E │  (5%)
                  │   Testing   │
                  └─────────────┘
              ┌───────────────────┐
              │  Automated E2E    │  (15%)
              │  Integration      │
              └───────────────────┘
          ┌───────────────────────────┐
          │  Service Integration      │  (30%)
          │  Tests                    │
          └───────────────────────────┘
      ┌───────────────────────────────────┐
      │  Unit Tests                       │  (50%)
      │                                   │
      └───────────────────────────────────┘
```

---

## Level 1: Unit Tests

### 1.1 Priority Service Tests

**File:** `/services/api/tests/unit/services/test_priority_service.py`

#### Test Cases

```python
import pytest
from datetime import datetime, timezone, timedelta
from app.services.priority_service import (
    calculate_flow_priority,
    get_priority_tags,
    TenantTier
)


class TestCalculateFlowPriority:
    """Test priority calculation logic."""

    def test_base_priority_free_tier(self):
        """Free tier gets base priority of 50."""
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=None,
            enable_age_boosting=False
        )
        assert priority == 50

    def test_base_priority_premium_tier(self):
        """Premium tier gets base priority of 70."""
        priority = calculate_flow_priority(
            tenant_tier="premium",
            request_time=None,
            enable_age_boosting=False
        )
        assert priority == 70

    def test_base_priority_enterprise_tier(self):
        """Enterprise tier gets base priority of 90."""
        priority = calculate_flow_priority(
            tenant_tier="enterprise",
            request_time=None,
            enable_age_boosting=False
        )
        assert priority == 90

    def test_age_boosting_disabled(self):
        """Age boosting can be disabled."""
        old_time = datetime.now(timezone.utc) - timedelta(hours=5)
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=old_time,
            enable_age_boosting=False
        )
        assert priority == 50  # No boost applied

    def test_age_boosting_60_minutes(self):
        """Age boosting adds 1 point per 60 minutes."""
        old_time = datetime.now(timezone.utc) - timedelta(minutes=120)
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=20
        )
        assert priority == 52  # 50 + 2 (120 minutes / 60)

    def test_age_boosting_cap(self):
        """Age boosting respects the cap."""
        old_time = datetime.now(timezone.utc) - timedelta(hours=50)
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=20
        )
        assert priority == 70  # 50 + 20 (capped)

    def test_base_priority_override(self):
        """Base priority can be overridden."""
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=None,
            enable_age_boosting=False,
            base_priority_override=100
        )
        assert priority == 100

    def test_custom_boost_parameters(self):
        """Custom boost parameters work correctly."""
        old_time = datetime.now(timezone.utc) - timedelta(minutes=300)
        priority = calculate_flow_priority(
            tenant_tier="premium",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=30,  # +1 per 30 min
            age_boost_cap=15
        )
        # 70 + min(300/30, 15) = 70 + 10 = 80
        assert priority == 80


class TestGetPriorityTags:
    """Test priority tag generation."""

    def test_tags_with_age_boosting_enabled(self):
        """Tags include age boosting status."""
        tags = get_priority_tags(
            tenant_id="tenant-123",
            tenant_tier="premium",
            priority=75,
            enable_age_boosting=True
        )

        assert "tenant:tenant-123" in tags
        assert "tier:premium" in tags
        assert "priority:75" in tags
        assert "age-boosting:enabled" in tags

    def test_tags_with_age_boosting_disabled(self):
        """Tags reflect disabled age boosting."""
        tags = get_priority_tags(
            tenant_id="tenant-456",
            tenant_tier="free",
            priority=50,
            enable_age_boosting=False
        )

        assert "age-boosting:disabled" in tags
```

**Coverage Goal:** 100%
**Mocking:** None required (pure functions)
**Run Time:** < 1 second

---

### 1.2 Supabase Service Tests

**File:** `/services/api/tests/unit/services/test_supabase_service.py`

#### Test Cases

```python
import pytest
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timezone
from app.services.supabase_service import SupabaseServiceImpl


@pytest.fixture
def mock_supabase_client():
    """Mock Supabase client with fluent interface."""
    client = Mock()

    # Mock fluent chain: client.schema().table().select()...
    schema_mock = Mock()
    table_mock = Mock()
    query_mock = Mock()

    client.schema.return_value = schema_mock
    schema_mock.table.return_value = table_mock
    table_mock.select.return_value = query_mock
    table_mock.update.return_value = query_mock
    table_mock.insert.return_value = query_mock
    query_mock.eq.return_value = query_mock
    query_mock.maybe_single.return_value = query_mock
    query_mock.single.return_value = query_mock
    query_mock.execute.return_value = Mock(data=None)

    return client


@pytest.fixture
def supabase_service(mock_supabase_client):
    """Create service with mocked client."""
    with patch('app.services.supabase_service.create_client') as mock_create:
        mock_create.return_value = mock_supabase_client
        service = SupabaseServiceImpl(
            supabase_url="https://test.supabase.co",
            supabase_key="test-key",
            schema="test_schema"
        )
        service.client = mock_supabase_client
        return service


class TestUpdateVideoStatus:
    """Test video status updates."""

    def test_update_status_only(self, supabase_service, mock_supabase_client):
        """Update only status field."""
        supabase_service.update_video_status(
            video_id="video-123",
            status="processing"
        )

        # Verify update was called with correct data
        call_args = mock_supabase_client.schema().table().update.call_args
        assert call_args[0][0] == {"status": "processing"}

    def test_update_multiple_fields(self, supabase_service, mock_supabase_client):
        """Update multiple fields."""
        supabase_service.update_video_status(
            video_id="video-123",
            status="active",
            caption_status="ready"
        )

        call_args = mock_supabase_client.schema().table().update.call_args
        data = call_args[0][0]
        assert data["status"] == "active"
        # Note: caption_status not in current schema


class TestAcquireServerLock:
    """Test server lock acquisition."""

    def test_lock_acquisition_success_no_existing_state(
        self, supabase_service, mock_supabase_client
    ):
        """Successfully acquire lock when no state exists."""
        # Mock no existing state
        video_response = Mock(data={"tenant_id": "tenant-123"})
        state_response = Mock(data=None)

        mock_supabase_client.schema().table().select().eq().maybe_single().execute.side_effect = [
            state_response,  # video_database_state query
            video_response   # videos query
        ]

        result = supabase_service.acquire_server_lock(
            video_id="video-123",
            database_name="layout"
        )

        assert result is True
        # Verify insert was called
        assert mock_supabase_client.schema().table().insert.called

    def test_lock_acquisition_success_unlocked_state_exists(
        self, supabase_service, mock_supabase_client
    ):
        """Successfully acquire lock when state exists but unlocked."""
        state_response = Mock(data={
            "lock_holder_user_id": None,
            "lock_type": None,
            "tenant_id": "tenant-123"
        })

        mock_supabase_client.schema().table().select().eq().maybe_single().execute.return_value = state_response

        result = supabase_service.acquire_server_lock(
            video_id="video-123",
            database_name="layout"
        )

        assert result is True
        # Verify update was called
        assert mock_supabase_client.schema().table().update.called

    def test_lock_acquisition_fails_already_locked(
        self, supabase_service, mock_supabase_client
    ):
        """Fail to acquire lock when already held."""
        state_response = Mock(data={
            "lock_holder_user_id": "user-456",
            "lock_type": "server",
            "tenant_id": "tenant-123"
        })

        mock_supabase_client.schema().table().select().eq().maybe_single().execute.return_value = state_response

        result = supabase_service.acquire_server_lock(
            video_id="video-123",
            database_name="layout"
        )

        assert result is False
        # Verify no update attempt
        assert not mock_supabase_client.schema().table().update.called


class TestGetTenantTier:
    """Test tenant tier lookup."""

    def test_tier_mapping_demo(self, supabase_service, mock_supabase_client):
        """Demo access tier maps to free."""
        response = Mock(data={"access_tier_id": "demo"})
        mock_supabase_client.schema().table().select().eq().limit().maybe_single().execute.return_value = response

        tier = supabase_service.get_tenant_tier("tenant-123")
        assert tier == "free"

    def test_tier_mapping_active(self, supabase_service, mock_supabase_client):
        """Active access tier maps to premium."""
        response = Mock(data={"access_tier_id": "active"})
        mock_supabase_client.schema().table().select().eq().limit().maybe_single().execute.return_value = response

        tier = supabase_service.get_tenant_tier("tenant-123")
        assert tier == "premium"

    def test_default_tier_no_users(self, supabase_service, mock_supabase_client):
        """Default to free when no users found."""
        response = Mock(data=None)
        mock_supabase_client.schema().table().select().eq().limit().maybe_single().execute.return_value = response

        tier = supabase_service.get_tenant_tier("tenant-123")
        assert tier == "free"
```

**Coverage Goal:** 90%
**Mocking:** Supabase client responses
**Run Time:** < 2 seconds

---

### 1.3 Wasabi Service Tests

**File:** `/services/api/tests/unit/services/test_wasabi_service.py`

#### Test Cases

```python
import pytest
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path
from botocore.exceptions import ClientError
from app.services.wasabi_service import WasabiServiceImpl


@pytest.fixture
def mock_s3_client():
    """Mock boto3 S3 client."""
    return Mock()


@pytest.fixture
def wasabi_service(mock_s3_client):
    """Create service with mocked S3 client."""
    with patch('app.services.wasabi_service.boto3.client') as mock_boto:
        mock_boto.return_value = mock_s3_client
        service = WasabiServiceImpl(
            access_key="test-access",
            secret_key="test-secret",
            bucket="test-bucket",
            region="us-east-1"
        )
        service.s3_client = mock_s3_client
        return service


class TestUploadFile:
    """Test file upload operations."""

    def test_upload_bytes(self, wasabi_service, mock_s3_client):
        """Upload bytes data."""
        data = b"test data"
        key = wasabi_service.upload_file(
            key="test/file.txt",
            data=data,
            content_type="text/plain"
        )

        assert key == "test/file.txt"
        assert mock_s3_client.upload_fileobj.called

        call_args = mock_s3_client.upload_fileobj.call_args
        assert call_args[1]["Bucket"] == "test-bucket"
        assert call_args[1]["Key"] == "test/file.txt"
        assert call_args[1]["ExtraArgs"]["ContentType"] == "text/plain"

    def test_upload_file_object(self, wasabi_service, mock_s3_client):
        """Upload file-like object."""
        import io
        file_obj = io.BytesIO(b"test data")

        key = wasabi_service.upload_file(
            key="test/file.txt",
            data=file_obj
        )

        assert key == "test/file.txt"
        assert mock_s3_client.upload_fileobj.called


class TestDownloadFile:
    """Test file download operations."""

    def test_download_to_path(self, wasabi_service, mock_s3_client, tmp_path):
        """Download file to local path."""
        local_path = tmp_path / "downloaded.txt"

        wasabi_service.download_file(
            key="test/file.txt",
            local_path=str(local_path)
        )

        assert mock_s3_client.download_file.called
        call_args = mock_s3_client.download_file.call_args
        assert call_args[0][0] == "test-bucket"
        assert call_args[0][1] == "test/file.txt"

    def test_download_creates_parent_dirs(
        self, wasabi_service, mock_s3_client, tmp_path
    ):
        """Download creates parent directories."""
        local_path = tmp_path / "nested" / "dir" / "file.txt"

        wasabi_service.download_file(
            key="test/file.txt",
            local_path=str(local_path)
        )

        assert local_path.parent.exists()


class TestDeletePrefix:
    """Test bulk delete operations."""

    def test_delete_prefix_single_page(self, wasabi_service, mock_s3_client):
        """Delete all files with prefix (single page)."""
        # Mock paginator
        paginator = Mock()
        mock_s3_client.get_paginator.return_value = paginator

        pages = [
            {"Contents": [
                {"Key": "tenant/video/file1.jpg"},
                {"Key": "tenant/video/file2.jpg"}
            ]}
        ]
        paginator.paginate.return_value = pages

        count = wasabi_service.delete_prefix("tenant/video/")

        assert count == 2
        assert mock_s3_client.delete_objects.called

        call_args = mock_s3_client.delete_objects.call_args
        deleted_objects = call_args[1]["Delete"]["Objects"]
        assert len(deleted_objects) == 2

    def test_delete_prefix_no_files(self, wasabi_service, mock_s3_client):
        """Delete with no matching files."""
        paginator = Mock()
        mock_s3_client.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{}]  # No Contents key

        count = wasabi_service.delete_prefix("tenant/video/")

        assert count == 0
        assert not mock_s3_client.delete_objects.called


class TestFileExists:
    """Test file existence checks."""

    def test_file_exists_true(self, wasabi_service, mock_s3_client):
        """File exists returns True."""
        mock_s3_client.head_object.return_value = {"ContentLength": 100}

        exists = wasabi_service.file_exists("test/file.txt")

        assert exists is True

    def test_file_exists_false(self, wasabi_service, mock_s3_client):
        """File not found returns False."""
        mock_s3_client.head_object.side_effect = ClientError(
            {"Error": {"Code": "404"}}, "HeadObject"
        )

        exists = wasabi_service.file_exists("test/missing.txt")

        assert exists is False
```

**Coverage Goal:** 85%
**Mocking:** boto3 S3 client
**Run Time:** < 2 seconds

---

## Level 2: Service Integration Tests

### 2.1 Modal Function Integration Tests

**File:** `/data-pipelines/captionacc-modal/tests/integration/test_extract.py`

#### Test Cases

```python
import pytest
import modal
from pathlib import Path
from captionacc_modal.extract import extract_frames_and_ocr


@pytest.mark.integration
@pytest.mark.slow
class TestExtractFramesAndOcrIntegration:
    """Integration tests for extract_frames_and_ocr Modal function."""

    @pytest.fixture
    def test_video_key(self):
        """Upload test video to Wasabi for testing."""
        # Upload small test video (< 10 seconds)
        return "test-tenant/client/videos/test-video-1/video.mp4"

    def test_extract_with_real_video(self, test_video_key):
        """Test extraction with real video file."""
        with modal.enable_remote_debugging():
            result = extract_frames_and_ocr.remote(
                video_key=test_video_key,
                tenant_id="test-tenant",
                video_id="test-video-1",
                frame_rate=0.1
            )

        # Verify result structure
        assert result.frame_count > 0
        assert result.duration > 0
        assert result.frame_width > 0
        assert result.frame_height > 0
        assert result.video_codec is not None
        assert result.bitrate > 0
        assert result.ocr_box_count >= 0
        assert result.processing_duration_seconds > 0

        # Verify S3 keys
        assert result.full_frames_key.startswith("test-tenant/client/videos")
        assert result.ocr_db_key.endswith(".db.gz")
        assert result.layout_db_key.endswith(".db.gz")

    def test_extract_handles_video_without_text(self, test_video_key):
        """Test extraction with video containing no text."""
        # Use test video with no text overlay
        result = extract_frames_and_ocr.remote(
            video_key="test-tenant/client/videos/no-text/video.mp4",
            tenant_id="test-tenant",
            video_id="no-text",
            frame_rate=0.1
        )

        assert result.ocr_box_count == 0
        assert result.failed_ocr_count == 0

    @pytest.mark.parametrize("frame_rate", [0.05, 0.1, 0.2])
    def test_extract_different_frame_rates(self, test_video_key, frame_rate):
        """Test extraction with different frame rates."""
        result = extract_frames_and_ocr.remote(
            video_key=test_video_key,
            tenant_id="test-tenant",
            video_id=f"test-rate-{frame_rate}",
            frame_rate=frame_rate
        )

        expected_frames = int(result.duration * frame_rate)
        # Allow 10% tolerance
        assert abs(result.frame_count - expected_frames) <= expected_frames * 0.1

    def test_extract_creates_valid_databases(self, test_video_key):
        """Verify created databases are valid SQLite."""
        import sqlite3
        import tempfile
        import gzip
        from wasabi_service import WasabiServiceImpl

        result = extract_frames_and_ocr.remote(
            video_key=test_video_key,
            tenant_id="test-tenant",
            video_id="test-db-check",
            frame_rate=0.1
        )

        # Download and verify layout.db
        wasabi = WasabiServiceImpl(...)
        with tempfile.TemporaryDirectory() as tmp_dir:
            local_gz = Path(tmp_dir) / "layout.db.gz"
            local_db = Path(tmp_dir) / "layout.db"

            wasabi.download_file(result.layout_db_key, str(local_gz))

            # Decompress
            with gzip.open(local_gz, 'rb') as f_in:
                with open(local_db, 'wb') as f_out:
                    f_out.write(f_in.read())

            # Verify SQLite database
            conn = sqlite3.connect(str(local_db))
            cursor = conn.execute("SELECT COUNT(*) FROM ocr_detections")
            count = cursor.fetchone()[0]
            conn.close()

            assert count == result.ocr_box_count
```

**Coverage Goal:** N/A (integration test)
**Dependencies:** Modal account, Wasabi credentials, test videos
**Run Time:** 2-5 minutes per test
**Run Frequency:** Pre-deployment only

---

### 2.2 Prefect Flow Integration Tests

**File:** `/services/api/tests/integration/flows/test_video_initial_processing.py`

#### Test Cases

```python
import pytest
from unittest.mock import Mock, patch, AsyncMock
from app.flows.video_initial_processing import video_initial_processing


@pytest.mark.integration
class TestVideoInitialProcessingFlow:
    """Integration tests for video initial processing flow."""

    @pytest.fixture
    def mock_services(self):
        """Mock all external services."""
        with patch('app.flows.video_initial_processing.SupabaseServiceImpl') as mock_supabase, \
             patch('app.flows.video_initial_processing.modal') as mock_modal:

            supabase = Mock()
            supabase.update_video_status = Mock()
            supabase.update_video_metadata = Mock()
            mock_supabase.return_value = supabase

            # Mock Modal function
            extract_result = Mock(
                frame_count=100,
                duration=10.0,
                frame_width=1920,
                frame_height=1080,
                video_codec="h264",
                bitrate=5000000,
                ocr_box_count=50,
                failed_ocr_count=0,
                processing_duration_seconds=45.0,
                full_frames_key="tenant/client/videos/video-1/full_frames/",
                ocr_db_key="tenant/server/videos/video-1/raw-ocr.db.gz",
                layout_db_key="tenant/server/videos/video-1/layout.db.gz"
            )

            mock_modal.Function.lookup.return_value.remote.return_value = extract_result

            yield {
                "supabase": supabase,
                "modal": mock_modal,
                "extract_result": extract_result
            }

    @pytest.mark.asyncio
    async def test_flow_success(self, mock_services):
        """Test successful flow execution."""
        result = await video_initial_processing(
            video_id="video-123",
            tenant_id="tenant-456",
            storage_key="tenant-456/client/videos/video-123/video.mp4"
        )

        # Verify flow completed
        assert result["status"] == "success"
        assert result["frame_count"] == 100
        assert result["duration"] == 10.0

        # Verify status updates
        supabase = mock_services["supabase"]
        assert supabase.update_video_status.call_count == 2

        # First call: set to processing
        first_call = supabase.update_video_status.call_args_list[0]
        assert first_call[1]["status"] == "processing"

        # Second call: set to active
        second_call = supabase.update_video_status.call_args_list[1]
        assert second_call[1]["status"] == "active"

        # Verify metadata update
        assert supabase.update_video_metadata.called
        metadata_call = supabase.update_video_metadata.call_args
        assert metadata_call[1]["frame_count"] == 100
        assert metadata_call[1]["duration_seconds"] == 10.0

    @pytest.mark.asyncio
    async def test_flow_handles_modal_failure(self, mock_services):
        """Test flow handles Modal function failure."""
        # Mock Modal failure
        mock_services["modal"].Function.lookup.return_value.remote.side_effect = Exception(
            "Modal function failed: GPU timeout"
        )

        with pytest.raises(Exception) as exc_info:
            await video_initial_processing(
                video_id="video-123",
                tenant_id="tenant-456",
                storage_key="tenant-456/client/videos/video-123/video.mp4"
            )

        assert "GPU timeout" in str(exc_info.value)

        # Verify error status was set
        supabase = mock_services["supabase"]
        error_calls = [
            call for call in supabase.update_video_status.call_args_list
            if call[1].get("status") == "error"
        ]
        assert len(error_calls) > 0

    @pytest.mark.asyncio
    async def test_flow_handles_supabase_failure(self, mock_services):
        """Test flow handles Supabase update failure."""
        # Mock Supabase failure
        mock_services["supabase"].update_video_metadata.side_effect = Exception(
            "Database connection failed"
        )

        with pytest.raises(Exception) as exc_info:
            await video_initial_processing(
                video_id="video-123",
                tenant_id="tenant-456",
                storage_key="tenant-456/client/videos/video-123/video.mp4"
            )

        assert "Database connection failed" in str(exc_info.value)
```

**Coverage Goal:** 80%
**Dependencies:** Prefect, mocked services
**Run Time:** < 5 seconds
**Run Frequency:** Every commit

---

### 2.3 API Endpoint Integration Tests

**File:** `/services/api/tests/integration/routers/test_webhooks.py`

#### Test Cases

```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, Mock
from app.main import app


@pytest.fixture
def client():
    """Test client for API."""
    return TestClient(app)


@pytest.fixture
def mock_prefect_api():
    """Mock Prefect API responses."""
    with patch('httpx.AsyncClient') as mock_client:
        mock_async_client = Mock()
        mock_client.return_value.__aenter__.return_value = mock_async_client

        # Mock successful flow run creation
        mock_response = Mock()
        mock_response.status_code = 201
        mock_response.json.return_value = {
            "id": "flow-run-123",
            "state": {"type": "SCHEDULED"}
        }
        mock_async_client.post.return_value = mock_response

        yield mock_async_client


@pytest.mark.integration
class TestWebhooksRouter:
    """Integration tests for webhooks router."""

    def test_webhook_auth_missing(self, client):
        """Test webhook without auth header."""
        response = client.post(
            "/webhooks/supabase/videos",
            json={"type": "INSERT", "table": "videos", "record": {}}
        )

        assert response.status_code == 401
        assert "Unauthorized" in response.json()["detail"]

    def test_webhook_auth_invalid(self, client):
        """Test webhook with invalid auth."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer wrong-secret"},
            json={"type": "INSERT", "table": "videos", "record": {}}
        )

        assert response.status_code == 401

    @patch.dict('os.environ', {'WEBHOOK_SECRET': 'test-secret'})
    def test_webhook_invalid_payload(self, client):
        """Test webhook with invalid payload."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={"invalid": "payload"}
        )

        assert response.status_code == 400

    @patch.dict('os.environ', {'WEBHOOK_SECRET': 'test-secret'})
    def test_webhook_non_insert_event(self, client):
        """Test webhook ignores non-INSERT events."""
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": "Bearer test-secret"},
            json={
                "type": "UPDATE",
                "table": "videos",
                "record": {"id": "video-123"}
            }
        )

        assert response.status_code == 200
        assert response.json()["status"] == "ignored"

    @patch.dict('os.environ', {
        'WEBHOOK_SECRET': 'test-secret',
        'PREFECT_API_URL': 'http://test-prefect.com/api'
    })
    def test_webhook_success(self, client, mock_prefect_api):
        """Test successful webhook processing."""
        with patch('app.routers.webhooks.SupabaseServiceImpl') as mock_supabase:
            # Mock tenant tier lookup
            mock_supabase.return_value.get_tenant_tier.return_value = "premium"

            response = client.post(
                "/webhooks/supabase/videos",
                headers={"Authorization": "Bearer test-secret"},
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": "video-123",
                        "tenant_id": "tenant-456",
                        "storage_key": "tenant-456/videos/video-123.mp4",
                        "created_at": "2024-01-01T00:00:00Z"
                    }
                }
            )

        assert response.status_code == 202
        json_data = response.json()
        assert json_data["success"] is True
        assert json_data["flow_run_id"] == "flow-run-123"
        assert json_data["status"] == "accepted"

        # Verify Prefect API was called
        assert mock_prefect_api.post.called
        call_args = mock_prefect_api.post.call_args
        assert "deployments/name" in call_args[0][0]

        # Verify priority was calculated
        request_body = call_args[1]["json"]
        assert "priority" in request_body
        assert request_body["priority"] >= 70  # Premium tier
```

**Coverage Goal:** 85%
**Dependencies:** FastAPI TestClient, mocked external services
**Run Time:** < 3 seconds
**Run Frequency:** Every commit

---

## Level 3: End-to-End Integration Tests

### 3.1 Video Upload to Processing

**File:** `/services/api/tests/e2e/test_video_processing_flow.py`

#### Test Scenario

```python
import pytest
import asyncio
from datetime import datetime, timezone, timedelta
from tests.fixtures.test_data import create_test_video


@pytest.mark.e2e
@pytest.mark.slow
class TestVideoProcessingE2E:
    """End-to-end test for complete video processing flow."""

    @pytest.fixture
    async def test_video(self):
        """Create and upload test video."""
        video_file = create_test_video(
            duration=5,  # 5 second video
            fps=30,
            text_overlay="Test Caption"
        )

        # Upload to Wasabi
        from app.services.wasabi_service import WasabiServiceImpl
        wasabi = WasabiServiceImpl(...)

        tenant_id = f"test-tenant-{datetime.now().timestamp()}"
        video_id = f"test-video-{datetime.now().timestamp()}"
        storage_key = f"{tenant_id}/client/videos/{video_id}/video.mp4"

        with open(video_file, 'rb') as f:
            wasabi.upload_file(
                key=storage_key,
                data=f,
                content_type="video/mp4"
            )

        yield {
            "tenant_id": tenant_id,
            "video_id": video_id,
            "storage_key": storage_key
        }

        # Cleanup
        wasabi.delete_prefix(f"{tenant_id}/")

    @pytest.mark.asyncio
    async def test_full_video_processing_integration(self, test_video):
        """Test complete integration with all real services."""
        from app.services.supabase_service import SupabaseServiceImpl
        from app.services.wasabi_service import WasabiServiceImpl
        from app.flows.video_initial_processing import video_initial_processing

        video_id = test_video["video_id"]
        tenant_id = test_video["tenant_id"]

        # 1. Test webhook trigger (tests our webhook handler)
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.post(
            "/webhooks/supabase/videos",
            headers={"Authorization": f"Bearer {webhook_secret}"},
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": video_id,
                    "tenant_id": tenant_id,
                    "storage_key": test_video["storage_key"],
                    "created_at": datetime.now().isoformat()
                }
            }
        )

        assert response.status_code == 202
        flow_run_id = response.json()["flow_run_id"]

        # 2. Execute flow directly (tests our flow logic)
        #    This bypasses Prefect scheduling to focus on OUR code
        #    Uses real Modal, Supabase, and Wasabi services
        result = await video_initial_processing(
            video_id=video_id,
            tenant_id=tenant_id,
            storage_key=test_video["storage_key"]
        )

        # 3. Verify results from our flow execution
        assert result["status"] == "success"
        assert result["frame_count"] > 0

        # 4. Verify Supabase was updated by our flow
        supabase = SupabaseServiceImpl(...)
        video_meta = supabase.get_video_metadata(video_id)
        assert video_meta["status"] == "active"
        assert video_meta["frame_count"] > 0
        assert video_meta["duration_seconds"] > 0

        # 5. Verify files were created by Modal function
        wasabi = WasabiServiceImpl(...)

        # Check full frames
        frames = wasabi.list_files(
            prefix=f"{tenant_id}/client/videos/{video_id}/full_frames/"
        )
        assert len(frames) > 0

        # Check databases
        assert wasabi.file_exists(f"{tenant_id}/server/videos/{video_id}/layout.db.gz")
        assert wasabi.file_exists(f"{tenant_id}/server/videos/{video_id}/raw-ocr.db.gz")

        # Note: This tests our complete integration, not Prefect's scheduling

    @pytest.mark.asyncio
    async def test_crop_and_infer_integration(self, test_video):
        """Test crop and infer flow integration."""
        from app.services.supabase_service import SupabaseServiceImpl
        from app.services.wasabi_service import WasabiServiceImpl
        from app.flows.crop_and_infer import crop_and_infer
        from fastapi.testclient import TestClient
        from app.main import app

        video_id = test_video["video_id"]
        tenant_id = test_video["tenant_id"]

        # 1. Trigger via API (tests our endpoint)
        client = TestClient(app)
        response = client.post(
            f"/videos/{video_id}/actions/approve-layout",
            json={
                "type": "crop-and-infer-caption-frame-extents",
                "crop_region": {
                    "crop_left": 0.0,
                    "crop_top": 0.7,
                    "crop_right": 1.0,
                    "crop_bottom": 1.0
                }
            },
            headers={"Authorization": f"Bearer {test_auth_token}"}
        )

        assert response.status_code == 200
        flow_run_id = response.json()["jobId"]

        # 2. Execute flow directly (tests our flow logic with lock management)
        #    This bypasses Prefect scheduling to test OUR code
        crop_region = {
            "crop_left": 0.0,
            "crop_top": 0.7,
            "crop_right": 1.0,
            "crop_bottom": 1.0
        }

        result = await crop_and_infer(
            video_id=video_id,
            tenant_id=tenant_id,
            crop_region=crop_region
        )

        # 3. Verify results from our flow
        assert result["status"] == "success"
        assert result["version"] > 0

        # 4. Verify files created by Modal function
        wasabi = WasabiServiceImpl(...)
        version = result["version"]

        # Check cropped frames
        chunks = wasabi.list_files(
            prefix=f"{tenant_id}/client/videos/{video_id}/cropped_frames_v{version}/"
        )
        assert len(chunks) > 0

        # Check caption frame extents database
        assert wasabi.file_exists(
            f"{tenant_id}/server/videos/{video_id}/caption_frame_extents_v{version}.db"
        )

        # 5. Verify lock was released (tests our lock management)
        supabase = SupabaseServiceImpl(...)
        # Query video_database_state to ensure lock_holder_user_id is NULL
        # This verifies our try/finally lock release works correctly
```

**Coverage Goal:** N/A (E2E test)
**Dependencies:** All services, real video processing
**Run Time:** 10-20 minutes
**Run Frequency:** Pre-deployment, nightly builds

---

## Level 4: Load and Performance Tests

### 4.1 Concurrent Flow Execution

**File:** `/services/api/tests/load/test_concurrent_flows.py`

#### Test Scenarios

```python
import pytest
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime


@pytest.mark.load
class TestConcurrentFlowExecution:
    """Load tests for concurrent flow execution."""

    @pytest.mark.asyncio
    async def test_10_concurrent_webhooks(self):
        """Test system handles 10 concurrent webhook requests."""
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)

        async def trigger_webhook(index):
            """Trigger single webhook."""
            start = datetime.now()

            response = client.post(
                "/webhooks/supabase/videos",
                headers={"Authorization": f"Bearer {webhook_secret}"},
                json={
                    "type": "INSERT",
                    "table": "videos",
                    "record": {
                        "id": f"video-{index}",
                        "tenant_id": "load-test-tenant",
                        "storage_key": f"tenant/videos/video-{index}.mp4",
                        "created_at": datetime.now().isoformat()
                    }
                }
            )

            duration = (datetime.now() - start).total_seconds()

            return {
                "index": index,
                "status_code": response.status_code,
                "duration": duration,
                "flow_run_id": response.json().get("flow_run_id")
            }

        # Execute 10 concurrent webhooks
        results = await asyncio.gather(*[
            trigger_webhook(i) for i in range(10)
        ])

        # Verify all succeeded
        assert all(r["status_code"] == 202 for r in results)

        # Verify response times
        avg_duration = sum(r["duration"] for r in results) / len(results)
        max_duration = max(r["duration"] for r in results)

        assert avg_duration < 1.0  # Average under 1 second
        assert max_duration < 3.0  # Max under 3 seconds

        print(f"Average response time: {avg_duration:.2f}s")
        print(f"Max response time: {max_duration:.2f}s")

    @pytest.mark.asyncio
    async def test_webhook_handler_throughput(self):
        """Test webhook handler processes requests quickly."""
        from datetime import datetime
        start = datetime.now()

        # Send 50 concurrent requests to webhook handler
        results = await asyncio.gather(*[
            trigger_webhook(i) for i in range(50)
        ])

        duration = (datetime.now() - start).total_seconds()

        # All should succeed
        assert all(r["status_code"] == 202 for r in results)

        # Should complete quickly (< 5 seconds for 50 requests)
        # This tests OUR webhook handler performance, not Prefect execution
        assert duration < 5.0

        # Each should have created a flow run (called Prefect API)
        assert all("flow_run_id" in r for r in results)

    @pytest.mark.asyncio
    async def test_priority_calculation_under_load(self):
        """Test our priority calculation remains correct under load."""
        # Trigger flows with different tiers concurrently
        free_tier_requests = [
            trigger_webhook(i, tier="free") for i in range(10)
        ]
        enterprise_requests = [
            trigger_webhook(i, tier="enterprise") for i in range(2)
        ]

        results = await asyncio.gather(
            *free_tier_requests,
            *enterprise_requests
        )

        # Verify OUR priority calculation was correct
        # (Does not test that Prefect honors the priority)
        free_results = results[:10]
        enterprise_results = results[10:]

        # All free tier should have priority 50-70 (with age boost)
        for r in free_results:
            assert 50 <= r["priority"] <= 70

        # All enterprise should have priority 90-110 (with age boost)
        for r in enterprise_results:
            assert 90 <= r["priority"] <= 110
```

**Coverage Goal:** N/A (load test)
**Dependencies:** Load testing infrastructure
**Run Time:** 10-30 minutes
**Run Frequency:** Weekly, pre-deployment

---

### 4.2 Resource Usage Monitoring

**File:** `/services/api/tests/load/test_resource_usage.py`

#### Metrics to Track

```python
import pytest
import psutil
import asyncio
from datetime import datetime


@pytest.mark.load
class TestResourceUsage:
    """Monitor resource usage during load tests."""

    @pytest.mark.asyncio
    async def test_memory_usage_under_load(self):
        """Verify memory usage stays within limits."""
        process = psutil.Process()

        # Baseline memory
        baseline_memory = process.memory_info().rss / 1024 / 1024  # MB

        # Run load test (100 concurrent requests)
        # ... trigger load ...

        # Peak memory
        peak_memory = process.memory_info().rss / 1024 / 1024  # MB

        # Memory increase should be < 500 MB
        memory_increase = peak_memory - baseline_memory
        assert memory_increase < 500, f"Memory increased by {memory_increase:.2f} MB"

    @pytest.mark.asyncio
    async def test_database_connection_pool(self):
        """Verify database connections are reused."""
        # Monitor active Supabase connections
        # Verify connection pool doesn't grow unbounded
        pass

    @pytest.mark.asyncio
    async def test_api_continues_if_worker_fails_to_start(self):
        """Test our API starts even if Prefect worker fails."""
        from unittest.mock import patch

        # Mock Prefect server unreachable during startup
        with patch('prefect.client.orchestration.get_client') as mock_client:
            mock_client.side_effect = Exception("Connection refused")

            # API should still start successfully
            # This tests OUR error handling, not Prefect reliability
            from fastapi.testclient import TestClient
            from app.main import app

            client = TestClient(app)
            response = client.get("/health")
            assert response.status_code == 200

            # Webhooks should return 503 (service unavailable)
            response = client.post("/webhooks/supabase/videos", ...)
            assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_worker_manager_handles_worker_crash(self):
        """Test our worker manager detects and logs worker crashes."""
        from app.prefect_runner import get_worker_manager

        worker_manager = get_worker_manager()
        await worker_manager.start()

        # Simulate worker crash
        if worker_manager.worker_process:
            worker_manager.worker_process.kill()
            await asyncio.sleep(1)

            # Verify appropriate logging occurred
            # This tests OUR worker monitoring logic
            # (Logs would show "[Worker] process terminated")
        pass
```

---

## Level 5: Error Handling and Recovery Tests

### 5.1 Modal Function Failures

**File:** `/services/api/tests/recovery/test_modal_failures.py`

#### Test Scenarios

```python
@pytest.mark.recovery
class TestModalFailureRecovery:
    """Test recovery from Modal function failures."""

    def test_modal_timeout_retry(self):
        """Test flow retries after Modal timeout."""
        # Mock Modal timeout
        # Verify flow retries with exponential backoff
        # Verify final failure after max retries
        pass

    def test_modal_gpu_unavailable(self):
        """Test handling of GPU unavailable errors."""
        # Mock GPU capacity error
        # Verify flow queues for retry
        # Verify flow eventually succeeds when GPU available
        pass

    def test_partial_frame_extraction_failure(self):
        """Test handling of partial extraction failures."""
        # Mock some frames fail OCR
        # Verify flow completes with partial results
        # Verify failed_ocr_count is tracked
        pass
```

---

### 5.2 Network Failures

**File:** `/services/api/tests/recovery/test_network_failures.py`

#### Test Scenarios

```python
@pytest.mark.recovery
class TestNetworkFailureRecovery:
    """Test recovery from network failures."""

    def test_prefect_api_connection_loss(self):
        """Test handling of Prefect API connection loss."""
        # Simulate network partition
        # Verify webhook returns 503
        # Verify system recovers when connection restored
        pass

    def test_supabase_connection_timeout(self):
        """Test handling of Supabase timeouts."""
        # Mock Supabase timeout
        # Verify flow retries database operations
        # Verify flow completes successfully after retry
        pass

    def test_wasabi_upload_failure(self):
        """Test handling of Wasabi upload failures."""
        # Mock S3 upload failure
        # Verify flow retries upload
        # Verify flow eventually succeeds
        pass
```

---

### 5.3 Lock Contention

**File:** `/services/api/tests/recovery/test_lock_contention.py`

#### Test Scenarios

```python
@pytest.mark.recovery
class TestLockContention:
    """Test handling of lock contention."""

    @pytest.mark.asyncio
    async def test_concurrent_lock_acquisition(self):
        """Test only one flow acquires lock."""
        from app.services.supabase_service import SupabaseServiceImpl

        supabase = SupabaseServiceImpl(...)

        # Try to acquire same lock concurrently
        results = await asyncio.gather(
            *[
                supabase.acquire_server_lock("video-123", "layout")
                for _ in range(10)
            ]
        )

        # Only one should succeed
        successful = sum(results)
        assert successful == 1

    @pytest.mark.asyncio
    async def test_lock_timeout_and_retry(self):
        """Test flow retries when lock is held."""
        # Acquire lock
        # Try to trigger flow (should fail to acquire lock)
        # Release lock
        # Verify flow retries and succeeds
        pass

    @pytest.mark.asyncio
    async def test_stale_lock_cleanup(self):
        """Test cleanup of stale locks."""
        # Create lock with old timestamp
        # Verify lock is cleaned up after expiry
        # Verify new flow can acquire lock
        pass
```

---

## Level 6: Security Tests

### 6.1 Webhook Authentication

**File:** `/services/api/tests/security/test_webhook_security.py`

#### Test Scenarios

```python
@pytest.mark.security
class TestWebhookSecurity:
    """Security tests for webhook endpoints."""

    def test_webhook_requires_auth(self):
        """Webhook rejects requests without auth."""
        # Test missing Authorization header
        # Test empty Authorization header
        # Test malformed Authorization header
        pass

    def test_webhook_rejects_invalid_secrets(self):
        """Webhook rejects invalid secrets."""
        # Test wrong secret
        # Test expired secret (if implementing rotation)
        pass

    def test_webhook_prevents_replay_attacks(self):
        """Webhook prevents replay attacks."""
        # Test same request twice
        # Verify second request is rejected (if implementing nonce)
        pass

    def test_webhook_rate_limiting(self):
        """Webhook rate limits requests per IP."""
        # Send 100 requests rapidly
        # Verify rate limiting kicks in
        # Verify legitimate requests still work
        pass
```

---

### 6.2 Tenant Isolation

**File:** `/services/api/tests/security/test_tenant_isolation.py`

#### Test Scenarios

```python
@pytest.mark.security
class TestTenantIsolation:
    """Test tenant data isolation."""

    def test_tenant_cannot_access_other_tenant_video(self):
        """Verify tenant isolation in API."""
        # Create video for tenant A
        # Try to access with tenant B credentials
        # Verify 404 or 403 response
        pass

    def test_tenant_cannot_trigger_flow_for_other_tenant(self):
        """Verify tenant isolation in flow triggering."""
        # Try to trigger flow for another tenant's video
        # Verify request is rejected
        pass

    def test_wasabi_keys_include_tenant_id(self):
        """Verify all Wasabi keys include tenant ID."""
        # Check all generated S3 keys
        # Verify they start with tenant_id
        pass
```

---

## Test Execution Strategy

### Development Workflow

```bash
# Run unit tests (fast feedback)
pytest tests/unit/ -v

# Run service integration tests
pytest tests/integration/ -v

# Run all tests except E2E and load
pytest -m "not e2e and not load" -v
```

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run unit tests
        run: pytest tests/unit/ --cov --cov-report=xml

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v2
      - name: Run integration tests
        run: pytest tests/integration/ -v

  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v2
      - name: Run E2E tests
        run: pytest tests/e2e/ -v --timeout=1800
```

### Pre-Deployment Checklist

- [ ] All unit tests pass (100% coverage target)
- [ ] All integration tests pass
- [ ] At least 1 E2E test passes for each flow
- [ ] Load tests show acceptable performance
- [ ] Security tests pass
- [ ] Manual smoke test in staging

---

## Test Data Management

### Test Video Library

Create a library of test videos with different characteristics:

```
/tests/fixtures/videos/
├── short-5s-text-bottom.mp4      # 5s, text at bottom
├── short-5s-text-top.mp4         # 5s, text at top
├── short-5s-no-text.mp4          # 5s, no text
├── medium-30s-multiple-captions.mp4
├── long-2m-dense-text.mp4
├── high-res-4k.mp4
├── low-res-480p.mp4
├── corrupt-partial.mp4            # Partially corrupt
└── edge-cases/
    ├── vertical-video.mp4
    ├── rotated-90deg.mp4
    └── variable-framerate.mp4
```

### Test Database Snapshots

```
/tests/fixtures/databases/
├── empty-layout.db
├── layout-with-annotations.db
├── caption-frame-extents-sample.db
└── captions-with-ocr.db.gz
```

---

## Monitoring and Observability Tests

### 6.3 Metrics Collection

**File:** `/services/api/tests/observability/test_metrics.py`

```python
@pytest.mark.observability
class TestMetrics:
    """Test metrics collection and reporting."""

    def test_flow_duration_metrics(self):
        """Verify flow duration is tracked."""
        # Run flow
        # Check processing_duration_seconds is populated
        # Verify metric is reasonable
        pass

    def test_priority_tags_applied(self):
        """Verify priority tags are applied to flows."""
        # Trigger flow
        # Check Prefect flow run has correct tags
        # Verify tags match expected format
        pass

    def test_error_rate_tracking(self):
        """Verify errors are tracked."""
        # Trigger failing flow
        # Check error count increases
        # Verify error details are logged
        pass
```

---

## Success Criteria

### Coverage Targets

- **Unit Tests:** 90%+ coverage
- **Service Integration:** 80%+ coverage
- **Flow Integration:** 80%+ coverage
- **E2E Tests:** 100% of happy paths
- **Error Recovery:** 80%+ of failure scenarios

### Performance Targets

- **Webhook Response:** < 1s (p95)
- **Flow Triggering:** < 2s (p95)
- **Extract Frames:** < 5 min for 60s video
- **Crop and Infer:** < 10 min for 60s video
- **Caption OCR:** < 30s per caption
- **Concurrent Flows:** 10+ simultaneous

### Reliability Targets

- **Webhook Availability:** 99.9%
- **Flow Success Rate:** 95%+
- **Retry Success Rate:** 90%+ (after 1-2 retries)
- **Lock Contention:** < 1% of flows blocked

---

## Implementation Timeline

### Phase 1: Unit Tests (Week 1)
- Implement priority service tests
- Implement Supabase service tests
- Implement Wasabi service tests
- Target: 90% coverage

### Phase 2: Integration Tests (Week 2)
- Implement flow integration tests
- Implement API endpoint tests
- Target: 80% coverage

### Phase 3: E2E Tests (Week 3)
- Setup test video library
- Implement video processing E2E test
- Implement approve layout E2E test
- Target: 2 complete workflows

### Phase 4: Load & Recovery Tests (Week 4)
- Implement concurrent flow tests
- Implement error recovery tests
- Implement security tests
- Target: Performance benchmarks established

### Phase 5: CI/CD Integration (Week 5)
- Setup GitHub Actions workflows
- Configure test reporting
- Setup automated E2E testing
- Target: All tests automated

---

## Appendix

### Test Utilities

**File:** `/services/api/tests/utils/helpers.py`

```python
"""Test utilities and helpers."""

import tempfile
from pathlib import Path
from typing import Dict, Any


def create_test_video(
    duration: int,
    fps: int = 30,
    text_overlay: str | None = None,
    resolution: tuple[int, int] = (1920, 1080)
) -> Path:
    """
    Create a test video using FFmpeg.

    Args:
        duration: Video duration in seconds
        fps: Frames per second
        text_overlay: Optional text to overlay
        resolution: Video resolution (width, height)

    Returns:
        Path to created video file
    """
    import subprocess

    output = Path(tempfile.mktemp(suffix=".mp4"))

    # Base FFmpeg command
    cmd = [
        "ffmpeg",
        "-f", "lavfi",
        "-i", f"testsrc=duration={duration}:size={resolution[0]}x{resolution[1]}:rate={fps}",
    ]

    # Add text overlay if specified
    if text_overlay:
        cmd.extend([
            "-vf", f"drawtext=text='{text_overlay}':fontsize=48:x=(w-text_w)/2:y=h-th-20:fontcolor=white"
        ])

    cmd.extend([
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        str(output)
    ])

    subprocess.run(cmd, check=True, capture_output=True)

    return output


def mock_modal_result(
    frame_count: int = 100,
    duration: float = 10.0,
    **kwargs
) -> Dict[str, Any]:
    """Create mock Modal function result."""
    return {
        "frame_count": frame_count,
        "duration": duration,
        "frame_width": kwargs.get("frame_width", 1920),
        "frame_height": kwargs.get("frame_height", 1080),
        "video_codec": kwargs.get("video_codec", "h264"),
        "bitrate": kwargs.get("bitrate", 5000000),
        "ocr_box_count": kwargs.get("ocr_box_count", 50),
        "failed_ocr_count": kwargs.get("failed_ocr_count", 0),
        "processing_duration_seconds": kwargs.get("processing_duration_seconds", 45.0),
        "full_frames_key": kwargs.get("full_frames_key", "tenant/videos/frames/"),
        "ocr_db_key": kwargs.get("ocr_db_key", "tenant/videos/ocr.db.gz"),
        "layout_db_key": kwargs.get("layout_db_key", "tenant/videos/layout.db.gz")
    }
```

### pytest Configuration

**File:** `/services/api/pytest.ini`

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*

# Markers
markers =
    unit: Unit tests (fast, no external dependencies)
    integration: Integration tests (moderate speed, mocked externals)
    e2e: End-to-end tests (slow, real services)
    load: Load and performance tests
    recovery: Error recovery tests
    security: Security tests
    observability: Observability tests
    slow: Slow-running tests

# Coverage
addopts =
    --strict-markers
    --tb=short
    --disable-warnings
    -ra

# Timeouts
timeout = 300
timeout_method = thread

# Async
asyncio_mode = auto
```

---

## Conclusion

This comprehensive test plan provides coverage at all levels of integration, from fast unit tests to full end-to-end validation. Following this plan ensures the Prefect orchestration system is robust, reliable, and production-ready.

**Key Principles:**
1. **Fast feedback loops** with unit tests
2. **Realistic integration** with service tests
3. **Production validation** with E2E tests
4. **Performance assurance** with load tests
5. **Resilience verification** with recovery tests
6. **Security validation** with security tests

The test pyramid approach ensures most tests run quickly during development, while comprehensive E2E and load tests validate production readiness before deployment.
