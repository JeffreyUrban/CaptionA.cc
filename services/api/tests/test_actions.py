"""Tests for action endpoints."""

import sqlite3
from collections.abc import AsyncGenerator
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext


@pytest.fixture
def seeded_action_layout_db(layout_db: Path) -> Path:
    """Create a layout.db for action tests."""
    conn = sqlite3.connect(str(layout_db))
    conn.executescript(
        """
        INSERT INTO video_layout_config (
            id, frame_width, frame_height, crop_left, crop_top, crop_right, crop_bottom,
            selection_mode, crop_region_version
        ) VALUES (1, 1920, 1080, 0, 0, 0, 0, 'manual', 1);

        INSERT INTO video_preferences (id, layout_approved) VALUES (1, 0);
        """
    )
    conn.commit()
    conn.close()
    return layout_db


@pytest.fixture
def mock_action_layout_manager(seeded_action_layout_db: Path):
    """Mock LayoutDatabaseManager for action tests."""
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
        async def get_or_create_database(
            self, tenant_id: str, video_id: str, writable: bool = False
        ):
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()

    return MockLayoutDatabaseManager(seeded_action_layout_db)


@pytest.fixture
async def actions_client(
    app: FastAPI,
    auth_context: AuthContext,
    mock_seeded_ocr_database_manager,
    mock_action_layout_manager,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for action endpoints."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    with patch(
        "app.routers.actions.get_ocr_database_manager",
        return_value=mock_seeded_ocr_database_manager,
    ), patch(
        "app.routers.actions.get_layout_database_manager",
        return_value=mock_action_layout_manager,
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


class TestBulkAnnotate:
    """Tests for POST /actions/bulk-annotate endpoint."""

    async def test_bulk_annotate_mark_in(
        self, actions_client: AsyncClient, test_video_id: str
    ):
        """Should mark boxes within rectangle as 'in'."""
        response = await actions_client.post(
            f"/videos/{test_video_id}/actions/bulk-annotate",
            json={
                "rectangle": {"left": 0, "top": 0, "right": 500, "bottom": 500},
                "action": "mark_in",
                "frame": 0,
            },
        )
        assert response.status_code == 200

        data = response.json()
        assert data["success"] is True
        assert data["boxesModified"] >= 0

    async def test_bulk_annotate_mark_out(
        self, actions_client: AsyncClient, test_video_id: str
    ):
        """Should mark boxes within rectangle as 'out'."""
        response = await actions_client.post(
            f"/videos/{test_video_id}/actions/bulk-annotate",
            json={
                "rectangle": {"left": 0, "top": 0, "right": 500, "bottom": 500},
                "action": "mark_out",
                "frame": 0,
            },
        )
        assert response.status_code == 200
        assert response.json()["success"] is True

    async def test_bulk_annotate_all_frames(
        self, actions_client: AsyncClient, test_video_id: str
    ):
        """Should annotate boxes across all frames."""
        response = await actions_client.post(
            f"/videos/{test_video_id}/actions/bulk-annotate",
            json={
                "rectangle": {"left": 0, "top": 0, "right": 500, "bottom": 500},
                "action": "mark_in",
                "allFrames": True,
            },
        )
        assert response.status_code == 200

        data = response.json()
        assert data["success"] is True
        assert data["framesAffected"] >= 0

    async def test_bulk_annotate_requires_frame_or_all(
        self, actions_client: AsyncClient, test_video_id: str
    ):
        """Should require either frame or allFrames."""
        response = await actions_client.post(
            f"/videos/{test_video_id}/actions/bulk-annotate",
            json={
                "rectangle": {"left": 0, "top": 0, "right": 500, "bottom": 500},
                "action": "mark_in",
            },
        )
        assert response.status_code == 400

    async def test_bulk_annotate_no_boxes_in_rectangle(
        self, actions_client: AsyncClient, test_video_id: str
    ):
        """Should return success with zero boxes when none match."""
        response = await actions_client.post(
            f"/videos/{test_video_id}/actions/bulk-annotate",
            json={
                "rectangle": {"left": 9000, "top": 9000, "right": 9100, "bottom": 9100},
                "action": "mark_in",
                "frame": 0,
            },
        )
        assert response.status_code == 200

        data = response.json()
        assert data["success"] is True
        assert data["boxesModified"] == 0


class TestAnalyzeLayout:
    """Tests for POST /actions/analyze-layout endpoint."""

    async def test_analyze_layout_not_implemented(
        self, actions_client: AsyncClient, test_video_id: str
    ):
        """Should return 501 Not Implemented."""
        response = await actions_client.post(
            f"/videos/{test_video_id}/actions/analyze-layout"
        )
        assert response.status_code == 501


class TestCalculatePredictions:
    """Tests for POST /actions/calculate-predictions endpoint."""

    async def test_calculate_predictions_not_implemented(
        self, actions_client: AsyncClient, test_video_id: str
    ):
        """Should return 501 Not Implemented."""
        response = await actions_client.post(
            f"/videos/{test_video_id}/actions/calculate-predictions"
        )
        assert response.status_code == 501


class TestTriggerProcessing:
    """Tests for POST /actions/trigger-processing endpoint."""

    async def test_trigger_processing_not_implemented(
        self, actions_client: AsyncClient, test_video_id: str
    ):
        """Should return 501 Not Implemented."""
        response = await actions_client.post(
            f"/videos/{test_video_id}/actions/trigger-processing",
            json={"type": "crop-and-infer-caption-frame-extents"},
        )
        assert response.status_code == 501


class TestRetryProcessing:
    """Tests for POST /actions/retry endpoint."""

    async def test_retry_not_implemented(
        self, actions_client: AsyncClient, test_video_id: str
    ):
        """Should return 501 Not Implemented."""
        response = await actions_client.post(
            f"/videos/{test_video_id}/actions/retry",
            json={"step": "ocr"},
        )
        assert response.status_code == 501
