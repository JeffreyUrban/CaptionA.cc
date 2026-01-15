"""Tests for DatabaseStateRepository."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.services.supabase_client import DatabaseStateRepository


class MockSupabaseResponse:
    """Mock Supabase response object."""

    def __init__(self, data):
        self.data = data


class MockSupabaseTable:
    """Mock Supabase table with chainable methods."""

    def __init__(self, data: list | None = None):
        self._data = data or []
        self._filters = {}
        self._is_single = False

    def select(self, _columns: str = "*"):
        return self

    def insert(self, data: dict):
        self._data.append(data)
        return self

    def update(self, data: dict):
        self._update_data = data
        return self

    def eq(self, column: str, value: str):
        self._filters[column] = value
        return self

    def gt(self, _column: str, _value):
        return self

    def maybe_single(self):
        self._is_single = True
        return self

    def execute(self) -> MockSupabaseResponse:
        # Filter data based on eq filters
        filtered = self._data
        for col, val in self._filters.items():
            filtered = [r for r in filtered if r.get(col) == val]

        if not filtered:
            return MockSupabaseResponse(None)

        # If maybe_single() was called, return dict instead of list
        if self._is_single:
            return MockSupabaseResponse(filtered[0] if filtered else None)

        return MockSupabaseResponse(filtered)


class MockSupabaseClient:
    """Mock Supabase client."""

    def __init__(self, table_data: list | None = None):
        self._table_data = table_data or []

    def schema(self, _schema_name: str):
        return self

    def table(self, _table_name: str):
        return MockSupabaseTable(self._table_data)


@pytest.fixture
def mock_settings():
    """Mock settings."""
    settings = MagicMock()
    settings.supabase_url = "https://test.supabase.co"
    settings.supabase_service_role_key = "test-key"
    settings.supabase_schema = "test_schema"
    return settings


@pytest.fixture
def mock_client():
    """Create mock Supabase client."""
    return MockSupabaseClient()


class TestGetState:
    """Tests for DatabaseStateRepository.get_state()."""

    async def test_get_state_returns_none_when_not_found(self, mock_settings):
        """Should return None when state doesn't exist."""
        mock_client = MockSupabaseClient([])

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            result = await repo.get_state("video-123", "layout")
            assert result is None

    async def test_get_state_returns_state_when_found(self, mock_settings):
        """Should return state dict when found."""
        state_data = {
            "video_id": "video-123",
            "database_name": "layout",
            "server_version": 5,
            "wasabi_version": 3,
            "lock_holder_user_id": "user-456",
        }
        mock_client = MockSupabaseClient([state_data])

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            result = await repo.get_state("video-123", "layout")
            assert result is not None
            assert result["server_version"] == 5


class TestCreateState:
    """Tests for DatabaseStateRepository.create_state()."""

    async def test_create_state_initializes_defaults(self, mock_settings):
        """Should create state with default values."""
        mock_client = MockSupabaseClient()

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            result = await repo.create_state("video-123", "layout", "tenant-456")

            assert result["video_id"] == "video-123"
            assert result["database_name"] == "layout"
            assert result["tenant_id"] == "tenant-456"
            assert result["server_version"] == 0
            assert result["wasabi_version"] == 0
            assert result["lock_holder_user_id"] is None


class TestGetOrCreateState:
    """Tests for DatabaseStateRepository.get_or_create_state()."""

    async def test_returns_existing_state(self, mock_settings):
        """Should return existing state if found."""
        existing_state = {
            "video_id": "video-123",
            "database_name": "layout",
            "tenant_id": "tenant-456",
            "server_version": 10,
            "wasabi_version": 8,
        }
        mock_client = MockSupabaseClient([existing_state])

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            result = await repo.get_or_create_state("video-123", "layout", "tenant-456")
            assert result["server_version"] == 10

    async def test_creates_new_state_if_not_exists(self, mock_settings):
        """Should create new state if not found."""
        mock_client = MockSupabaseClient([])

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            result = await repo.get_or_create_state("video-123", "layout", "tenant-456")
            assert result["server_version"] == 0


class TestAcquireLock:
    """Tests for DatabaseStateRepository.acquire_lock()."""

    async def test_acquire_lock_sets_fields(self, mock_settings):
        """Should set lock fields correctly."""
        existing_state = {
            "video_id": "video-123",
            "database_name": "layout",
            "tenant_id": "tenant-456",
            "server_version": 0,
            "wasabi_version": 0,
            "lock_holder_user_id": None,
        }

        # Create a mock that tracks updates
        class TrackingMockTable(MockSupabaseTable):
            updated_data = None

            def update(self, data: dict):
                TrackingMockTable.updated_data = data
                # Merge update into existing data
                merged = {**existing_state, **data}
                self._data = [merged]
                return self

        class TrackingMockClient:
            def __init__(self):
                self._table_data = [existing_state]

            def schema(self, _schema_name: str):
                return self

            def table(self, _table_name: str):
                return TrackingMockTable(self._table_data)

        mock_client = TrackingMockClient()

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            await repo.acquire_lock(
                video_id="video-123",
                db_name="layout",
                user_id="user-789",
                connection_id="conn-abc",
                tenant_id="tenant-456",
            )

            # Check what was updated
            assert TrackingMockTable.updated_data is not None
            assert TrackingMockTable.updated_data["lock_holder_user_id"] == "user-789"
            assert TrackingMockTable.updated_data["lock_type"] == "client"
            assert TrackingMockTable.updated_data["active_connection_id"] == "conn-abc"


