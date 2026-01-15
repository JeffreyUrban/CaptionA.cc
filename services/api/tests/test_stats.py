"""Tests for /stats endpoint."""

from httpx import AsyncClient


class TestGetStats:
    """Tests for GET /{video_id}/stats endpoint."""

    async def test_get_stats(self, stats_client: AsyncClient, test_video_id: str):
        """Should return video statistics."""
        response = await stats_client.get(f"/videos/{test_video_id}/stats")
        assert response.status_code == 200

        data = response.json()
        stats = data["stats"]

        # Check required fields are present
        assert "totalFrames" in stats
        assert "coveredFrames" in stats
        assert "progressPercent" in stats
        assert "annotationCount" in stats
        assert "needsTextCount" in stats
        assert "processingStatus" in stats

        # Check processing status
        assert stats["processingStatus"] == "ready"

    async def test_stats_annotation_count(self, stats_client: AsyncClient, test_video_id: str):
        """Should count captions correctly."""
        response = await stats_client.get(f"/videos/{test_video_id}/stats")
        data = response.json()

        # Seeded captions_db has 4 captions
        assert data["stats"]["annotationCount"] == 4

    async def test_stats_needs_text_count(self, stats_client: AsyncClient, test_video_id: str):
        """Should count captions needing text."""
        response = await stats_client.get(f"/videos/{test_video_id}/stats")
        data = response.json()

        # Caption 2 (predicted, no text) and caption 3 (gap) need checking
        # Gap captions don't need text, so only caption 2 needs text
        assert data["stats"]["needsTextCount"] >= 1
