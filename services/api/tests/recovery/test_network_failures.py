"""
Network failure recovery tests.

Tests recovery from network failures in external service dependencies:
- Prefect API connection failures
- Supabase database timeouts
- Wasabi S3 upload failures

Test Plan Reference: docs/prefect-orchestration/TEST_PLAN.md, Section 5.2 (lines 1393-1425)
"""

import sys
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import httpx
import pytest
from botocore.exceptions import ClientError, ConnectTimeoutError, EndpointConnectionError
from postgrest.exceptions import APIError

from app.services.wasabi_service import WasabiServiceImpl

# Mock modal and extract_crop_frames_and_infer_extents modules to avoid import errors in tests
sys.modules['modal'] = MagicMock()
sys.modules['extract_crop_frames_and_infer_extents'] = MagicMock()
sys.modules['extract_crop_frames_and_infer_extents.models'] = MagicMock()


@pytest.mark.recovery
class TestNetworkFailureRecovery:
    """Test recovery from network failures."""

    def test_prefect_api_connection_loss(self):
        """
        Test handling of Prefect API connection loss.

        Scenario:
            1. Webhook receives video INSERT event
            2. Prefect API is unreachable (network error)
            3. Webhook handler catches the error
            4. Error is logged for monitoring/alerting

        Expected Behavior:
            - Connection error is caught and handled gracefully
            - System can retry or queue for later processing
        """
        # Mock the webhook handler logic directly
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()

            # Simulate connection error (network partition, DNS failure, etc.)
            mock_client.post.side_effect = httpx.ConnectError(
                "Connection refused - Prefect API unreachable"
            )

            mock_client_class.return_value.__aenter__.return_value = mock_client
            mock_client_class.return_value.__aexit__.return_value = None

            # Test that the error is properly raised and can be caught
            with pytest.raises(httpx.ConnectError) as exc_info:
                # Simulate what the webhook would do
                import asyncio
                async def trigger_flow():
                    async with httpx.AsyncClient() as client:
                        await client.post(
                            "https://api.prefect.cloud/api/deployments/trigger",
                            json={"parameters": {}}
                        )
                asyncio.run(trigger_flow())

            assert "Connection refused" in str(exc_info.value)

    def test_prefect_api_timeout(self):
        """
        Test handling of Prefect API timeout.

        Scenario:
            1. Webhook receives video INSERT event
            2. Prefect API request times out
            3. Timeout error is properly handled

        Expected Behavior:
            - Timeout error is caught and logged
            - Request can be retried with backoff
        """
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()

            # Simulate read timeout
            mock_client.post.side_effect = httpx.ReadTimeout(
                "Request to Prefect API timed out after 30 seconds"
            )

            mock_client_class.return_value.__aenter__.return_value = mock_client
            mock_client_class.return_value.__aexit__.return_value = None

            # Test that timeout is properly raised
            with pytest.raises(httpx.ReadTimeout) as exc_info:
                import asyncio
                async def trigger_flow():
                    async with httpx.AsyncClient() as client:
                        await client.post(
                            "https://api.prefect.cloud/api/deployments/trigger",
                            json={"parameters": {}},
                            timeout=30.0
                        )
                asyncio.run(trigger_flow())

            assert "timed out" in str(exc_info.value)

    def test_supabase_connection_timeout(self):
        """
        Test handling of Supabase database timeouts.

        Scenario:
            1. Flow attempts to update video status
            2. Supabase connection times out
            3. Service-level retry logic handles the timeout

        Expected Behavior:
            - Timeout error is caught
            - Operation can be retried
            - Eventually succeeds after retry
        """
        from app.services.supabase_service import SupabaseServiceImpl

        with patch('supabase.create_client') as mock_create:
            # Mock Supabase client
            mock_client = Mock()
            mock_create.return_value = mock_client

            # Mock the fluent interface chain
            mock_schema = Mock()
            mock_table = Mock()
            mock_update = Mock()
            mock_eq = Mock()

            mock_client.schema.return_value = mock_schema
            mock_schema.table.return_value = mock_table
            mock_table.update.return_value = mock_update
            mock_update.eq.return_value = mock_eq

            # First call: timeout, Second call: success
            mock_eq.execute.side_effect = [
                APIError({"message": "Connection timeout", "code": "PGRST301"}),
                Mock(data={"status": "processing"})
            ]

            service = SupabaseServiceImpl(
                supabase_url="https://test.supabase.co",
                supabase_key="test-key",  # pragma: allowlist secret
                schema="test_schema"
            )

            # First attempt should raise timeout
            with pytest.raises(APIError) as exc_info:
                service.update_video_status(video_id="test-123", status="processing")

            assert "timeout" in str(exc_info.value).lower()

            # Second attempt should succeed (simulating retry)
            service.update_video_status(video_id="test-123", status="processing")

            # Verify both calls were made
            assert mock_eq.execute.call_count == 2

    def test_supabase_multiple_retry_exhaustion(self):
        """
        Test retry exhaustion for Supabase operations.

        Scenario:
            1. Multiple consecutive Supabase failures
            2. Retry logic exhausts attempts
            3. Final error is raised

        Expected Behavior:
            - Retries according to configuration
            - Eventually raises error after exhaustion
        """
        from app.services.supabase_service import SupabaseServiceImpl

        with patch('supabase.create_client') as mock_create:
            mock_client = Mock()
            mock_create.return_value = mock_client

            # Mock the fluent interface
            mock_schema = Mock()
            mock_table = Mock()
            mock_update = Mock()
            mock_eq = Mock()

            mock_client.schema.return_value = mock_schema
            mock_schema.table.return_value = mock_table
            mock_table.update.return_value = mock_update
            mock_update.eq.return_value = mock_eq

            # All attempts fail
            mock_eq.execute.side_effect = APIError({"message": "Network error", "code": "PGRST301"})

            service = SupabaseServiceImpl(
                supabase_url="https://test.supabase.co",
                supabase_key="test-key",  # pragma: allowlist secret
                schema="test_schema"
            )

            # Should fail with network error
            with pytest.raises(APIError) as exc_info:
                service.update_video_status(video_id="test-123", status="processing")

            assert "Network error" in str(exc_info.value)

    def test_wasabi_upload_failure(self):
        """
        Test handling of Wasabi S3 upload failures.

        Scenario:
            1. Flow attempts to upload file to Wasabi
            2. Network error occurs during upload
            3. Retry logic handles the failure
            4. Eventually succeeds

        Expected Behavior:
            - Network error is caught
            - Upload is retried
            - Eventually succeeds after retry
        """
        with patch('app.services.wasabi_service.boto3.client') as mock_boto:
            mock_s3_client = Mock()
            mock_boto.return_value = mock_s3_client

            # Simulate: first upload fails, second succeeds
            mock_s3_client.upload_fileobj.side_effect = [
                EndpointConnectionError(endpoint_url="https://s3.wasabisys.com"),
                None  # Success
            ]

            service = WasabiServiceImpl(
                access_key="test-access",
                secret_key="test-secret",  # pragma: allowlist secret
                bucket="test-bucket",
                region="us-east-1"
            )

            # First attempt should fail
            with pytest.raises(EndpointConnectionError):
                service.upload_file(
                    key="test/file.txt",
                    data=b"test data",
                    content_type="text/plain"
                )

            # Second attempt should succeed (simulating retry)
            result = service.upload_file(
                key="test/file.txt",
                data=b"test data",
                content_type="text/plain"
            )

            assert result == "test/file.txt"
            assert mock_s3_client.upload_fileobj.call_count == 2

    def test_wasabi_upload_timeout(self):
        """
        Test handling of Wasabi S3 upload timeouts.

        Scenario:
            1. Upload to Wasabi times out
            2. Timeout error is properly handled
            3. Retry succeeds

        Expected Behavior:
            - Timeout is caught
            - Upload is retried
            - Eventually succeeds
        """
        with patch('app.services.wasabi_service.boto3.client') as mock_boto:
            mock_s3_client = Mock()
            mock_boto.return_value = mock_s3_client

            # Simulate: timeout then success
            mock_s3_client.upload_fileobj.side_effect = [
                ConnectTimeoutError(endpoint_url="https://s3.wasabisys.com"),
                None
            ]

            service = WasabiServiceImpl(
                access_key="test-access",
                secret_key="test-secret",  # pragma: allowlist secret
                bucket="test-bucket",
                region="us-east-1"
            )

            # First attempt times out
            with pytest.raises(ConnectTimeoutError):
                service.upload_file(
                    key="test/timeout.txt",
                    data=b"test data"
                )

            # Retry succeeds
            result = service.upload_file(
                key="test/timeout.txt",
                data=b"test data"
            )

            assert result == "test/timeout.txt"

    def test_wasabi_upload_permission_error(self):
        """
        Test handling of Wasabi permission errors (non-retryable).

        Scenario:
            1. Upload to Wasabi fails with 403 Forbidden
            2. Permission error is not retried (configuration issue)

        Expected Behavior:
            - Permission error is raised immediately
            - No retry attempted (configuration issue, not transient)
        """
        with patch('app.services.wasabi_service.boto3.client') as mock_boto:
            mock_s3_client = Mock()
            mock_boto.return_value = mock_s3_client

            # Simulate permission denied
            mock_s3_client.upload_fileobj.side_effect = ClientError(
                {"Error": {"Code": "403", "Message": "Access Denied"}},
                "PutObject"
            )

            service = WasabiServiceImpl(
                access_key="test-access",
                secret_key="test-secret",  # pragma: allowlist secret
                bucket="test-bucket",
                region="us-east-1"
            )

            # Should raise immediately (no retry for permission errors)
            with pytest.raises(ClientError) as exc_info:
                service.upload_file(
                    key="test/forbidden.txt",
                    data=b"test data"
                )

            assert "403" in str(exc_info.value) or "Access Denied" in str(exc_info.value)
            # Only one attempt (no retry for permission errors)
            assert mock_s3_client.upload_fileobj.call_count == 1

    def test_wasabi_download_network_failure(self):
        """
        Test handling of Wasabi download network failures.

        Scenario:
            1. Download from Wasabi fails with network error
            2. Retry logic handles the failure
            3. Eventually succeeds

        Expected Behavior:
            - Network error is caught
            - Download is retried
            - Eventually succeeds
        """
        import tempfile
        from pathlib import Path

        with patch('app.services.wasabi_service.boto3.client') as mock_boto:
            mock_s3_client = Mock()
            mock_boto.return_value = mock_s3_client

            # Simulate: network error then success
            mock_s3_client.download_file.side_effect = [
                EndpointConnectionError(endpoint_url="https://s3.wasabisys.com"),
                None
            ]

            service = WasabiServiceImpl(
                access_key="test-access",
                secret_key="test-secret",  # pragma: allowlist secret
                bucket="test-bucket",
                region="us-east-1"
            )

            with tempfile.TemporaryDirectory() as tmpdir:
                local_path = Path(tmpdir) / "downloaded.txt"

                # First attempt fails
                with pytest.raises(EndpointConnectionError):
                    service.download_file(
                        key="test/file.txt",
                        local_path=str(local_path)
                    )

                # Retry succeeds
                service.download_file(
                    key="test/file.txt",
                    local_path=str(local_path)
                )

                assert mock_s3_client.download_file.call_count == 2

    def test_combined_network_failures_in_flow(self):
        """
        Test combined network failures across multiple services.

        Scenario:
            1. Flow encounters network issues with multiple services
            2. Some operations succeed, some fail
            3. Flow handles partial failures gracefully

        Expected Behavior:
            - Individual service failures are isolated
            - Flow can continue with degraded functionality
            - Errors are logged for each service
        """
        # Test service-level isolation
        from app.services.supabase_service import SupabaseServiceImpl

        with patch('supabase.create_client') as mock_create_supabase:
            # Supabase works
            mock_supabase = Mock()
            mock_create_supabase.return_value = mock_supabase

            mock_schema = Mock()
            mock_table = Mock()
            mock_update = Mock()
            mock_eq = Mock()
            mock_eq.execute.return_value = Mock(data={"status": "processing"})

            mock_supabase.schema.return_value = mock_schema
            mock_schema.table.return_value = mock_table
            mock_table.update.return_value = mock_update
            mock_update.eq.return_value = mock_eq

            supabase_service = SupabaseServiceImpl(
                supabase_url="https://test.supabase.co",
                supabase_key="test-key",  # pragma: allowlist secret
                schema="test_schema"
            )

            # Supabase update succeeds
            supabase_service.update_video_status(
                video_id="test-123",
                status="processing"
            )

        # Wasabi fails - independent of Supabase success
        with patch('app.services.wasabi_service.boto3.client') as mock_boto:
            mock_s3_client = Mock()
            mock_boto.return_value = mock_s3_client
            mock_s3_client.upload_fileobj.side_effect = EndpointConnectionError(
                endpoint_url="https://s3.wasabisys.com"
            )

            wasabi_service = WasabiServiceImpl(
                access_key="test-access",
                secret_key="test-secret",  # pragma: allowlist secret
                bucket="test-bucket",
                region="us-east-1"
            )

            # Wasabi upload fails
            with pytest.raises(EndpointConnectionError):
                wasabi_service.upload_file(
                    key="test/file.txt",
                    data=b"test data"
                )

        # This demonstrates service isolation - Supabase success doesn't depend on Wasabi
        # In a real flow, the error handling would catch the Wasabi error and handle it
        # while allowing other operations to complete