class TestReleaseLock:
    """Tests for DatabaseStateRepository.release_lock()."""

    async def test_release_lock_clears_fields(self, mock_settings):
        """Should clear lock fields."""

        class TrackingMockTable(MockSupabaseTable):
            updated_data = None

            def update(self, data: dict):
                TrackingMockTable.updated_data = data
                return self

        class TrackingMockClient:
            def schema(self, _schema_name: str):
                return self

            def table(self, _table_name: str):
                return TrackingMockTable()

        mock_client = TrackingMockClient()

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            await repo.release_lock("video-123", "layout")

            assert TrackingMockTable.updated_data is not None
            assert TrackingMockTable.updated_data["lock_holder_user_id"] is None
            assert TrackingMockTable.updated_data["lock_type"] is None
            assert TrackingMockTable.updated_data["locked_at"] is None
            assert TrackingMockTable.updated_data["active_connection_id"] is None


class TestIncrementServerVersion:
    """Tests for DatabaseStateRepository.increment_server_version()."""

    async def test_increments_version(self, mock_settings):
        """Should increment server_version by 1."""
        existing_state = {
            "video_id": "video-123",
            "database_name": "layout",
            "server_version": 5,
        }

        class TrackingMockTable(MockSupabaseTable):
            updated_data = None

            def __init__(self, data=None):
                super().__init__(data)

            def update(self, data: dict):
                TrackingMockTable.updated_data = data
                return self

        class TrackingMockClient:
            def __init__(self):
                self._table_data = [existing_state]

            def schema(self, _schema_name: str):
                return self

            def table(self, _table_name: str):
                return TrackingMockTable(self._table_data)

        mock_client = TrackingMockClient()

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            new_version = await repo.increment_server_version("video-123", "layout")

            assert new_version == 6
            assert TrackingMockTable.updated_data is not None
            assert TrackingMockTable.updated_data["server_version"] == 6

    async def test_returns_zero_when_no_state(self, mock_settings):
        """Should return 0 when state doesn't exist."""
        mock_client = MockSupabaseClient([])

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            result = await repo.increment_server_version("video-123", "layout")
            assert result == 0


class TestGetPendingUploads:
    """Tests for DatabaseStateRepository.get_pending_uploads()."""

    async def test_filters_by_idle_timeout(self, mock_settings):
        """Should return databases idle for specified minutes."""
        now = datetime.now(timezone.utc)
        old_activity = (now - timedelta(minutes=10)).isoformat()
        recent_activity = (now - timedelta(minutes=2)).isoformat()

        states = [
            {
                "video_id": "video-1",
                "database_name": "layout",
                "server_version": 5,
                "wasabi_version": 3,
                "last_activity_at": old_activity,
                "wasabi_synced_at": now.isoformat(),
            },
            {
                "video_id": "video-2",
                "database_name": "layout",
                "server_version": 2,
                "wasabi_version": 1,
                "last_activity_at": recent_activity,
                "wasabi_synced_at": now.isoformat(),
            },
        ]
        mock_client = MockSupabaseClient(states)

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            pending = await repo.get_pending_uploads(
                idle_minutes=5, checkpoint_minutes=15
            )

            # Only video-1 should be pending (idle for 10 min > 5 min threshold)
            assert len(pending) == 1
            assert pending[0]["video_id"] == "video-1"

    async def test_filters_by_checkpoint_timeout(self, mock_settings):
        """Should return databases past checkpoint timeout."""
        now = datetime.now(timezone.utc)
        recent_activity = (now - timedelta(minutes=1)).isoformat()
        old_sync = (now - timedelta(minutes=20)).isoformat()

        states = [
            {
                "video_id": "video-1",
                "database_name": "layout",
                "server_version": 5,
                "wasabi_version": 3,
                "last_activity_at": recent_activity,  # Recent activity
                "wasabi_synced_at": old_sync,  # But old sync
            },
        ]
        mock_client = MockSupabaseClient(states)

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            pending = await repo.get_pending_uploads(
                idle_minutes=5, checkpoint_minutes=15
            )

            # Should be pending due to checkpoint timeout (20 min > 15 min)
            assert len(pending) == 1

    async def test_excludes_synced_databases(self, mock_settings):
        """Should exclude databases where server_version == wasabi_version."""
        states = [
            {
                "video_id": "video-1",
                "database_name": "layout",
                "server_version": 5,
                "wasabi_version": 5,  # Already synced
                "last_activity_at": "2024-01-01T00:00:00+00:00",
                "wasabi_synced_at": "2024-01-01T00:00:00+00:00",
            },
        ]
        mock_client = MockSupabaseClient(states)

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            pending = await repo.get_pending_uploads(
                idle_minutes=5, checkpoint_minutes=15
            )

            assert len(pending) == 0


class TestGetAllWithUnsavedChanges:
    """Tests for DatabaseStateRepository.get_all_with_unsaved_changes()."""

    async def test_returns_unsaved_databases(self, mock_settings):
        """Should return databases with server_version > wasabi_version."""
        states = [
            {
                "video_id": "video-1",
                "database_name": "layout",
                "server_version": 5,
                "wasabi_version": 3,  # Unsaved
            },
            {
                "video_id": "video-2",
                "database_name": "layout",
                "server_version": 5,
                "wasabi_version": 5,  # Synced
            },
            {
                "video_id": "video-3",
                "database_name": "captions",
                "server_version": 10,
                "wasabi_version": 8,  # Unsaved
            },
        ]
        mock_client = MockSupabaseClient(states)

        with patch(
            "app.services.supabase_client.get_settings", return_value=mock_settings
        ):
            repo = DatabaseStateRepository(client=mock_client)
            unsaved = await repo.get_all_with_unsaved_changes()

            assert len(unsaved) == 2
            video_ids = {s["video_id"] for s in unsaved}
            assert video_ids == {"video-1", "video-3"}
