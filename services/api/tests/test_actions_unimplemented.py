"""Tests for unimplemented action endpoints.

Tests verify that unimplemented endpoints:
1. Return 501 Not Implemented status
2. Return proper error messages
3. Validate request schemas even though not implemented
"""

from collections.abc import AsyncGenerator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext


@pytest.fixture
async def unimplemented_actions_client(
    app: FastAPI,
    auth_context: AuthContext,
) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for unimplemented action endpoints."""
    from app.dependencies import get_auth_context

    app.dependency_overrides[get_auth_context] = lambda: auth_context

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


class TestAnalyzeLayoutUnimplemented:
    """Tests for POST /actions/analyze-layout endpoint (not implemented)."""

    async def test_analyze_layout_returns_501(
        self, unimplemented_actions_client: AsyncClient, test_video_id: str
    ):
        """Should return 501 Not Implemented status."""
        response = await unimplemented_actions_client.post(
            f"/videos/{test_video_id}/actions/analyze-layout"
        )
        assert response.status_code == 501

    async def test_analyze_layout_error_message(
        self, unimplemented_actions_client: AsyncClient, test_video_id: str
    ):
        """Should return proper error message indicating not implemented."""
        response = await unimplemented_actions_client.post(
            f"/videos/{test_video_id}/actions/analyze-layout"
        )
        assert response.status_code == 501

        data = response.json()
        assert "detail" in data
        assert "not" in data["detail"].lower()
        assert "implemented" in data["detail"].lower()


class TestCalculatePredictionsUnimplemented:
    """Tests for POST /actions/calculate-predictions endpoint (not implemented)."""

    async def test_calculate_predictions_returns_501(
        self, unimplemented_actions_client: AsyncClient, test_video_id: str
    ):
        """Should return 501 Not Implemented status."""
        response = await unimplemented_actions_client.post(
            f"/videos/{test_video_id}/actions/calculate-predictions"
        )
        assert response.status_code == 501

    async def test_calculate_predictions_error_message(
        self, unimplemented_actions_client: AsyncClient, test_video_id: str
    ):
        """Should return proper error message indicating not implemented."""
        response = await unimplemented_actions_client.post(
            f"/videos/{test_video_id}/actions/calculate-predictions"
        )
        assert response.status_code == 501

        data = response.json()
        assert "detail" in data
        assert "not" in data["detail"].lower()
        assert "implemented" in data["detail"].lower()


class TestRetryProcessingUnimplemented:
    """Tests for POST /actions/retry endpoint (not implemented)."""

    async def test_retry_returns_501(
        self, unimplemented_actions_client: AsyncClient, test_video_id: str
    ):
        """Should return 501 Not Implemented status."""
        response = await unimplemented_actions_client.post(
            f"/videos/{test_video_id}/actions/retry",
            json={"step": "ocr"},
        )
        assert response.status_code == 501

    async def test_retry_error_message(
        self, unimplemented_actions_client: AsyncClient, test_video_id: str
    ):
        """Should return proper error message indicating not implemented."""
        response = await unimplemented_actions_client.post(
            f"/videos/{test_video_id}/actions/retry",
            json={"step": "ocr"},
        )
        assert response.status_code == 501

        data = response.json()
        assert "detail" in data
        assert "not" in data["detail"].lower()
        assert "implemented" in data["detail"].lower()

    async def test_retry_validates_request_schema(
        self, unimplemented_actions_client: AsyncClient, test_video_id: str
    ):
        """Should validate request schema even though not implemented."""
        # Test with invalid step value
        response = await unimplemented_actions_client.post(
            f"/videos/{test_video_id}/actions/retry",
            json={"step": "invalid-step"},
        )
        # Should return 422 validation error, not 501
        assert response.status_code == 422

    async def test_retry_accepts_valid_steps(
        self, unimplemented_actions_client: AsyncClient, test_video_id: str
    ):
        """Should accept all valid step values in RetryStep enum."""
        valid_steps = ["full-frames", "ocr", "crop", "inference"]

        for step in valid_steps:
            response = await unimplemented_actions_client.post(
                f"/videos/{test_video_id}/actions/retry",
                json={"step": step},
            )
            # All should return 501 (not 422 validation error)
            assert response.status_code == 501

    async def test_retry_requires_step_field(
        self, unimplemented_actions_client: AsyncClient, test_video_id: str
    ):
        """Should require 'step' field in request body."""
        response = await unimplemented_actions_client.post(
            f"/videos/{test_video_id}/actions/retry",
            json={},
        )
        # Should return 422 validation error for missing required field
        assert response.status_code == 422
