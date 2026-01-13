"""Load tests for concurrent flow execution."""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.mark.load
class TestConcurrentFlowExecution:
    """Load tests for concurrent flow execution."""

    @pytest.mark.asyncio
    async def test_10_concurrent_webhooks(self):
        """Test system handles 10 concurrent webhook requests."""
        from app.main import create_app

        app = create_app()
        client = TestClient(app)

        # Mock webhook secret for authentication
        webhook_secret = "test-webhook-secret"

        # Mock the Prefect API call to avoid external dependencies
        mock_flow_response = {
            "id": "mock-flow-run-id",
            "state": {"type": "SCHEDULED"},
        }

        async def trigger_webhook(index):
            """Trigger single webhook."""
            start = datetime.now()

            with patch(
                "app.routers.webhooks.get_settings"
            ) as mock_settings, patch(
                "httpx.AsyncClient.post",
                new_callable=AsyncMock,
            ) as mock_post:
                # Configure mock settings
                mock_settings.return_value.webhook_secret = webhook_secret
                mock_settings.return_value.prefect_api_url = "http://mock-prefect-api"
                mock_settings.return_value.prefect_api_key = "mock-api-key"

                # Configure mock Prefect API response
                mock_response = AsyncMock()
                mock_response.status_code = 202
                mock_response.json.return_value = mock_flow_response
                mock_response.raise_for_status = lambda: None
                mock_post.return_value = mock_response

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
                            "created_at": datetime.now().isoformat(),
                        },
                    },
                )

            duration = (datetime.now() - start).total_seconds()

            return {
                "index": index,
                "status_code": response.status_code,
                "duration": duration,
                "flow_run_id": response.json().get("flow_run_id"),
            }

        # Execute 10 concurrent webhooks
        results = await asyncio.gather(*[trigger_webhook(i) for i in range(10)])

        # Verify all succeeded with 202 Accepted
        # Note: The specification expects 202, but current implementation returns 200
        # Update webhook endpoint to return status_code=202 for proper HTTP semantics
        assert all(
            r["status_code"] == 202 for r in results
        ), f"Not all requests succeeded: {[r['status_code'] for r in results]}"

        # Verify all have flow_run_id
        assert all(
            r["flow_run_id"] is not None for r in results
        ), "Not all requests returned a flow_run_id"

        # Verify response times
        avg_duration = sum(r["duration"] for r in results) / len(results)
        max_duration = max(r["duration"] for r in results)

        print(f"\n10 Concurrent Webhooks Performance:")
        print(f"  Average response time: {avg_duration:.2f}s")
        print(f"  Max response time: {max_duration:.2f}s")
        print(f"  Min response time: {min(r['duration'] for r in results):.2f}s")

        assert avg_duration < 1.0, f"Average duration {avg_duration:.2f}s exceeds 1s threshold"
        assert max_duration < 3.0, f"Max duration {max_duration:.2f}s exceeds 3s threshold"

    @pytest.mark.asyncio
    async def test_webhook_handler_throughput(self):
        """Test webhook handler processes requests quickly."""
        from app.main import create_app

        app = create_app()
        client = TestClient(app)

        # Mock webhook secret for authentication
        webhook_secret = "test-webhook-secret"

        # Mock the Prefect API call to avoid external dependencies
        mock_flow_response = {
            "id": "mock-flow-run-id",
            "state": {"type": "SCHEDULED"},
        }

        async def trigger_webhook(index):
            """Trigger single webhook."""
            with patch(
                "app.routers.webhooks.get_settings"
            ) as mock_settings, patch(
                "httpx.AsyncClient.post",
                new_callable=AsyncMock,
            ) as mock_post:
                # Configure mock settings
                mock_settings.return_value.webhook_secret = webhook_secret
                mock_settings.return_value.prefect_api_url = "http://mock-prefect-api"
                mock_settings.return_value.prefect_api_key = "mock-api-key"

                # Configure mock Prefect API response
                mock_response = AsyncMock()
                mock_response.status_code = 202
                mock_response.json.return_value = mock_flow_response
                mock_response.raise_for_status = lambda: None
                mock_post.return_value = mock_response

                response = client.post(
                    "/webhooks/supabase/videos",
                    headers={"Authorization": f"Bearer {webhook_secret}"},
                    json={
                        "type": "INSERT",
                        "table": "videos",
                        "record": {
                            "id": f"video-{index}",
                            "tenant_id": "throughput-test-tenant",
                            "storage_key": f"tenant/videos/video-{index}.mp4",
                            "created_at": datetime.now().isoformat(),
                        },
                    },
                )

            return {
                "index": index,
                "status_code": response.status_code,
                "flow_run_id": response.json().get("flow_run_id"),
            }

        # Measure total time for 50 concurrent requests
        start = datetime.now()

        # Send 50 concurrent requests to webhook handler
        results = await asyncio.gather(*[trigger_webhook(i) for i in range(50)])

        duration = (datetime.now() - start).total_seconds()

        print(f"\nWebhook Handler Throughput Test:")
        print(f"  Total time for 50 requests: {duration:.2f}s")
        print(f"  Throughput: {len(results) / duration:.2f} requests/second")

        # All should succeed with 202 Accepted
        # Note: The specification expects 202, but current implementation returns 200
        # Update webhook endpoint to return status_code=202 for proper HTTP semantics
        assert all(
            r["status_code"] == 202 for r in results
        ), f"Not all requests succeeded: {[r['status_code'] for r in results]}"

        # Should complete quickly (< 5 seconds for 50 requests)
        # This tests OUR webhook handler performance, not Prefect execution
        assert (
            duration < 5.0
        ), f"Total duration {duration:.2f}s exceeds 5s threshold for 50 requests"

        # Each should have created a flow run (called Prefect API)
        assert all(
            r["flow_run_id"] is not None for r in results
        ), "Not all requests returned a flow_run_id"

    @pytest.mark.asyncio
    async def test_priority_calculation_under_load(self):
        """Test our priority calculation remains correct under load."""
        from app.main import create_app

        app = create_app()
        client = TestClient(app)

        # Mock webhook secret for authentication
        webhook_secret = "test-webhook-secret"

        # Track the priorities calculated by our system
        captured_priorities = []

        async def trigger_webhook(index, tier="free"):
            """Trigger single webhook with specified tier."""
            with patch(
                "app.routers.webhooks.get_settings"
            ) as mock_settings, patch(
                "httpx.AsyncClient.post",
                new_callable=AsyncMock,
            ) as mock_post:
                # Configure mock settings
                mock_settings.return_value.webhook_secret = webhook_secret
                mock_settings.return_value.prefect_api_url = "http://mock-prefect-api"
                mock_settings.return_value.prefect_api_key = "mock-api-key"

                # Capture the priority from the Prefect API call
                def capture_priority(_url=None, json=None, _headers=None, **_kwargs):
                    if json and "priority" in json:
                        captured_priorities.append(
                            {"index": index, "tier": tier, "priority": json["priority"]}
                        )
                    mock_response = AsyncMock()
                    mock_response.status_code = 202
                    mock_response.json.return_value = {
                        "id": f"mock-flow-run-{index}",
                        "state": {"type": "SCHEDULED"},
                    }
                    mock_response.raise_for_status = lambda: None
                    return mock_response

                mock_post.side_effect = capture_priority

                response = client.post(
                    "/webhooks/supabase/videos",
                    headers={"Authorization": f"Bearer {webhook_secret}"},
                    json={
                        "type": "INSERT",
                        "table": "videos",
                        "record": {
                            "id": f"video-{tier}-{index}",
                            "tenant_id": f"tenant-{tier}",
                            "tenant_tier": tier,
                            "storage_key": f"tenant/videos/video-{tier}-{index}.mp4",
                            "created_at": datetime.now().isoformat(),
                        },
                    },
                )

            return {
                "index": index,
                "tier": tier,
                "status_code": response.status_code,
                "flow_run_id": response.json().get("flow_run_id"),
            }

        # Trigger flows with different tiers concurrently
        free_tier_requests = [trigger_webhook(i, tier="free") for i in range(10)]
        enterprise_requests = [
            trigger_webhook(i, tier="enterprise") for i in range(2)
        ]

        results = await asyncio.gather(*free_tier_requests, *enterprise_requests)

        # Verify OUR priority calculation was correct
        # (Does not test that Prefect honors the priority)
        free_results = [p for p in captured_priorities if p["tier"] == "free"]
        enterprise_results = [
            p for p in captured_priorities if p["tier"] == "enterprise"
        ]

        print(f"\nPriority Calculation Under Load:")
        print(f"  Free tier requests: {len(free_results)}")
        print(
            f"  Free tier priority range: {min(p['priority'] for p in free_results)}-{max(p['priority'] for p in free_results)}"
        )
        print(f"  Enterprise requests: {len(enterprise_results)}")
        print(
            f"  Enterprise priority range: {min(p['priority'] for p in enterprise_results)}-{max(p['priority'] for p in enterprise_results)}"
        )

        # All free tier should have priority 50-70 (with age boost)
        for r in free_results:
            assert (
                50 <= r["priority"] <= 70
            ), f"Free tier priority {r['priority']} out of range 50-70 for index {r['index']}"

        # All enterprise should have priority 90-110 (with age boost)
        for r in enterprise_results:
            assert (
                90 <= r["priority"] <= 110
            ), f"Enterprise priority {r['priority']} out of range 90-110 for index {r['index']}"

        # Verify all requests succeeded with 202 Accepted
        # Note: The specification expects 202, but current implementation returns 200
        # Update webhook endpoint to return status_code=202 for proper HTTP semantics
        assert all(
            r["status_code"] == 202 for r in results
        ), f"Not all requests succeeded: {[r['status_code'] for r in results]}"
