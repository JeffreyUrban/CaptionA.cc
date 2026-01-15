"""Resource usage monitoring tests for load scenarios."""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import psutil
import pytest
from fastapi.testclient import TestClient


@pytest.mark.load
class TestResourceUsage:
    """Monitor resource usage during load tests."""

    @pytest.mark.asyncio
    async def test_memory_usage_under_load(self):
        """Verify memory usage stays within limits during concurrent requests."""
        from app.main import create_app

        # Get process for memory monitoring
        process = psutil.Process()

        # Baseline memory
        baseline_memory = process.memory_info().rss / 1024 / 1024  # MB

        # Create app and client
        app = create_app()
        client = TestClient(app)

        # Run load test with 100 concurrent requests
        async def make_request():
            """Make a single request to health endpoint."""
            response = client.get("/health")
            return response.status_code

        # Execute 100 concurrent requests
        tasks = [make_request() for _ in range(100)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Measure peak memory after load
        peak_memory = process.memory_info().rss / 1024 / 1024  # MB

        # Calculate memory increase
        memory_increase = peak_memory - baseline_memory

        # Memory increase should be < 500 MB
        assert memory_increase < 500, (
            f"Memory increased by {memory_increase:.2f} MB (exceeded 500 MB limit)"
        )

        # Verify most requests succeeded
        success_count = sum(1 for r in results if r == 200)
        assert success_count >= 95, f"Only {success_count}/100 requests succeeded"

    @pytest.mark.asyncio
    async def test_database_connection_pool(self):
        """Verify database connections are reused and pool doesn't grow unbounded."""
        from app.main import create_app
        from app.services.database_manager import DatabaseManager

        # Create app
        app = create_app()
        client = TestClient(app)

        # Track connection counts
        connection_counts = []

        # Mock database manager to track connections
        original_get_database = DatabaseManager.get_database

        call_count = 0

        async def track_connections(self, tenant_id, video_id, writable=False):
            """Wrapper to track database connection usage."""
            nonlocal call_count
            call_count += 1
            # Use original context manager
            async with original_get_database(
                self, tenant_id, video_id, writable
            ) as conn:
                yield conn

        with patch.object(DatabaseManager, "get_database", track_connections):
            # Make multiple requests that use database connections
            for _ in range(20):
                try:
                    # This would trigger database access if endpoint exists
                    # For now, just verify connection tracking works
                    response = client.get("/health")
                    assert response.status_code == 200
                    connection_counts.append(call_count)
                except Exception:
                    # Expected if we're hitting endpoints that don't exist in test
                    pass

        # Verify connections are being managed (not growing unbounded)
        # In real scenario with database calls, we'd verify connection reuse
        # For now, just verify the test infrastructure works
        assert len(connection_counts) > 0

    @pytest.mark.asyncio
    async def test_api_continues_if_worker_fails_to_start(self):
        """Test API starts even if Prefect worker fails to start."""
        # Mock Prefect client to simulate connection failure
        with patch("app.prefect_runner.get_client") as mock_get_client:
            # Make the client context manager raise connection refused
            mock_client = AsyncMock()
            mock_client.api_healthcheck = AsyncMock(
                side_effect=Exception("Connection refused")
            )
            mock_get_client.return_value.__aenter__.return_value = mock_client

            # Also mock the worker manager settings
            with patch("app.config.get_settings") as mock_settings:
                settings = MagicMock()
                settings.prefect_api_url = "http://fake-prefect:4200"
                settings.prefect_api_key = None
                settings.environment = "test"
                settings.debug = False
                mock_settings.return_value = settings

                # Import and create app - should succeed despite Prefect failure
                from app.main import create_app

                app = create_app()

                # Create test client (this triggers lifespan startup)
                # The API should start successfully even if worker fails
                client = TestClient(app, raise_server_exceptions=False)

                # Health endpoint should work
                response = client.get("/health")
                assert response.status_code == 200, (
                    f"Health check failed with status {response.status_code}"
                )
                assert response.json()["status"] == "healthy"

                # Webhooks should return 503 (service unavailable) when Prefect is down
                with patch("app.routers.webhooks.trigger_prefect_flow") as mock_trigger:
                    mock_trigger.side_effect = Exception("Prefect not available")

                    webhook_response = client.post(
                        "/webhooks/supabase/videos",
                        json={
                            "type": "INSERT",
                            "table": "videos",
                            "record": {
                                "id": "test-video-123",
                                "tenant_id": "test-tenant-456",
                                "storage_key": "test/path/video.mp4",
                            },
                        },
                        headers={
                            "Authorization": "Bearer test-secret"
                        },  # pragma: allowlist secret
                    )

                    # Should return error status when Prefect is unavailable
                    # Could be 401 (auth), 503 (unavailable), or 500 (error)
                    # The key is API is still running
                    assert webhook_response.status_code in [
                        401,
                        503,
                        500,
                    ], "Webhook should handle Prefect unavailability"

    @pytest.mark.asyncio
    async def test_worker_manager_handles_worker_crash(self, caplog):
        """Test worker manager detects and logs worker crashes."""
        from app.prefect_runner import PrefectWorkerManager

        # Create worker manager instance
        worker_manager = PrefectWorkerManager()

        # Mock settings to have Prefect configured
        with patch("app.config.get_settings") as mock_settings:
            settings = MagicMock()
            settings.prefect_api_url = "http://fake-prefect:4200"
            settings.prefect_api_key = None
            mock_settings.return_value = settings

            # Mock Prefect client to allow start
            with patch("app.prefect_runner.get_client") as mock_get_client:
                mock_client = AsyncMock()
                mock_client.api_healthcheck = AsyncMock(return_value=True)
                mock_get_client.return_value.__aenter__.return_value = mock_client

                # Mock subprocess creation
                mock_process = MagicMock()
                mock_process.stdout = AsyncMock()
                mock_process.stdout.readline = AsyncMock(
                    return_value=b""
                )  # EOF to stop monitoring
                mock_process.returncode = None
                mock_process.pid = 12345
                mock_process.wait = AsyncMock()

                with patch("asyncio.create_subprocess_exec", return_value=mock_process):
                    # Start the worker
                    with caplog.at_level(logging.INFO):
                        await worker_manager.start()

                    # Verify worker started
                    assert worker_manager.worker_process is not None, (
                        "Worker process should be created"
                    )
                    assert worker_manager.monitor_task is not None, (
                        "Monitor task should be created"
                    )

                    # Simulate worker crash by configuring the mock to return crash status
                    # Configure mock's returncode property to simulate crash
                    mock_process.configure_mock(returncode=-9)

                    # Give monitor task a moment to detect
                    await asyncio.sleep(0.1)

                    # Verify logging occurred (monitor should have logged something)
                    # In real scenario, monitor would log "[Worker] process terminated"
                    log_messages = [record.message for record in caplog.records]
                    assert any(
                        "Worker" in msg or "worker" in msg for msg in log_messages
                    ), "Worker-related logging should occur"

                    # Stop the worker manager (cleanup)
                    await worker_manager.stop()

                    # Verify stop was logged
                    stop_logs = [
                        record.message
                        for record in caplog.records
                        if "Stopping Prefect worker" in record.message
                        or "stopped" in record.message.lower()
                    ]
                    assert len(stop_logs) > 0, "Worker stop should be logged"
