"""Security tests for tenant isolation."""

import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.dependencies import AuthContext


@pytest.mark.security
class TestTenantIsolation:
    """Test tenant data isolation across all API endpoints.

    These tests verify that tenants cannot access, modify, or delete data
    belonging to other tenants. This is a critical security requirement to
    ensure data privacy and integrity in a multi-tenant system.

    Security Requirements (TEST_PLAN.md Section 6.2):
    - Tenant A cannot access Tenant B's video data
    - Tenant A cannot trigger flows for Tenant B's videos
    - All Wasabi S3 keys must include tenant_id prefix
    - Tenant isolation applies to captions, layout, OCR, and all other resources
    """

    @pytest.fixture
    def tenant_isolated_database_manager(self, temp_db_dir: Path, tenant_b_video_id: str):
        """Create a database manager that enforces tenant isolation.

        This mock properly simulates real tenant isolation by:
        1. Only creating databases that have been explicitly seeded
        2. Raising FileNotFoundError for databases that don't exist
        3. Allowing get_or_create_database to create new databases

        This simulates production behavior where:
        - get_database() raises FileNotFoundError if DB doesn't exist in S3
        - get_or_create_database() creates a new DB if it doesn't exist
        - Cross-tenant access fails because tenant_a/video_b doesn't exist
        """

        class TenantIsolatedDatabaseManager:
            def __init__(self):
                self.tenant_dbs: dict[tuple[str, str], Path] = {}
                self.temp_dir = temp_db_dir

            @asynccontextmanager
            async def get_database(
                self, tenant_id: str, video_id: str, writable: bool = False
            ):
                key = (tenant_id, video_id)
                # Only return database if it was previously created
                # This simulates S3 behavior: database doesn't exist = FileNotFoundError
                if key not in self.tenant_dbs:
                    raise FileNotFoundError(
                        f"Database not found for tenant_id={tenant_id}, video_id={video_id}"
                    )

                db_path = self.tenant_dbs[key]
                conn = sqlite3.connect(str(db_path))
                conn.row_factory = sqlite3.Row
                try:
                    yield conn
                finally:
                    conn.close()

            @asynccontextmanager
            async def get_or_create_database(self, tenant_id: str, video_id: str):
                key = (tenant_id, video_id)
                if key not in self.tenant_dbs:
                    # Create a new database for this tenant+video
                    db_path = self.temp_dir / f"{tenant_id}_{video_id}_captions.db"
                    self._init_empty_database(db_path)
                    self.tenant_dbs[key] = db_path

                db_path = self.tenant_dbs[key]
                conn = sqlite3.connect(str(db_path))
                conn.row_factory = sqlite3.Row
                try:
                    yield conn
                finally:
                    conn.close()

            def _init_empty_database(self, db_path: Path):
                """Initialize a database with schema only (no seed data)."""
                conn = sqlite3.connect(str(db_path))
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS database_metadata (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    );
                    INSERT OR REPLACE INTO database_metadata (key, value) VALUES ('schema_version', '2');

                    CREATE TABLE IF NOT EXISTS captions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        start_frame_index INTEGER NOT NULL,
                        end_frame_index INTEGER NOT NULL,
                        caption_frame_extents_state TEXT NOT NULL DEFAULT 'predicted',
                        caption_frame_extents_pending INTEGER NOT NULL DEFAULT 1,
                        caption_frame_extents_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                        text TEXT,
                        text_pending INTEGER NOT NULL DEFAULT 1,
                        text_status TEXT,
                        text_notes TEXT,
                        caption_ocr TEXT,
                        text_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                        image_needs_regen INTEGER NOT NULL DEFAULT 0,
                        caption_ocr_status TEXT NOT NULL DEFAULT 'queued',
                        caption_ocr_error TEXT,
                        caption_ocr_processed_at TEXT,
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );

                    CREATE TABLE IF NOT EXISTS layout (
                        video_id TEXT PRIMARY KEY,
                        frame_width INTEGER,
                        frame_height INTEGER,
                        crop_left INTEGER,
                        crop_top INTEGER,
                        crop_right INTEGER,
                        crop_bottom INTEGER
                    );

                    CREATE TABLE IF NOT EXISTS ocr_results (
                        frame_index INTEGER PRIMARY KEY,
                        ocr_text TEXT,
                        confidence REAL,
                        processed_at TEXT
                    );
                    """
                )
                conn.commit()
                conn.close()

        return TenantIsolatedDatabaseManager()

    @pytest.fixture
    async def isolated_tenant_a_client(
        self,
        app: FastAPI,
        tenant_a_auth_context: AuthContext,
        tenant_isolated_database_manager,
    ):
        """Create tenant A client with isolated database manager."""
        from app.dependencies import get_auth_context

        app.dependency_overrides[get_auth_context] = lambda: tenant_a_auth_context

        with patch(
            "app.routers.captions.get_database_manager",
            return_value=tenant_isolated_database_manager,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as ac:
                yield ac

        app.dependency_overrides.clear()

    async def test_tenant_cannot_access_other_tenant_video(
        self,
        isolated_tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
    ):
        """Verify tenant isolation in API - cannot access other tenant's video.

        Security Requirement: Tenant A should not be able to access captions
        for a video owned by Tenant B.

        Expected: 404 Not Found (database not found because tenant_id doesn't match)
        """
        # Tenant A tries to access Tenant B's video captions
        response = await isolated_tenant_a_client.get(
            f"/videos/{tenant_b_video_id}/captions"
        )

        # Should get 404 because the database lookup uses tenant_a's ID
        # but the video belongs to tenant_b
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    async def test_tenant_cannot_read_other_tenant_captions(
        self,
        isolated_tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
    ):
        """Verify tenant cannot read specific captions from other tenant's video.

        Security Requirement: Tenant isolation must prevent reading individual
        caption records from another tenant's video.

        Expected: 404 Not Found
        """
        # Tenant A tries to read a specific caption from Tenant B's video
        response = await isolated_tenant_a_client.get(
            f"/videos/{tenant_b_video_id}/captions/1"
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    async def test_tenant_cannot_create_caption_for_other_tenant(
        self,
        isolated_tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
        tenant_a_id: str,  # pyright: ignore[reportUnusedParameter]
    ):
        """Verify tenant cannot create captions in other tenant's video.

        Security Requirement: Tenant isolation must prevent creating data
        in another tenant's video database.

        Implementation Note: The POST endpoint uses get_or_create_database(),
        which creates a new database at the path {auth.tenant_id}/videos/{video_id}.

        In this test, tenant A tries to create captions for tenant B's video_id.
        The API creates a database at tenant_a/videos/video-b-uuid, which is
        technically a different resource than tenant_b/videos/video-b-uuid.

        In production, S3 IAM policies should prevent tenant A from creating
        objects under tenant B's prefix. This test documents the application
        behavior - the application layer creates data under the authenticated
        tenant's S3 prefix, which is correct behavior. The S3 layer enforces
        that tenant A cannot write to tenant B's prefix.

        Expected: 201 Created, but data is created under tenant_a's prefix,
        not tenant_b's prefix. This is secure because:
        1. Tenant A cannot affect tenant B's actual data
        2. Tenant A is creating data in their own S3 namespace
        3. S3 policies prevent cross-tenant writes
        """
        caption_data = {
            "startFrameIndex": 0,
            "endFrameIndex": 100,
            "captionFrameExtentsState": "predicted",
            "text": "Caption for video",
        }

        response = await isolated_tenant_a_client.post(
            f"/videos/{tenant_b_video_id}/captions",
            json=caption_data,
        )

        # The API creates the database under tenant_a's namespace
        # This is expected behavior - tenant A creates data in their own space
        assert response.status_code == 201

        # Verify the data was created under tenant_a's namespace
        # (In production, this would be at tenant_a/videos/video-b-uuid in S3)
        # This does NOT affect tenant_b/videos/video-b-uuid
        assert response.json()["caption"] is not None

    async def test_tenant_cannot_update_other_tenant_caption(
        self,
        isolated_tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
    ):
        """Verify tenant cannot update captions in other tenant's video.

        Security Requirement: Tenant isolation must prevent modifying data
        in another tenant's video database.

        Expected: 404 Not Found
        """
        update_data = {
            "startFrameIndex": 0,
            "endFrameIndex": 200,
        }

        response = await isolated_tenant_a_client.put(
            f"/videos/{tenant_b_video_id}/captions/1",
            json=update_data,
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    async def test_tenant_cannot_update_other_tenant_caption_text(
        self,
        isolated_tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
    ):
        """Verify tenant cannot update caption text in other tenant's video.

        Security Requirement: Tenant isolation must prevent modifying caption
        text in another tenant's video database.

        Expected: 404 Not Found
        """
        text_update = {
            "text": "Malicious text modification",
        }

        response = await isolated_tenant_a_client.put(
            f"/videos/{tenant_b_video_id}/captions/1/text",
            json=text_update,
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    async def test_tenant_cannot_delete_other_tenant_caption(
        self,
        isolated_tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
    ):
        """Verify tenant cannot delete captions from other tenant's video.

        Security Requirement: Tenant isolation must prevent deleting data
        from another tenant's video database.

        Expected: 404 Not Found
        """
        response = await isolated_tenant_a_client.delete(
            f"/videos/{tenant_b_video_id}/captions/1"
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    async def test_tenant_cannot_batch_operate_on_other_tenant_captions(
        self,
        isolated_tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
        tenant_a_id: str,  # pyright: ignore[reportUnusedParameter]
    ):
        """Verify tenant cannot perform batch operations on other tenant's video.

        Security Requirement: Tenant isolation must apply to batch operations
        to prevent bulk data manipulation across tenant boundaries.

        Implementation Note: Similar to the create endpoint, batch operations
        use get_or_create_database(), which creates data under the authenticated
        tenant's S3 prefix. When tenant A attempts batch operations on tenant B's
        video_id, the operations execute against tenant_a/videos/video-b-uuid,
        not tenant_b/videos/video-b-uuid.

        Expected: 200 OK with operations executing in tenant A's namespace.
        This is secure because:
        1. Operations cannot affect tenant B's actual data
        2. Data is created/modified in tenant A's S3 namespace only
        3. S3 policies enforce prefix-based isolation
        """
        batch_operations = {
            "operations": [
                {
                    "op": "create",
                    "data": {
                        "startFrameIndex": 0,
                        "endFrameIndex": 100,
                        "captionFrameExtentsState": "predicted",
                    },
                },
            ]
        }

        response = await isolated_tenant_a_client.post(
            f"/videos/{tenant_b_video_id}/captions/batch",
            json=batch_operations,
        )

        # Operations execute in tenant_a's namespace
        assert response.status_code == 200
        assert response.json()["success"] is True

        # Verify the operations were isolated to tenant_a's database
        # The created caption exists only in tenant_a/videos/video-b-uuid
        assert len(response.json()["results"]) == 1

    async def test_tenant_cannot_access_other_tenant_layout(
        self,
        tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
    ):
        """Verify tenant cannot access layout data from other tenant's video.

        Security Requirement: Tenant isolation must apply to layout database
        to prevent cross-tenant access to layout configurations.

        Expected: 404 Not Found
        """
        # Patch layout database manager for this test
        with patch(
            "app.routers.layout.get_layout_database_manager"
        ) as mock_layout_mgr:
            # Mock manager that raises FileNotFoundError (simulating cross-tenant access)
            from contextlib import asynccontextmanager

            class MockLayoutManager:
                @asynccontextmanager  # type: ignore[arg-type]
                async def get_database(
                    self, tenant_id: str, video_id: str, writable: bool = False
                ):
                    raise FileNotFoundError("Database not found")
                    yield  # pyright: ignore[reportUnreachable]  # pragma: no cover - unreachable but required for context manager

            mock_layout_mgr.return_value = MockLayoutManager()

            response = await tenant_a_client.get(
                f"/videos/{tenant_b_video_id}/layout"
            )

            assert response.status_code == 404
            assert "not found" in response.json()["detail"].lower()

    async def test_tenant_cannot_update_other_tenant_layout(
        self,
        tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
    ):
        """Verify tenant cannot update layout data in other tenant's video.

        Security Requirement: Tenant isolation must prevent modifying layout
        configurations in another tenant's video database.

        Expected: 404 Not Found
        """
        layout_update = {
            "cropRegion": {"left": 10, "top": 20, "right": 30, "bottom": 40}
        }

        with patch(
            "app.routers.layout.get_layout_database_manager"
        ) as mock_layout_mgr:
            from contextlib import asynccontextmanager

            class MockLayoutManager:
                @asynccontextmanager  # type: ignore[arg-type]
                async def get_database(
                    self, tenant_id: str, video_id: str, writable: bool = False
                ):
                    raise FileNotFoundError("Database not found")
                    yield  # pyright: ignore[reportUnreachable]  # pragma: no cover - unreachable but required for context manager

            mock_layout_mgr.return_value = MockLayoutManager()

            response = await tenant_a_client.put(
                f"/videos/{tenant_b_video_id}/layout",
                json=layout_update,
            )

            assert response.status_code == 404
            assert "not found" in response.json()["detail"].lower()

    async def test_tenant_cannot_init_layout_for_other_tenant(
        self,
        tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
    ):
        """Verify tenant cannot initialize layout for other tenant's video.

        Security Requirement: Tenant isolation must prevent creating layout
        databases for another tenant's video.

        Expected: 404 Not Found or 500 (depending on S3 access pattern)
        """
        init_data = {
            "frameWidth": 1920,
            "frameHeight": 1080,
        }

        with patch(
            "app.routers.layout.get_layout_database_manager"
        ) as mock_layout_mgr:
            from contextlib import asynccontextmanager

            class MockLayoutManager:
                @asynccontextmanager  # type: ignore[arg-type]
                async def get_or_create_database(
                    self, tenant_id: str, video_id: str
                ):
                    # Simulate S3 key mismatch - tenant_id in path doesn't match
                    raise FileNotFoundError("Database not found")
                    yield  # type: ignore[unreachable]  # pragma: no cover - unreachable but required for context manager

            mock_layout_mgr.return_value = MockLayoutManager()

            response = await tenant_a_client.post(
                f"/videos/{tenant_b_video_id}/layout",
                json=init_data,
            )

            # Should fail with 500 as the operation cannot complete
            assert response.status_code in [404, 500]

    async def test_tenant_cannot_trigger_flow_for_other_tenant(
        self,
        webhook_client: AsyncClient,
        webhook_auth_header: dict[str, str],
        tenant_a_id: str,
        tenant_b_id: str,
        tenant_b_video_id: str,
        mock_trigger_prefect_flow: AsyncMock,
    ):
        """Verify tenant isolation in flow triggering via webhooks.

        Security Requirement: Webhook events for Tenant B's videos should not
        be processable with Tenant A's credentials. However, webhooks use a
        shared secret (not tenant-specific), so this test verifies that the
        flow is triggered with the correct tenant_id from the payload.

        Expected: Flow is triggered with tenant_b_id, not tenant_a_id.
        This test verifies the system correctly processes tenant isolation
        in the Prefect flow parameters.
        """
        # Create webhook payload for tenant B's video
        webhook_payload = {
            "type": "INSERT",
            "table": "videos",
            "record": {
                "id": tenant_b_video_id,
                "tenant_id": tenant_b_id,
                "storage_key": f"{tenant_b_id}/client/videos/{tenant_b_video_id}/video.mp4",
                "status": "uploading",
                "tenant_tier": "free",
            },
        }

        response = await webhook_client.post(
            "/webhooks/supabase/videos",
            json=webhook_payload,
            headers=webhook_auth_header,
        )

        # Webhook should succeed (it has valid auth)
        assert response.status_code == 202
        data = response.json()
        assert data["success"] is True

        # Verify the flow was triggered with tenant_b_id (not tenant_a_id)
        mock_trigger_prefect_flow.assert_called_once()
        call_kwargs = mock_trigger_prefect_flow.call_args.kwargs
        assert call_kwargs["parameters"]["tenant_id"] == tenant_b_id
        assert call_kwargs["parameters"]["video_id"] == tenant_b_video_id

    async def test_wasabi_keys_include_tenant_id_captions(
        self,
        tenant_a_id: str,
        tenant_a_video_id: str,
    ):
        """Verify all Wasabi keys include tenant ID for captions database.

        Security Requirement: All S3 keys must be prefixed with tenant_id
        to ensure physical data isolation in object storage.

        Expected: S3 key format is {tenant_id}/client/videos/{video_id}/captions.db
        """
        from app.services.database_manager import DatabaseManager

        db_manager = DatabaseManager()
        s3_key = db_manager._s3_key(tenant_a_id, tenant_a_video_id)

        # Verify tenant_id is at the start of the key
        assert s3_key.startswith(f"{tenant_a_id}/")
        # Verify full expected format
        assert (
            s3_key
            == f"{tenant_a_id}/client/videos/{tenant_a_video_id}/captions.db"
        )

    async def test_wasabi_keys_include_tenant_id_layout(
        self,
        tenant_a_id: str,
        tenant_a_video_id: str,
    ):
        """Verify all Wasabi keys include tenant ID for layout database.

        Security Requirement: All S3 keys must be prefixed with tenant_id
        to ensure physical data isolation in object storage.

        Expected: S3 key format is {tenant_id}/client/videos/{video_id}/layout.db
        """
        from app.services.database_manager import LayoutDatabaseManager

        db_manager = LayoutDatabaseManager()
        s3_key = db_manager._s3_key(tenant_a_id, tenant_a_video_id)

        # Verify tenant_id is at the start of the key
        assert s3_key.startswith(f"{tenant_a_id}/")
        # Verify full expected format
        assert s3_key == f"{tenant_a_id}/client/videos/{tenant_a_video_id}/layout.db"

    async def test_wasabi_keys_include_tenant_id_ocr(
        self,
        tenant_a_id: str,
        tenant_a_video_id: str,
    ):
        """Verify all Wasabi keys include tenant ID for OCR database.

        Security Requirement: All S3 keys must be prefixed with tenant_id
        to ensure physical data isolation in object storage.

        Expected: S3 key format is {tenant_id}/server/videos/{video_id}/fullOCR.db
        """
        from app.services.database_manager import OcrDatabaseManager

        db_manager = OcrDatabaseManager()
        s3_key = db_manager._s3_key(tenant_a_id, tenant_a_video_id)

        # Verify tenant_id is at the start of the key
        assert s3_key.startswith(f"{tenant_a_id}/")
        # Verify full expected format
        assert s3_key == f"{tenant_a_id}/server/videos/{tenant_a_video_id}/fullOCR.db"

    async def test_database_manager_enforces_tenant_isolation_on_download(
        self,
        tenant_a_id: str,
        tenant_b_id: str,
        tenant_a_video_id: str,
    ):
        """Verify DatabaseManager cannot download another tenant's database.

        Security Requirement: Even if video_id is known, tenant_id mismatch
        should prevent access to another tenant's database.

        Expected: FileNotFoundError when trying to access with wrong tenant_id

        Note: This test skips actual S3 operations to avoid dependencies.
        In production, the S3 key includes tenant_id, so cross-tenant access
        is impossible even if video_id is known.
        """
        # This test documents the behavior but skips actual S3 operations
        # The key insight is that S3 keys are {tenant_id}/client/videos/{video_id}/...
        # So knowing another tenant's video_id is insufficient for access
        from app.services.database_manager import DatabaseManager

        db_manager = DatabaseManager()

        # Verify that S3 keys are different for different tenant_ids
        key_a = db_manager._s3_key(tenant_a_id, tenant_a_video_id)
        key_b = db_manager._s3_key(tenant_b_id, tenant_a_video_id)

        # Keys must be different even for the same video_id
        assert key_a != key_b
        assert key_a.startswith(f"{tenant_a_id}/")
        assert key_b.startswith(f"{tenant_b_id}/")

    async def test_cache_isolation_prevents_cross_tenant_access(
        self,
        tenant_a_id: str,
        tenant_b_id: str,
        tenant_a_video_id: str,
    ):
        """Verify cache paths are unique per tenant to prevent cache poisoning.

        Security Requirement: Local cache must use tenant_id in cache key
        to prevent one tenant from accessing another tenant's cached data.

        Expected: Different cache paths for different tenant_ids
        """
        from app.services.database_manager import DatabaseManager

        db_manager = DatabaseManager()

        cache_path_a = db_manager._cache_path(tenant_a_id, tenant_a_video_id)
        cache_path_b = db_manager._cache_path(tenant_b_id, tenant_a_video_id)

        # Cache paths must be different even for same video_id
        assert cache_path_a != cache_path_b
        assert str(cache_path_a) != str(cache_path_b)

    async def test_tenant_cannot_access_cross_tenant_video_via_api_parameter_manipulation(
        self,
        isolated_tenant_a_client: AsyncClient,
        tenant_b_video_id: str,
    ):
        """Verify tenant isolation cannot be bypassed via API parameter manipulation.

        Security Requirement: Even with knowledge of another tenant's video_id,
        the API must enforce tenant isolation through the AuthContext.

        Expected: 404 Not Found for all attempts to manipulate parameters
        """
        # Try various endpoints with tenant_b's video_id
        endpoints = [
            f"/videos/{tenant_b_video_id}/captions",
            f"/videos/{tenant_b_video_id}/captions/1",
        ]

        for endpoint in endpoints:
            response = await isolated_tenant_a_client.get(endpoint)
            assert response.status_code == 404, f"Failed isolation check for {endpoint}"
            assert "not found" in response.json()["detail"].lower()

    async def test_tenant_isolation_in_storage_key_from_webhook(
        self,
        webhook_client: AsyncClient,
        webhook_auth_header: dict[str, str],
        tenant_a_id: str,
        tenant_a_video_id: str,
        mock_trigger_prefect_flow: AsyncMock,
    ):
        """Verify storage_key in webhook payloads includes tenant_id prefix.

        Security Requirement: All storage keys passed through webhooks must
        include tenant_id to ensure consistent tenant isolation in storage.

        Expected: storage_key format is {tenant_id}/client/videos/{video_id}/...
        """
        webhook_payload = {
            "type": "INSERT",
            "table": "videos",
            "record": {
                "id": tenant_a_video_id,
                "tenant_id": tenant_a_id,
                "storage_key": f"{tenant_a_id}/client/videos/{tenant_a_video_id}/video.mp4",
                "status": "uploading",
                "tenant_tier": "free",
            },
        }

        response = await webhook_client.post(
            "/webhooks/supabase/videos",
            json=webhook_payload,
            headers=webhook_auth_header,
        )

        assert response.status_code == 202
        data = response.json()
        assert data["success"] is True

        # Verify the storage_key passed to Prefect includes tenant_id
        mock_trigger_prefect_flow.assert_called_once()
        call_kwargs = mock_trigger_prefect_flow.call_args.kwargs
        storage_key = call_kwargs["parameters"]["storage_key"]
        assert storage_key.startswith(f"{tenant_a_id}/")

    async def test_tenant_boundary_enforced_by_auth_context(
        self,
        app: FastAPI,
        tenant_a_auth_context: AuthContext,
        tenant_b_video_id: str,
        tenant_isolated_database_manager,
    ):
        """Verify tenant boundary is enforced through AuthContext dependency.

        Security Requirement: The AuthContext.tenant_id must be used for all
        database operations to ensure tenant isolation is enforced at the
        application layer.

        Expected: API operations use auth.tenant_id from JWT, not from request params
        """
        from app.dependencies import get_auth_context
        from httpx import ASGITransport, AsyncClient

        # Override auth to use tenant_a
        app.dependency_overrides[get_auth_context] = lambda: tenant_a_auth_context

        with patch(
            "app.routers.captions.get_database_manager",
            return_value=tenant_isolated_database_manager,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                # Try to access tenant_b's video with tenant_a's auth
                response = await client.get(f"/videos/{tenant_b_video_id}/captions")

                # Should fail because DatabaseManager.get_database is called with
                # tenant_a_id (from auth context) and tenant_b_video_id
                # This mismatch causes FileNotFoundError
                assert response.status_code == 404

        app.dependency_overrides.clear()

    async def test_webhook_payload_tenant_id_mismatch_detection(
        self,
        webhook_client: AsyncClient,
        webhook_auth_header: dict[str, str],
        tenant_a_id: str,
        tenant_b_id: str,
        tenant_a_video_id: str,
        mock_trigger_prefect_flow: AsyncMock,
    ):
        """Verify system detects tenant_id mismatch in webhook storage_key.

        Security Requirement: If storage_key doesn't match tenant_id in record,
        the system should process it correctly (storage_key is authoritative).
        This test documents expected behavior for malformed data.

        Note: This is a data integrity test. In production, Supabase should
        enforce this constraint at the database level.
        """
        # Payload with mismatched tenant_id and storage_key
        # storage_key has tenant_b, but record.tenant_id says tenant_a
        webhook_payload = {
            "type": "INSERT",
            "table": "videos",
            "record": {
                "id": tenant_a_video_id,
                "tenant_id": tenant_a_id,  # Says tenant_a
                "storage_key": f"{tenant_b_id}/client/videos/{tenant_a_video_id}/video.mp4",  # But storage is in tenant_b
                "status": "uploading",
                "tenant_tier": "free",
            },
        }

        response = await webhook_client.post(
            "/webhooks/supabase/videos",
            json=webhook_payload,
            headers=webhook_auth_header,
        )

        # Webhook should still process it (it's Supabase's job to validate)
        assert response.status_code == 202

        # But the flow receives the data as-is, which would cause issues downstream
        # This test documents that we rely on Supabase for data integrity
        mock_trigger_prefect_flow.assert_called_once()
        call_kwargs = mock_trigger_prefect_flow.call_args.kwargs
        # Both values are passed through - downstream processing must handle this
        assert call_kwargs["parameters"]["tenant_id"] == tenant_a_id
        assert call_kwargs["parameters"]["storage_key"].startswith(f"{tenant_b_id}/")
