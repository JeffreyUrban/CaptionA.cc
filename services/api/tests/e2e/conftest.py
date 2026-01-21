"""Pytest fixtures for E2E tests using real services.

This conftest provides fixtures that integrate with real Supabase and Wasabi services
for end-to-end testing. All fixtures handle proper cleanup to avoid leaving test data
in production-like environments.

Environment Variables Required:
    - SUPABASE_URL: Supabase project URL
    - SUPABASE_SERVICE_ROLE_KEY: Service role key (sb_secret_...) for admin operations
    - SUPABASE_SCHEMA: Database schema (default: captionacc_prod)
    - WASABI_ACCESS_KEY_READWRITE: Wasabi access key (or WASABI_ACCESS_KEY_ID)
    - WASABI_SECRET_KEY_READWRITE: Wasabi secret key (or WASABI_SECRET_ACCESS_KEY)
    - WASABI_BUCKET: S3 bucket name
    - WASABI_REGION: S3 region (default: us-east-1)
    - ALLOW_E2E_ON_PRODUCTION: Must be set to "true" to run E2E tests on production schema

Safety:
    These E2E tests write to real databases and storage. To prevent accidental
    runs on production, set ALLOW_E2E_ON_PRODUCTION=true explicitly.
"""

import os
import sys
import tempfile
import uuid
from collections.abc import AsyncGenerator, Generator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.dependencies import AuthContext
from app.main import create_app
from app.services.supabase_service import SupabaseServiceImpl
from app.services.wasabi_service import WasabiServiceImpl


# =============================================================================
# Safety Check: Prevent Accidental E2E Tests on Production
# =============================================================================


def _check_production_safety():
    """
    Safety check to prevent accidentally running E2E tests on production.

    E2E tests write real data to Supabase and Wasabi. To prevent accidents,
    this function checks if we're running against a production schema and
    requires explicit opt-in via ALLOW_E2E_ON_PRODUCTION=true.

    Raises:
        RuntimeError: If running on production without explicit permission
    """
    settings = get_settings()
    schema = settings.supabase_schema or "unknown"

    # Check if this looks like a production schema
    is_production = "production" in schema.lower() or "prod" in schema.lower()

    if is_production:
        allow_production = os.getenv("ALLOW_E2E_ON_PRODUCTION", "").lower() == "true"

        if not allow_production:
            error_msg = f"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                         E2E TEST SAFETY CHECK FAILED                         ║
╚══════════════════════════════════════════════════════════════════════════════╝

You are attempting to run E2E tests against a PRODUCTION environment:

  Database Schema: {schema}
  Supabase URL:    {settings.supabase_url}
  Wasabi Bucket:   {settings.wasabi_bucket}

E2E tests write REAL data to these services, including:
  • Test videos in Wasabi S3
  • Test records in Supabase database
  • Test locks and metadata

To prevent accidental data pollution in production, you must explicitly
acknowledge this by setting:

  export ALLOW_E2E_ON_PRODUCTION=true

Then re-run the tests:

  ALLOW_E2E_ON_PRODUCTION=true pytest tests/e2e/

If you meant to test in a staging/dev environment, update your .env:

  SUPABASE_SCHEMA=captionacc_staging  # or captionacc_dev

╔══════════════════════════════════════════════════════════════════════════════╗
║                    ABORTING TO PROTECT PRODUCTION DATA                       ║
╚══════════════════════════════════════════════════════════════════════════════╝
            """
            print(error_msg, file=sys.stderr)
            raise RuntimeError(
                f"E2E tests blocked on production schema '{schema}'. "
                f"Set ALLOW_E2E_ON_PRODUCTION=true to override."
            )
        else:
            # Warning when running on production with permission
            warning_msg = f"""
