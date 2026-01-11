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


# =============================================================================
# Layout Database Fixtures
# =============================================================================


@pytest.fixture
def layout_db(temp_db_dir: Path) -> Generator[Path, None, None]:
    """Create a test layout.db with schema."""
    db_path = temp_db_dir / "layout.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        -- Database metadata for schema versioning
        CREATE TABLE IF NOT EXISTS database_metadata (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            migrated_at TEXT
        );
        INSERT OR IGNORE INTO database_metadata (id, schema_version) VALUES (1, 1);

        -- Video layout configuration
        CREATE TABLE IF NOT EXISTS video_layout_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            frame_width INTEGER NOT NULL,
            frame_height INTEGER NOT NULL,
            crop_left INTEGER NOT NULL DEFAULT 0,
            crop_top INTEGER NOT NULL DEFAULT 0,
            crop_right INTEGER NOT NULL DEFAULT 0,
            crop_bottom INTEGER NOT NULL DEFAULT 0,
            selection_left INTEGER,
            selection_top INTEGER,
            selection_right INTEGER,
            selection_bottom INTEGER,
            selection_mode TEXT NOT NULL DEFAULT 'disabled',
            vertical_position REAL,
            vertical_std REAL,
            box_height REAL,
            box_height_std REAL,
            anchor_type TEXT,
            anchor_position REAL,
            top_edge_std REAL,
            bottom_edge_std REAL,
            horizontal_std_slope REAL,
            horizontal_std_intercept REAL,
            crop_bounds_version INTEGER NOT NULL DEFAULT 1,
            analysis_model_version TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Box classification labels
        CREATE TABLE IF NOT EXISTS full_frame_box_labels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            frame_index INTEGER NOT NULL,
            box_index INTEGER NOT NULL,
            label TEXT NOT NULL CHECK (label IN ('in', 'out')),
            label_source TEXT NOT NULL DEFAULT 'user' CHECK (label_source IN ('user', 'model')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(frame_index, box_index, label_source)
        );
        CREATE INDEX IF NOT EXISTS idx_box_labels_frame ON full_frame_box_labels(frame_index);

        -- Box classification model storage
        CREATE TABLE IF NOT EXISTS box_classification_model (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            model_data BLOB,
            model_version TEXT,
            trained_at TEXT
        );

        -- Video preferences
        CREATE TABLE IF NOT EXISTS video_preferences (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            layout_approved INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    conn.commit()
    conn.close()
    yield db_path


@pytest.fixture
def seeded_layout_db(layout_db: Path) -> Path:
    """Create a layout.db with some test data."""
    conn = sqlite3.connect(str(layout_db))
    conn.executescript(
        """
        INSERT INTO video_layout_config (
            id, frame_width, frame_height, crop_left, crop_top, crop_right, crop_bottom,
            selection_mode, crop_bounds_version
        ) VALUES (1, 1920, 1080, 10, 20, 30, 40, 'manual', 1);

        INSERT INTO full_frame_box_labels (frame_index, box_index, label, label_source)
        VALUES
            (0, 0, 'in', 'user'),
            (0, 1, 'out', 'user'),
            (1, 0, 'in', 'model'),
            (1, 1, 'in', 'model');

        INSERT INTO video_preferences (id, layout_approved) VALUES (1, 0);
        """
    )
    conn.commit()
    conn.close()
    return layout_db


@pytest.fixture
def layout_db_connection(layout_db: Path) -> sqlite3.Connection:
    """Create a database connection for testing."""
    conn = sqlite3.connect(str(layout_db))
    conn.row_factory = sqlite3.Row
    return conn


@pytest.fixture
def seeded_layout_db_connection(seeded_layout_db: Path) -> sqlite3.Connection:
    """Create a database connection with seeded data."""
    conn = sqlite3.connect(str(seeded_layout_db))
    conn.row_factory = sqlite3.Row
    return conn


@pytest.fixture
def mock_layout_database_manager(layout_db: Path):
    """Mock LayoutDatabaseManager that uses the test database."""
    from contextlib import asynccontextmanager

    class MockLayoutDatabaseManager:
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

    return MockLayoutDatabaseManager(layout_db)


@pytest.fixture
def mock_seeded_layout_database_manager(seeded_layout_db: Path):
    """Mock LayoutDatabaseManager that uses the seeded test database."""
    from contextlib import asynccontextmanager

    class MockLayoutDatabaseManager:
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

    return MockLayoutDatabaseManager(seeded_layout_db)


# =============================================================================
# OCR Database Fixtures
# =============================================================================


@pytest.fixture
def ocr_db(temp_db_dir: Path) -> Generator[Path, None, None]:
    """Create a test fullOCR.db with schema."""
    db_path = temp_db_dir / "fullOCR.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        -- Database metadata for schema versioning
        CREATE TABLE IF NOT EXISTS database_metadata (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            migrated_at TEXT
        );
        INSERT OR IGNORE INTO database_metadata (id, schema_version) VALUES (1, 1);

        -- OCR detection results
        CREATE TABLE IF NOT EXISTS full_frame_ocr (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            frame_id INTEGER NOT NULL,
            frame_index INTEGER NOT NULL,
            box_index INTEGER NOT NULL,
            text TEXT,
            confidence REAL,
            bbox_left INTEGER,
            bbox_top INTEGER,
            bbox_right INTEGER,
            bbox_bottom INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_frame_index ON full_frame_ocr(frame_index);
        """
    )
    conn.commit()
    conn.close()
    yield db_path


@pytest.fixture
def seeded_ocr_db(ocr_db: Path) -> Path:
    """Create a fullOCR.db with test data."""
    conn = sqlite3.connect(str(ocr_db))
    conn.executescript(
        """
        INSERT INTO full_frame_ocr (frame_id, frame_index, box_index, text, confidence, bbox_left, bbox_top, bbox_right, bbox_bottom)
        VALUES
            (0, 0, 0, 'Hello', 0.95, 100, 200, 200, 250),
            (0, 0, 1, 'World', 0.92, 210, 200, 300, 250),
            (1, 1, 0, 'Test', 0.88, 100, 200, 180, 250),
            (1, 1, 1, 'Caption', 0.91, 190, 200, 320, 250),
            (2, 2, 0, 'Another', 0.89, 100, 200, 220, 250),
            (2, 2, 1, 'Hello', 0.94, 230, 200, 330, 250),
            (5, 5, 0, 'Frame five', 0.93, 100, 200, 250, 250);
        """
    )
    conn.commit()
    conn.close()
    return ocr_db


@pytest.fixture
def ocr_db_connection(ocr_db: Path) -> sqlite3.Connection:
    """Create a database connection for testing."""
    conn = sqlite3.connect(str(ocr_db))
    conn.row_factory = sqlite3.Row
    return conn


@pytest.fixture
def seeded_ocr_db_connection(seeded_ocr_db: Path) -> sqlite3.Connection:
    """Create a database connection with seeded data."""
    conn = sqlite3.connect(str(seeded_ocr_db))
    conn.row_factory = sqlite3.Row
    return conn


@pytest.fixture
def mock_ocr_database_manager(ocr_db: Path):
    """Mock OcrDatabaseManager that uses the test database."""
    from contextlib import asynccontextmanager

    class MockOcrDatabaseManager:
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

    return MockOcrDatabaseManager(ocr_db)


@pytest.fixture
def mock_seeded_ocr_database_manager(seeded_ocr_db: Path):
    """Mock OcrDatabaseManager that uses the seeded test database."""
    from contextlib import asynccontextmanager

    class MockOcrDatabaseManager:
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

    return MockOcrDatabaseManager(seeded_ocr_db)


# =============================================================================
# Boxes Endpoint Client Fixtures (requires both OCR and layout databases)
# =============================================================================


@pytest.fixture
def seeded_boxes_layout_db(layout_db: Path) -> Path:
    """Create a layout.db with labels matching OCR box indices."""
    conn = sqlite3.connect(str(layout_db))
    conn.executescript(
        """
        INSERT INTO video_layout_config (
            id, frame_width, frame_height, crop_left, crop_top, crop_right, crop_bottom,
            selection_mode, crop_bounds_version
        ) VALUES (1, 1920, 1080, 10, 20, 30, 40, 'manual', 1);

        -- Labels that match seeded OCR data (frame 0 boxes 0,1; frame 1 boxes 0,1)
        INSERT INTO full_frame_box_labels (frame_index, box_index, label, label_source)
        VALUES
            (0, 0, 'in', 'user'),
            (0, 1, 'out', 'user'),
            (1, 0, 'in', 'model'),
            (1, 1, 'out', 'model');

        INSERT INTO video_preferences (id, layout_approved) VALUES (1, 0);
        """
    )
    conn.commit()
    conn.close()
    return layout_db


@pytest.fixture
def mock_seeded_boxes_layout_manager(seeded_boxes_layout_db: Path):
    """Mock LayoutDatabaseManager for boxes endpoint tests."""
    from contextlib import asynccontextmanager

    class MockLayoutDatabaseManager:
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
        async def get_or_create_database(self, tenant_id: str, video_id: str, writable: bool = False):
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()

    return MockLayoutDatabaseManager(seeded_boxes_layout_db)


@pytest.fixture
async def boxes_client(
    app: FastAPI,
    auth_context: AuthContext,
    mock_seeded_ocr_database_manager,
    mock_seeded_boxes_layout_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for boxes endpoint (requires both OCR and layout)."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    with patch(
        "app.routers.boxes.get_ocr_database_manager",
        return_value=mock_seeded_ocr_database_manager,
    ), patch(
        "app.routers.boxes.get_layout_database_manager",
        return_value=mock_seeded_boxes_layout_manager,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def boxes_client_no_labels(
    app: FastAPI,
    auth_context: AuthContext,
    mock_seeded_ocr_database_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for boxes endpoint with no labels."""
    from contextlib import asynccontextmanager

    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    # Use empty layout manager that raises FileNotFoundError
    class NoLayoutManager:
        @asynccontextmanager
        async def get_database(self, tenant_id: str, video_id: str, writable: bool = False):
            raise FileNotFoundError("No layout database")
            yield  # noqa: B901 - required for async context manager

    with patch(
        "app.routers.boxes.get_ocr_database_manager",
        return_value=mock_seeded_ocr_database_manager,
    ), patch(
        "app.routers.boxes.get_layout_database_manager",
        return_value=NoLayoutManager(),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def layout_client(
    app: FastAPI,
    auth_context: AuthContext,
    mock_seeded_layout_database_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for layout endpoints with mocked dependencies."""
    from app.dependencies import get_auth_context
    from app.services.database_manager import get_layout_database_manager

    # Override dependencies
    app.dependency_overrides[get_auth_context] = lambda: auth_context

    with patch(
        "app.routers.layout.get_layout_database_manager",
        return_value=mock_seeded_layout_database_manager,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


@pytest.fixture
async def layout_client_empty_db(
    app: FastAPI,
    auth_context: AuthContext,
    mock_layout_database_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for layout with empty database."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    with patch(
        "app.routers.layout.get_layout_database_manager",
        return_value=mock_layout_database_manager,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


# =============================================================================
# Preferences Endpoint Client Fixtures
# =============================================================================


@pytest.fixture
async def preferences_client(
    app: FastAPI,
    auth_context: AuthContext,
    mock_seeded_layout_database_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for preferences endpoint."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    with patch(
        "app.routers.preferences.get_layout_database_manager",
        return_value=mock_seeded_layout_database_manager,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


# =============================================================================
# Stats Endpoint Client Fixtures
# =============================================================================


@pytest.fixture
async def stats_client(
    app: FastAPI,
    auth_context: AuthContext,
    mock_seeded_ocr_database_manager,
    mock_seeded_database_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for stats endpoint."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    with patch(
        "app.routers.stats.get_ocr_database_manager",
        return_value=mock_seeded_ocr_database_manager,
    ), patch(
        "app.routers.stats.get_database_manager",
        return_value=mock_seeded_database_manager,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


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
