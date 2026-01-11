"""Pytest fixtures for API tests."""

import sqlite3
import tempfile
from collections.abc import AsyncGenerator, Generator
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext
from app.main import create_app


@pytest.fixture
def test_tenant_id() -> str:
    """Test tenant ID."""
    return "test-tenant-123"


@pytest.fixture
def test_user_id() -> str:
    """Test user ID."""
    return "test-user-456"


@pytest.fixture
def test_video_id() -> str:
    """Test video ID."""
    return "test-video-789"


@pytest.fixture
def auth_context(test_tenant_id: str, test_user_id: str) -> AuthContext:
    """Create a test auth context."""
    return AuthContext(
        user_id=test_user_id,
        tenant_id=test_tenant_id,
        email="test@example.com",
    )


@pytest.fixture
def temp_db_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for test databases."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def captions_db(temp_db_dir: Path) -> Generator[Path, None, None]:
    """Create a test captions.db with schema."""
    db_path = temp_db_dir / "captions.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        -- Database metadata for migrations
        CREATE TABLE IF NOT EXISTS database_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        INSERT OR REPLACE INTO database_metadata (key, value) VALUES ('schema_version', '2');

        -- Main captions table
        CREATE TABLE IF NOT EXISTS captions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_frame_index INTEGER NOT NULL,
            end_frame_index INTEGER NOT NULL,
            boundary_state TEXT NOT NULL DEFAULT 'predicted'
                CHECK (boundary_state IN ('predicted', 'confirmed', 'gap')),
            boundary_pending INTEGER NOT NULL DEFAULT 1,
            boundary_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            text TEXT,
            text_pending INTEGER NOT NULL DEFAULT 1,
            text_status TEXT,
            text_notes TEXT,
            text_ocr_combined TEXT,
            text_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            image_needs_regen INTEGER NOT NULL DEFAULT 0,
            median_ocr_status TEXT NOT NULL DEFAULT 'queued',
            median_ocr_error TEXT,
            median_ocr_processed_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Index for frame range queries
        CREATE INDEX IF NOT EXISTS idx_captions_frame_range
            ON captions(start_frame_index, end_frame_index);
        """
    )
    conn.commit()
    conn.close()
    yield db_path


@pytest.fixture
def seeded_captions_db(captions_db: Path) -> Path:
    """Create a captions.db with some test data."""
    conn = sqlite3.connect(str(captions_db))
    conn.executescript(
        """
        INSERT INTO captions (id, start_frame_index, end_frame_index, boundary_state, boundary_pending, text)
        VALUES
            (1, 0, 100, 'confirmed', 0, 'First caption'),
            (2, 101, 200, 'predicted', 1, NULL),
            (3, 201, 300, 'gap', 0, NULL),
            (4, 301, 400, 'confirmed', 0, 'Fourth caption');
        """
    )
    conn.commit()
    conn.close()
    return captions_db


@pytest.fixture
def mock_database_manager(captions_db: Path):
    """Mock DatabaseManager that uses the test database."""
    from contextlib import asynccontextmanager

    class MockDatabaseManager:
        def __init__(self, db_path: Path):
            self.db_path = db_path

        @asynccontextmanager
        async def get_database(self, tenant_id: str, video_id: str, writable: bool = False):
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()

        @asynccontextmanager
        async def get_or_create_database(self, tenant_id: str, video_id: str):
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()

    return MockDatabaseManager(captions_db)


@pytest.fixture
def mock_seeded_database_manager(seeded_captions_db: Path):
    """Mock DatabaseManager that uses the seeded test database."""
    from contextlib import asynccontextmanager

    class MockDatabaseManager:
        def __init__(self, db_path: Path):
            self.db_path = db_path

        @asynccontextmanager
        async def get_database(self, tenant_id: str, video_id: str, writable: bool = False):
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()

        @asynccontextmanager
        async def get_or_create_database(self, tenant_id: str, video_id: str):
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()

    return MockDatabaseManager(seeded_captions_db)


@pytest.fixture
def app() -> FastAPI:
    """Create the FastAPI application for testing."""
    return create_app()


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Headers with a mock JWT token."""
    # In tests, we mock the auth dependency, so this just needs to be present
    return {"Authorization": "Bearer test-token"}


@pytest.fixture
async def client(
    app: FastAPI,
    auth_context: AuthContext,
    mock_seeded_database_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client with mocked dependencies."""
    from app.dependencies import get_auth_context
    from app.services.database_manager import get_database_manager

    # Override dependencies
    app.dependency_overrides[get_auth_context] = lambda: auth_context

    with patch(
        "app.routers.captions.get_database_manager",
        return_value=mock_seeded_database_manager,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def client_empty_db(
    app: FastAPI,
    auth_context: AuthContext,
    mock_database_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client with empty database."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    with patch(
        "app.routers.captions.get_database_manager",
        return_value=mock_database_manager,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()
