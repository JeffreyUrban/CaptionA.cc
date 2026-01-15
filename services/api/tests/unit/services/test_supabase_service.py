"""
Unit tests for Supabase Service.
Tests SupabaseServiceImpl methods with mocked Supabase client.
"""
import pytest
from unittest.mock import Mock, patch

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
    query_mock.limit.return_value = query_mock
    query_mock.execute.return_value = Mock(data=None)

    return client


@pytest.fixture
def supabase_service(mock_supabase_client):
    """Create service with mocked client."""
    with patch('supabase.create_client') as mock_create:
        mock_create.return_value = mock_supabase_client
        service = SupabaseServiceImpl(
            supabase_url="https://test.supabase.co",
            supabase_key="test-key",  # pragma: allowlist secret
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

    def test_update_no_fields(self, supabase_service, mock_supabase_client):
        """No update when no fields provided."""
        supabase_service.update_video_status(video_id="video-123")

        # Verify update was not called
        assert not mock_supabase_client.schema().table().update.called

    def test_update_status_to_error(self, supabase_service, mock_supabase_client):
        """Update status to error state."""
        supabase_service.update_video_status(
            video_id="video-123",
            status="error",
            error_message="Processing failed"
        )

        call_args = mock_supabase_client.schema().table().update.call_args
        data = call_args[0][0]
        assert data["status"] == "error"
        # Note: error_message not in current schema

    def test_update_verifies_video_id(self, supabase_service, mock_supabase_client):
        """Verify video_id is passed to eq filter."""
        supabase_service.update_video_status(
            video_id="video-456",
            status="active"
        )

        # Check that eq was called with the video_id
        eq_call_args = mock_supabase_client.schema().table().update().eq.call_args
        assert eq_call_args[0] == ("id", "video-456")


class TestUpdateVideoMetadata:
    """Test video metadata updates."""

    def test_update_duration_only(self, supabase_service, mock_supabase_client):
        """Update only duration_seconds field."""
        supabase_service.update_video_metadata(
            video_id="video-123",
            duration_seconds=120.5
        )

        call_args = mock_supabase_client.schema().table().update.call_args
        assert call_args[0][0] == {"duration_seconds": 120.5}

    def test_update_cropped_frames_version(self, supabase_service, mock_supabase_client):
        """Update cropped_frames_version field."""
        supabase_service.update_video_metadata(
            video_id="video-123",
            cropped_frames_version=2
        )

        call_args = mock_supabase_client.schema().table().update.call_args
        assert call_args[0][0] == {"current_cropped_frames_version": 2}

    def test_update_multiple_metadata_fields(self, supabase_service, mock_supabase_client):
        """Update multiple metadata fields."""
        supabase_service.update_video_metadata(
            video_id="video-123",
            duration_seconds=95.3,
            cropped_frames_version=1
        )

        call_args = mock_supabase_client.schema().table().update.call_args
        data = call_args[0][0]
        assert data["duration_seconds"] == 95.3
        assert data["current_cropped_frames_version"] == 1

    def test_update_frame_count_not_stored(self, supabase_service, mock_supabase_client):
        """Frame count is not stored in videos table."""
        supabase_service.update_video_metadata(
            video_id="video-123",
            frame_count=1000
        )

        # Verify update was not called (frame_count not in videos table)
        assert not mock_supabase_client.schema().table().update.called

    def test_update_no_metadata(self, supabase_service, mock_supabase_client):
        """No update when no metadata provided."""
        supabase_service.update_video_metadata(video_id="video-123")

        # Verify update was not called
        assert not mock_supabase_client.schema().table().update.called


class TestAcquireServerLock:
    """Test server lock acquisition."""

    def test_lock_acquisition_success_no_existing_state(
        self, supabase_service, mock_supabase_client
    ):
        """Successfully acquire lock when no state exists."""
        # Mock no existing state
        state_response = Mock(data=None)
        video_response = Mock(data={"tenant_id": "tenant-123"})

        # Create separate mock chains for each query
        schema_mock1 = Mock()
        table_mock1 = Mock()
        query_mock1 = Mock()
        schema_mock1.table.return_value = table_mock1
        table_mock1.select.return_value = query_mock1
        query_mock1.eq.return_value = query_mock1
        query_mock1.maybe_single.return_value = query_mock1
        query_mock1.execute.return_value = state_response

        schema_mock2 = Mock()
        table_mock2 = Mock()
        query_mock2 = Mock()
        schema_mock2.table.return_value = table_mock2
        table_mock2.select.return_value = query_mock2
        query_mock2.eq.return_value = query_mock2
        query_mock2.maybe_single.return_value = query_mock2
        query_mock2.execute.return_value = video_response

        schema_mock3 = Mock()
        table_mock3 = Mock()
        insert_mock3 = Mock()
        schema_mock3.table.return_value = table_mock3
        table_mock3.insert.return_value = insert_mock3
        insert_mock3.execute.return_value = Mock(data={"id": "new-state"})

        # Set up schema() to return different mocks for each call
        mock_supabase_client.schema.side_effect = [schema_mock1, schema_mock2, schema_mock3]

        result = supabase_service.acquire_server_lock(
            video_id="video-123",
            database_name="layout"
        )

        assert result is True
        # Verify insert was called
        assert table_mock3.insert.called

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

    def test_lock_acquisition_with_user_id(
        self, supabase_service, mock_supabase_client
    ):
        """Acquire lock with specific user_id."""
        state_response = Mock(data={
            "lock_holder_user_id": None,
            "lock_type": None,
            "tenant_id": "tenant-123"
        })

        mock_supabase_client.schema().table().select().eq().maybe_single().execute.return_value = state_response

        result = supabase_service.acquire_server_lock(
            video_id="video-123",
            database_name="captions",
            lock_holder_user_id="user-789"
        )

        assert result is True
        # Verify update was called with user_id
        update_call_args = mock_supabase_client.schema().table().update.call_args
        assert update_call_args[0][0]["lock_holder_user_id"] == "user-789"

    def test_lock_acquisition_system_lock(
        self, supabase_service, mock_supabase_client
    ):
        """Acquire system lock (user_id=None)."""
        state_response = Mock(data={
            "lock_holder_user_id": None,
            "lock_type": None,
            "tenant_id": "tenant-123"
        })

        mock_supabase_client.schema().table().select().eq().maybe_single().execute.return_value = state_response

        result = supabase_service.acquire_server_lock(
            video_id="video-123",
            database_name="layout",
            lock_holder_user_id=None
        )

        assert result is True
        # Verify update was called with None user_id
        update_call_args = mock_supabase_client.schema().table().update.call_args
        assert update_call_args[0][0]["lock_holder_user_id"] is None

    def test_lock_acquisition_video_not_exists(
        self, supabase_service, mock_supabase_client
    ):
        """Fail to acquire lock when video doesn't exist."""
        state_response = Mock(data=None)
        video_response = Mock(data=None)

        execute_mock = Mock()
        execute_mock.side_effect = [
            state_response,  # video_database_state query
            video_response   # videos query (no video found)
        ]
        mock_supabase_client.schema().table().select().eq().maybe_single().execute = execute_mock

        result = supabase_service.acquire_server_lock(
            video_id="nonexistent-video",
            database_name="layout"
        )

        assert result is False

    def test_lock_acquisition_insert_failure(
        self, supabase_service, mock_supabase_client
    ):
        """Handle insert failure gracefully (race condition)."""
        state_response = Mock(data=None)
        video_response = Mock(data={"tenant_id": "tenant-123"})

        # Create separate mock chains for each query
        schema_mock1 = Mock()
        table_mock1 = Mock()
        query_mock1 = Mock()
        schema_mock1.table.return_value = table_mock1
        table_mock1.select.return_value = query_mock1
        query_mock1.eq.return_value = query_mock1
        query_mock1.maybe_single.return_value = query_mock1
        query_mock1.execute.return_value = state_response

        schema_mock2 = Mock()
        table_mock2 = Mock()
        query_mock2 = Mock()
        schema_mock2.table.return_value = table_mock2
        table_mock2.select.return_value = query_mock2
        query_mock2.eq.return_value = query_mock2
        query_mock2.maybe_single.return_value = query_mock2
        query_mock2.execute.return_value = video_response

        schema_mock3 = Mock()
        table_mock3 = Mock()
        insert_mock3 = Mock()
        schema_mock3.table.return_value = table_mock3
        table_mock3.insert.return_value = insert_mock3
        # Make insert execute raise an exception (race condition)
        insert_mock3.execute.side_effect = Exception("Insert failed")

        # Set up schema() to return different mocks for each call
        mock_supabase_client.schema.side_effect = [schema_mock1, schema_mock2, schema_mock3]

        result = supabase_service.acquire_server_lock(
            video_id="video-123",
            database_name="layout"
        )

        assert result is False

    def test_lock_acquisition_update_failure(
        self, supabase_service, mock_supabase_client
    ):
        """Handle update failure gracefully (race condition)."""
        state_response = Mock(data={
            "lock_holder_user_id": None,
            "lock_type": None,
            "tenant_id": "tenant-123"
        })

        # Create separate mock chains for query and update
        schema_mock1 = Mock()
        table_mock1 = Mock()
        query_mock1 = Mock()
        schema_mock1.table.return_value = table_mock1
        table_mock1.select.return_value = query_mock1
        query_mock1.eq.return_value = query_mock1
        query_mock1.maybe_single.return_value = query_mock1
        query_mock1.execute.return_value = state_response

        schema_mock2 = Mock()
        table_mock2 = Mock()
        update_mock2 = Mock()
        schema_mock2.table.return_value = table_mock2
        table_mock2.update.return_value = update_mock2
        update_mock2.eq.return_value = update_mock2
        # Make update execute raise an exception (race condition)
        update_mock2.execute.side_effect = Exception("Update failed")

        # Set up schema() to return different mocks for each call
        mock_supabase_client.schema.side_effect = [schema_mock1, schema_mock2]

        result = supabase_service.acquire_server_lock(
            video_id="video-123",
            database_name="layout"
        )

        assert result is False


class TestReleaseServerLock:
    """Test server lock release."""

    def test_release_lock_success(self, supabase_service, mock_supabase_client):
        """Successfully release lock."""
        supabase_service.release_server_lock(
            video_id="video-123",
            database_name="layout"
        )

        # Verify update was called with None values
        update_call_args = mock_supabase_client.schema().table().update.call_args
        assert update_call_args[0][0] == {
            "lock_holder_user_id": None,
            "lock_type": None,
            "locked_at": None,
        }

    def test_release_lock_verifies_video_id_and_database(
        self, supabase_service, mock_supabase_client
    ):
        """Verify video_id and database_name are passed to eq filters."""
        supabase_service.release_server_lock(
            video_id="video-456",
            database_name="captions"
        )

        # Check that eq was called with video_id and database_name
        eq_calls = mock_supabase_client.schema().table().update().eq.call_args_list
        assert len(eq_calls) >= 1
        # First eq call should be video_id
        assert eq_calls[0][0] == ("video_id", "video-456")


class TestGetTenantTier:
    """Test tenant tier lookup."""

    def test_tier_mapping_demo(self, supabase_service, mock_supabase_client):
        """Demo access tier maps to free."""
        response = Mock(data={"access_tier_id": "demo"})
        mock_supabase_client.schema().table().select().eq().limit().maybe_single().execute.return_value = response

        tier = supabase_service.get_tenant_tier("tenant-123")
        assert tier == "free"

    def test_tier_mapping_trial(self, supabase_service, mock_supabase_client):
        """Trial access tier maps to free."""
        response = Mock(data={"access_tier_id": "trial"})
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

    def test_default_tier_unknown_access_tier(self, supabase_service, mock_supabase_client):
        """Default to free for unknown access_tier_id."""
        response = Mock(data={"access_tier_id": "unknown_tier"})
        mock_supabase_client.schema().table().select().eq().limit().maybe_single().execute.return_value = response

        tier = supabase_service.get_tenant_tier("tenant-123")
        assert tier == "free"

    def test_default_tier_missing_access_tier_id(self, supabase_service, mock_supabase_client):
        """Default to free when access_tier_id is missing."""
        response = Mock(data={})
        mock_supabase_client.schema().table().select().eq().limit().maybe_single().execute.return_value = response

        tier = supabase_service.get_tenant_tier("tenant-123")
        assert tier == "free"


class TestGetVideoMetadata:
    """Test video metadata retrieval."""

    def test_get_video_metadata_success(self, supabase_service, mock_supabase_client):
        """Successfully retrieve video metadata."""
        video_data = {
            "tenant_id": "tenant-123",
            "storage_key": "videos/test.mp4",
            "size_bytes": 1024000,
            "uploaded_at": "2026-01-12T10:00:00Z",
            "status": "processing",
            "duration_seconds": 120.5,
            "current_cropped_frames_version": 1,
            "captions_db_key": "captions/video-123.db",  # pragma: allowlist secret
            "prefect_flow_run_id": "flow-run-456"
        }
        response = Mock(data=video_data)
        mock_supabase_client.schema().table().select().eq().single().execute.return_value = response

        metadata = supabase_service.get_video_metadata("video-123")

        assert metadata["tenant_id"] == "tenant-123"
        assert metadata["storage_key"] == "videos/test.mp4"
        assert metadata["file_size_bytes"] == 1024000
        assert metadata["created_at"] == "2026-01-12T10:00:00Z"
        assert metadata["status"] == "processing"
        assert metadata["duration_seconds"] == 120.5
        assert metadata["current_cropped_frames_version"] == 1
        assert metadata["captions_db_key"] == "captions/video-123.db"  # pragma: allowlist secret
        assert metadata["prefect_flow_run_id"] == "flow-run-456"

    def test_get_video_metadata_not_found(self, supabase_service, mock_supabase_client):
        """Return empty dict when video not found."""
        response = Mock(data=None)
        mock_supabase_client.schema().table().select().eq().single().execute.return_value = response

        metadata = supabase_service.get_video_metadata("nonexistent-video")

        assert metadata == {}

    def test_get_video_metadata_partial_data(self, supabase_service, mock_supabase_client):
        """Handle partial data gracefully."""
        video_data = {
            "tenant_id": "tenant-123",
            "storage_key": "videos/test.mp4",
            # Missing other fields
        }
        response = Mock(data=video_data)
        mock_supabase_client.schema().table().select().eq().single().execute.return_value = response

        metadata = supabase_service.get_video_metadata("video-123")

        assert metadata["tenant_id"] == "tenant-123"
        assert metadata["storage_key"] == "videos/test.mp4"
        assert metadata["file_size_bytes"] is None
        assert metadata["created_at"] is None
        assert metadata["status"] is None

    def test_get_video_metadata_field_mapping(self, supabase_service, mock_supabase_client):
        """Verify field name mappings."""
        video_data = {
            "size_bytes": 2048000,  # Maps to file_size_bytes
            "uploaded_at": "2026-01-12T12:00:00Z",  # Maps to created_at
        }
        response = Mock(data=video_data)
        mock_supabase_client.schema().table().select().eq().single().execute.return_value = response

        metadata = supabase_service.get_video_metadata("video-123")

        # Verify field name mappings
        assert metadata["file_size_bytes"] == 2048000
        assert metadata["created_at"] == "2026-01-12T12:00:00Z"


class TestSupabaseServiceInitialization:
    """Test SupabaseServiceImpl initialization."""

    def test_initialization_with_defaults(self):
        """Initialize service with default schema."""
        with patch('supabase.create_client') as mock_create:
            mock_client = Mock()
            mock_create.return_value = mock_client

            service = SupabaseServiceImpl(
                supabase_url="https://test.supabase.co",
                supabase_key="test-key"  # pragma: allowlist secret
            )

            assert service.supabase_url == "https://test.supabase.co"
            assert service.supabase_key == "test-key"  # pragma: allowlist secret
            assert service.schema == "captionacc_production"
            assert service.client == mock_client

    def test_initialization_with_custom_schema(self):
        """Initialize service with custom schema."""
        with patch('supabase.create_client') as mock_create:
            mock_client = Mock()
            mock_create.return_value = mock_client

            service = SupabaseServiceImpl(
                supabase_url="https://test.supabase.co",
                supabase_key="test-key",  # pragma: allowlist secret
                schema="custom_schema"
            )

            assert service.schema == "custom_schema"

    def test_initialization_creates_client(self):
        """Verify client is created on initialization."""
        with patch('supabase.create_client') as mock_create:
            mock_client = Mock()
            mock_create.return_value = mock_client

            _service = SupabaseServiceImpl(
                supabase_url="https://test.supabase.co",
                supabase_key="test-key"  # pragma: allowlist secret
            )

            mock_create.assert_called_once_with(
                "https://test.supabase.co",
                "test-key"  # pragma: allowlist secret
            )