⚠️  WARNING: Running E2E tests on PRODUCTION (schema: {schema})
    ALLOW_E2E_ON_PRODUCTION=true detected - proceeding with caution
    Tests will create real data with 'test-' prefixes
            """
            print(warning_msg, file=sys.stderr)


# Run safety check when conftest is loaded
_check_production_safety()


# =============================================================================
# Configuration and Settings
# =============================================================================


@pytest.fixture(scope="session")
def e2e_settings() -> Settings:
    """
    Load settings for E2E tests from environment variables.

    This fixture validates that all required environment variables are set
    for E2E testing with real services.

    Raises:
        ValueError: If required environment variables are missing
    """
    settings = get_settings()

    # Validate required Supabase settings
    if not settings.supabase_url:
        raise ValueError("SUPABASE_URL environment variable is required for E2E tests")
    if not settings.supabase_service_role_key:
        raise ValueError(
            "SUPABASE_SERVICE_ROLE_KEY environment variable is required for E2E tests"
        )

    # Validate required Wasabi settings
    if not settings.effective_wasabi_access_key:
        raise ValueError(
            "WASABI_ACCESS_KEY_ID or WASABI_ACCESS_KEY_READWRITE required for E2E tests"
        )
    if not settings.effective_wasabi_secret_key:
        raise ValueError(
            "WASABI_SECRET_ACCESS_KEY or WASABI_SECRET_KEY_READWRITE required for E2E tests"
        )
    if not settings.wasabi_bucket:
        raise ValueError("WASABI_BUCKET environment variable is required for E2E tests")

    return settings


# =============================================================================
# Test Tenant and Video IDs with Cleanup
# =============================================================================


@pytest.fixture
def e2e_tenant_id() -> str:
    """
    Generate a unique test tenant ID for E2E tests.

    Uses UUID to ensure uniqueness and avoid conflicts with other tests.
    The tenant_id should be used to create test data in Supabase.

    Returns:
        Test tenant UUID string
    """
    return f"test-tenant-{uuid.uuid4()}"


@pytest.fixture
def e2e_video_id() -> str:
    """
    Generate a unique test video ID for E2E tests.

    Uses UUID to ensure uniqueness and avoid conflicts with other tests.
    The video_id should be used to create test data in Supabase and Wasabi.

    Returns:
        Test video UUID string
    """
    return f"test-video-{uuid.uuid4()}"


@pytest.fixture
def e2e_user_id() -> str:
    """
    Generate a unique test user ID for E2E tests.

    Returns:
        Test user UUID string
    """
    return f"test-user-{uuid.uuid4()}"


# =============================================================================
# Real Service Instances
# =============================================================================


@pytest.fixture(scope="session")
def supabase_service(e2e_settings: Settings) -> SupabaseServiceImpl:
    """
    Create a real Supabase service instance for E2E tests.

    This fixture provides access to the actual Supabase database for
    integration testing. Uses service role key for admin-level access.

    Args:
        e2e_settings: E2E test settings with Supabase credentials

    Returns:
        Configured SupabaseServiceImpl instance

    Note:
        Session-scoped to reuse the same client across all tests.
    """
    return SupabaseServiceImpl(
        supabase_url=e2e_settings.supabase_url,
        supabase_key=e2e_settings.supabase_service_role_key,
        schema=e2e_settings.supabase_schema,
    )


@pytest.fixture(scope="session")
def wasabi_service(e2e_settings: Settings) -> WasabiServiceImpl:
    """
    Create a real Wasabi S3 service instance for E2E tests.

    This fixture provides access to the actual Wasabi S3 storage for
    integration testing.

    Args:
        e2e_settings: E2E test settings with Wasabi credentials

    Returns:
        Configured WasabiServiceImpl instance

    Note:
        Session-scoped to reuse the same client across all tests.
    """
    return WasabiServiceImpl(
        access_key=e2e_settings.effective_wasabi_access_key,
        secret_key=e2e_settings.effective_wasabi_secret_key,
        bucket=e2e_settings.wasabi_bucket,
        region=e2e_settings.wasabi_region,
    )


# =============================================================================
# Test Data Management with Cleanup
# =============================================================================


@pytest.fixture
async def test_video_record(
    supabase_service: SupabaseServiceImpl,
    wasabi_service: WasabiServiceImpl,
    e2e_tenant_id: str,
    e2e_video_id: str,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Create a test video record in Supabase and clean up after test.

    This fixture:
    1. Creates a video record in the Supabase videos table
    2. Yields the video data for use in tests
    3. Cleans up the video record and associated Wasabi files after test completes

    Args:
        supabase_service: Real Supabase service instance
        wasabi_service: Real Wasabi service instance
        e2e_tenant_id: Test tenant ID
        e2e_video_id: Test video ID

    Yields:
        Dictionary containing video metadata:
        - id: Video UUID
        - tenant_id: Tenant UUID
        - storage_key: Wasabi storage key for video file
        - status: Video processing status
        - size_bytes: File size
        - uploaded_at: Upload timestamp

    Cleanup:
        - Deletes video record from Supabase
        - Deletes all associated files from Wasabi (video file, databases, frames)
    """
    storage_key = f"{e2e_tenant_id}/videos/{e2e_video_id}/original.mp4"

    # Create video record in Supabase
    video_data = {
        "id": e2e_video_id,
        "tenant_id": e2e_tenant_id,
        "storage_key": storage_key,
        "status": "uploading",
        "size_bytes": 1024 * 1024,  # 1MB placeholder
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        supabase_service.client.schema(supabase_service.schema).table("videos").insert(
            video_data
        ).execute()
    except Exception as e:
        pytest.fail(f"Failed to create test video record in Supabase: {e}")

    yield video_data

    # Cleanup: Delete video record from Supabase
    try:
        supabase_service.client.schema(supabase_service.schema).table(
            "videos"
        ).delete().eq("id", e2e_video_id).execute()
    except Exception as e:
        print(f"Warning: Failed to cleanup video record from Supabase: {e}")

    # Cleanup: Delete all Wasabi files for this video
    try:
        prefix = f"{e2e_tenant_id}/videos/{e2e_video_id}/"
        deleted_count = wasabi_service.delete_prefix(prefix)
        print(f"Cleaned up {deleted_count} files from Wasabi with prefix: {prefix}")
    except Exception as e:
        print(f"Warning: Failed to cleanup Wasabi files: {e}")


@pytest.fixture
async def test_database_state(
    supabase_service: SupabaseServiceImpl,
    e2e_tenant_id: str,
    e2e_video_id: str,
    database_name: str = "captions",
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Create a test database state record in Supabase and clean up after test.

    This fixture creates a video_database_state record for tracking database
    versions and locks during E2E tests.

    Args:
        supabase_service: Real Supabase service instance
        e2e_tenant_id: Test tenant ID
        e2e_video_id: Test video ID
        database_name: Name of database (captions, layout, fullOCR)

    Yields:
        Dictionary containing database state:
        - video_id: Video UUID
        - database_name: Database name
        - tenant_id: Tenant UUID
        - server_version: Current server version
        - wasabi_version: Last synced Wasabi version
        - wasabi_synced_at: Last sync timestamp

    Cleanup:
        Deletes the database state record from Supabase
    """
    now = datetime.now(timezone.utc).isoformat()

    state_data = {
        "video_id": e2e_video_id,
        "database_name": database_name,
        "tenant_id": e2e_tenant_id,
        "server_version": 0,
        "wasabi_version": 0,
        "wasabi_synced_at": now,
        "last_activity_at": now,
    }

    try:
        supabase_service.client.schema(supabase_service.schema).table(
            "video_database_state"
        ).insert(state_data).execute()
    except Exception as e:
        pytest.fail(f"Failed to create test database state in Supabase: {e}")

    yield state_data

    # Cleanup: Delete database state record
    try:
        supabase_service.client.schema(supabase_service.schema).table(
            "video_database_state"
        ).delete().eq("video_id", e2e_video_id).eq(
            "database_name", database_name
        ).execute()
    except Exception as e:
        print(f"Warning: Failed to cleanup database state from Supabase: {e}")


# =============================================================================
# Test File Upload/Download
# =============================================================================


@pytest.fixture
def temp_test_video() -> Generator[Path, None, None]:
    """
    Create a temporary test video file for upload tests.

    Generates a small test video using FFmpeg if available, otherwise creates
    a placeholder file for API testing.

    Yields:
        Path to temporary video file

    Cleanup:
        Removes the temporary file after test completes

    Note:
        Requires FFmpeg to be installed for actual video generation.
        Falls back to creating a placeholder file if FFmpeg is not available.
    """
    from tests.utils.helpers import cleanup_test_video, create_test_video

    try:
        # Try to create a real test video with FFmpeg
        video_path = create_test_video(duration=2, fps=10, text_overlay="E2E Test")
        yield video_path
        cleanup_test_video(video_path)
    except Exception:
        # Fallback: Create a placeholder file if FFmpeg is not available
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"FAKE_VIDEO_DATA_FOR_TESTING")
            temp_path = Path(f.name)

        yield temp_path

        # Cleanup
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass


@pytest.fixture
async def uploaded_test_video(
    wasabi_service: WasabiServiceImpl,
    e2e_tenant_id: str,
    e2e_video_id: str,
    temp_test_video: Path,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Upload a test video to Wasabi and clean up after test.

    This fixture:
    1. Uploads a test video file to Wasabi
    2. Yields video metadata for use in tests
    3. Deletes the video from Wasabi after test completes

    Args:
        wasabi_service: Real Wasabi service instance
        e2e_tenant_id: Test tenant ID
        e2e_video_id: Test video ID
        temp_test_video: Path to temporary test video file

    Yields:
        Dictionary containing:
        - storage_key: Wasabi S3 key for the uploaded video
        - local_path: Path to the local test video file
        - size_bytes: File size in bytes

    Cleanup:
        Deletes the uploaded video from Wasabi
    """
    storage_key = f"{e2e_tenant_id}/videos/{e2e_video_id}/original.mp4"

    # Upload video to Wasabi
    try:
        wasabi_service.upload_from_path(
            key=storage_key,
            local_path=temp_test_video,
            content_type="video/mp4",
        )
    except Exception as e:
        pytest.fail(f"Failed to upload test video to Wasabi: {e}")

    video_info = {
        "storage_key": storage_key,
        "local_path": temp_test_video,
        "size_bytes": temp_test_video.stat().st_size,
    }

    yield video_info

    # Cleanup: Delete video from Wasabi
    try:
        wasabi_service.delete_file(storage_key)
    except Exception as e:
        print(f"Warning: Failed to cleanup video from Wasabi: {e}")


# =============================================================================
# FastAPI Test Client with Real Auth
# =============================================================================


@pytest.fixture
def e2e_auth_token(
    e2e_settings: Settings,
    e2e_user_id: str,
    e2e_tenant_id: str,
) -> str:
    """
    Generate authentication token for E2E test requests.

    For E2E tests, we use the service_role_key directly as it already has
    full permissions. Supabase has migrated to new JWT signing keys, and
    the service_role_key is itself a valid JWT token that bypasses RLS.

    Args:
        e2e_settings: E2E test settings with service role key
        e2e_user_id: Test user ID (unused, kept for compatibility)
        e2e_tenant_id: Test tenant ID (unused, kept for compatibility)

    Returns:
        Service role key formatted as "Bearer <key>"

    Note:
        The service_role_key bypasses Row Level Security and is suitable
        for E2E testing. This is acceptable for testing the service layer.
    """
    # Use service_role_key directly - it's already a JWT with full permissions
    # Supabase's new key format: sb_secret_<key> (this IS the JWT)
    return f"Bearer {e2e_settings.supabase_service_role_key}"


@pytest.fixture
def e2e_auth_context(
    e2e_user_id: str,
    e2e_tenant_id: str,
) -> AuthContext:
    """
    Create an auth context for E2E tests.

    Args:
        e2e_user_id: Test user ID
        e2e_tenant_id: Test tenant ID

    Returns:
        AuthContext instance for test user
    """
    return AuthContext(
        user_id=e2e_user_id,
        tenant_id=e2e_tenant_id,
        email=f"{e2e_user_id}@test.captionacc.local",
    )


@pytest.fixture
def e2e_app(e2e_settings: Settings) -> FastAPI:
    """
    Create a FastAPI application for E2E tests.

    Uses the real app configuration without mocking dependencies.

    Args:
        e2e_settings: E2E test settings

    Returns:
        FastAPI application instance

    Note:
        This app connects to real services (Supabase, Wasabi) configured
        in the environment variables.
    """
    # Temporarily override settings in the app
    import app.config

    original_get_settings = app.config.get_settings
    app.config.get_settings = lambda: e2e_settings

    try:
        # Create app with E2E settings
        application = create_app()
        return application
    finally:
        # Restore original settings function
        app.config.get_settings = original_get_settings


@pytest.fixture
async def e2e_client(
    e2e_app: FastAPI,
    e2e_auth_token: str,
) -> AsyncGenerator[AsyncClient, None]:
    """
    Create an async HTTP client for E2E API tests.

    This client uses real authentication and connects to real services.

    Args:
        e2e_app: FastAPI application instance
        e2e_auth_token: JWT authentication token

    Yields:
        AsyncClient with authentication headers configured

    Example:
        async def test_get_captions(e2e_client, e2e_video_id):
            response = await e2e_client.get(f"/videos/{e2e_video_id}/captions")
            assert response.status_code == 200
    """
    transport = ASGITransport(app=e2e_app)

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": e2e_auth_token},
    ) as client:
        yield client


# =============================================================================
# Pytest Configuration for E2E Tests
# =============================================================================


def pytest_configure(config):
    """
    Configure pytest for E2E tests.

    Adds custom markers for E2E tests.
    """
    config.addinivalue_line(
        "markers",
        "e2e: mark test as end-to-end integration test (requires real services)",
    )
    config.addinivalue_line(
        "markers",
        "slow: mark test as slow (takes more than 5 seconds)",
    )


def pytest_collection_modifyitems(config, items):  # noqa: ARG001
    """
    Modify test collection to add markers automatically.

    Automatically marks all tests in the e2e directory with @pytest.mark.e2e

    Args:
        config: Pytest config object (required by hook signature, unused)
        items: List of collected test items to modify
    """
    for item in items:
        # Auto-mark all tests in e2e directory
        if "e2e" in str(item.fspath):
            item.add_marker(pytest.mark.e2e)
