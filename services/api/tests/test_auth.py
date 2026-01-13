"""Tests for authentication and authorization logic."""

from collections.abc import AsyncGenerator
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.config import Settings
from app.dependencies import AuthContext


# =============================================================================
# Fixtures for Auth Testing
# =============================================================================


@pytest.fixture
def jwt_secret() -> str:
    """Test JWT secret."""
    return "test-secret-for-development-only"


@pytest.fixture
def valid_token_payload(test_tenant_id: str, test_user_id: str) -> dict:
    """Valid JWT payload with all required claims."""
    return {
        "sub": test_user_id,
        "tenant_id": test_tenant_id,
        "email": "test@example.com",
        "aud": "authenticated",
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        "iat": datetime.now(timezone.utc),
    }


@pytest.fixture
def create_token(jwt_secret: str):
    """Factory fixture to create JWT tokens with custom payloads."""

    def _create_token(payload: dict) -> str:
        return jwt.encode(payload, jwt_secret, algorithm="HS256")

    return _create_token


@pytest.fixture
async def unauthenticated_client(app: FastAPI, jwt_secret: str) -> AsyncGenerator[AsyncClient, None]:
    """Create a test client without auth overrides but with test JWT secret."""
    from unittest.mock import MagicMock

    from app.config import get_settings

    def get_test_settings():
        return Settings(supabase_jwt_secret=jwt_secret)

    app.dependency_overrides[get_settings] = get_test_settings

    # Mock boto3/S3 client to prevent actual AWS/Wasabi calls
    with patch("boto3.client") as mock_boto:
        mock_s3 = MagicMock()
        # Configure mock to raise FileNotFoundError for head_object (database doesn't exist)
        mock_s3.head_object.side_effect = FileNotFoundError("Database not found")
        mock_boto.return_value = mock_s3

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac

    app.dependency_overrides.clear()


# =============================================================================
# JWT Validation Tests
# =============================================================================


class TestJWTValidation:
    """Tests for JWT token validation logic."""

    async def test_valid_token_extracts_claims(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should successfully extract user_id, tenant_id, and email from valid JWT."""
        token = create_token(valid_token_payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        # Should not get 401 or 422 (auth should succeed)
        # Might get 500 from database errors, but that means auth worked
        assert response.status_code not in [401, 422], \
            f"Authentication failed with status {response.status_code}: {response.json()}"

    async def test_missing_authorization_header(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should return 422 when Authorization header is missing (FastAPI validation)."""
        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
        )

        # FastAPI returns 422 for missing required headers
        assert response.status_code == 422
        data = response.json()
        assert "detail" in data
        # Check that the error is about the missing authorization header
        assert any("authorization" in str(error).lower() for error in data["detail"])

    async def test_invalid_authorization_format(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should return 401 when Authorization header doesn't start with 'Bearer '."""
        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": "Basic invalid-token"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_token_without_bearer_prefix(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should return 401 when token is provided without 'Bearer ' prefix."""
        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": "some-token-without-bearer"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_malformed_jwt_token(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should return 401 when JWT token is malformed."""
        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": "Bearer not.a.valid.jwt"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_jwt_with_invalid_signature(
        self,
        unauthenticated_client: AsyncClient,
        valid_token_payload: dict,
    ):
        """Should return 401 when JWT signature is invalid."""
        # Create token with wrong secret
        token = jwt.encode(valid_token_payload, "wrong-secret", algorithm="HS256")

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_jwt_with_wrong_algorithm(
        self,
        unauthenticated_client: AsyncClient,
        valid_token_payload: dict,
        jwt_secret: str,
    ):
        """Should return 401 when JWT uses wrong algorithm."""
        # Create token with HS384 instead of HS256
        token = jwt.encode(valid_token_payload, jwt_secret, algorithm="HS384")

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_jwt_with_wrong_audience(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should return 401 when JWT audience claim is incorrect."""
        payload = valid_token_payload.copy()
        payload["aud"] = "wrong-audience"
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]


# =============================================================================
# Token Expiration Tests
# =============================================================================


class TestTokenExpiration:
    """Tests for JWT token expiration handling."""

    async def test_expired_token(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should return 401 when JWT token has expired."""
        # Create token that expired 1 hour ago
        payload = valid_token_payload.copy()
        payload["exp"] = datetime.now(timezone.utc) - timedelta(hours=1)
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_token_expiring_soon_still_valid(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should accept token that expires soon but hasn't expired yet."""
        # Create token that expires in 10 seconds
        payload = valid_token_payload.copy()
        payload["exp"] = datetime.now(timezone.utc) + timedelta(seconds=10)
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        # Should not be 401 or 422 (authentication succeeded)
        assert response.status_code not in [401, 422]

    async def test_token_without_expiration(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should reject token without expiration claim (security best practice)."""
        payload = valid_token_payload.copy()
        del payload["exp"]
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        # jose library typically requires exp for proper validation
        assert response.status_code == 401


# =============================================================================
# Missing Required Claims Tests
# =============================================================================


class TestMissingRequiredClaims:
    """Tests for JWT tokens missing required claims."""

    async def test_missing_user_id_claim(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should return 401 when JWT is missing 'sub' (user_id) claim."""
        payload = valid_token_payload.copy()
        del payload["sub"]
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_missing_tenant_id_claim(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should return 401 when JWT is missing 'tenant_id' claim."""
        payload = valid_token_payload.copy()
        del payload["tenant_id"]
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_null_user_id_claim(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should return 401 when 'sub' claim is null."""
        payload = valid_token_payload.copy()
        payload["sub"] = None
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_null_tenant_id_claim(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should return 401 when 'tenant_id' claim is null."""
        payload = valid_token_payload.copy()
        payload["tenant_id"] = None
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_email_claim_optional(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should accept token without email claim (email is optional)."""
        payload = valid_token_payload.copy()
        del payload["email"]
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        # Should not be 401 or 422 (email is optional, auth should succeed)
        assert response.status_code not in [401, 422]


# =============================================================================
# Tenant Isolation Tests
# =============================================================================


class TestTenantIsolation:
    """Tests for tenant isolation verification."""

    async def test_different_tenants_isolated(
        self,
        app: FastAPI,
        create_token,
        valid_token_payload: dict,
        test_video_id: str,
        mock_seeded_database_manager,
        jwt_secret: str,
    ):
        """Should use different tenant_ids from JWT for resource access."""
        from app.config import get_settings

        def get_test_settings():
            return Settings(supabase_jwt_secret=jwt_secret)

        app.dependency_overrides[get_settings] = get_test_settings

        # Create token for tenant-A
        payload_tenant_a = valid_token_payload.copy()
        payload_tenant_a["tenant_id"] = "tenant-a"
        payload_tenant_a["sub"] = "user-a"
        token_a = create_token(payload_tenant_a)

        # Create token for tenant-B
        payload_tenant_b = valid_token_payload.copy()
        payload_tenant_b["tenant_id"] = "tenant-b"
        payload_tenant_b["sub"] = "user-b"
        token_b = create_token(payload_tenant_b)

        # Mock database manager to track which tenant_id is requested
        requested_tenant_ids = []

        original_get_database = mock_seeded_database_manager.get_database

        async def tracking_get_database(tenant_id: str, video_id: str, writable: bool = False):
            requested_tenant_ids.append(tenant_id)
            async with original_get_database(tenant_id, video_id, writable) as conn:
                yield conn

        mock_seeded_database_manager.get_database = tracking_get_database

        with patch(
            "app.routers.captions.get_database_manager",
            return_value=mock_seeded_database_manager,
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                # Request with tenant-A token
                await client.get(
                    f"/videos/{test_video_id}/captions",
                    params={"start": 0, "end": 100},
                    headers={"Authorization": f"Bearer {token_a}"},
                )

                # Request with tenant-B token
                await client.get(
                    f"/videos/{test_video_id}/captions",
                    params={"start": 0, "end": 100},
                    headers={"Authorization": f"Bearer {token_b}"},
                )

        # Verify that different tenant_ids were used
        assert len(requested_tenant_ids) >= 2
        assert "tenant-a" in requested_tenant_ids
        assert "tenant-b" in requested_tenant_ids

        app.dependency_overrides.clear()

    async def test_tenant_id_extracted_from_jwt(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should extract tenant_id from JWT and use it for resource access."""
        tenant_id = "specific-tenant-123"
        payload = valid_token_payload.copy()
        payload["tenant_id"] = tenant_id
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        # Should not be 401 or 422 (auth should succeed)
        assert response.status_code not in [401, 422]


# =============================================================================
# Admin Role Tests
# =============================================================================


class TestAdminRoleChecks:
    """Tests for admin role verification (when implemented)."""

    def test_require_admin_dependency_exists(self):
        """Should have require_admin dependency function."""
        from app.dependencies import require_admin

        assert callable(require_admin)

    async def test_require_admin_accepts_auth_context(self, auth_context: AuthContext):
        """Should accept valid auth context in require_admin."""
        from app.dependencies import require_admin

        # Currently just returns auth context
        result = require_admin(auth_context)
        assert result.user_id == auth_context.user_id
        assert result.tenant_id == auth_context.tenant_id

    # Note: Additional admin tests would be added when admin verification is implemented
    # TODO: Add admin role claim verification tests when implemented


# =============================================================================
# Auth Context Tests
# =============================================================================


class TestAuthContext:
    """Tests for AuthContext model."""

    def test_auth_context_creation(self):
        """Should create AuthContext with required fields."""
        context = AuthContext(
            user_id="user-123",
            tenant_id="tenant-456",
            email="test@example.com",
        )

        assert context.user_id == "user-123"
        assert context.tenant_id == "tenant-456"
        assert context.email == "test@example.com"

    def test_auth_context_without_email(self):
        """Should create AuthContext without email (optional field)."""
        context = AuthContext(
            user_id="user-123",
            tenant_id="tenant-456",
        )

        assert context.user_id == "user-123"
        assert context.tenant_id == "tenant-456"
        assert context.email is None

    def test_auth_context_serialization(self):
        """Should serialize AuthContext to dict."""
        context = AuthContext(
            user_id="user-123",
            tenant_id="tenant-456",
            email="test@example.com",
        )

        data = context.model_dump()
        assert data["user_id"] == "user-123"
        assert data["tenant_id"] == "tenant-456"
        assert data["email"] == "test@example.com"


# =============================================================================
# Edge Cases and Security Tests
# =============================================================================


class TestAuthEdgeCases:
    """Tests for edge cases and security scenarios."""

    async def test_empty_bearer_token(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should return 401 when Bearer token is empty."""
        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": "Bearer "},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_whitespace_only_token(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should return 401 when token is only whitespace."""
        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": "Bearer    "},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_multiple_bearer_keywords(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should handle multiple 'Bearer' keywords appropriately."""
        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": "Bearer Bearer some-token"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_case_sensitive_bearer_keyword(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should be case-sensitive for 'Bearer' keyword."""
        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": "bearer some-token"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]

    async def test_jwt_with_extra_claims(
        self,
        unauthenticated_client: AsyncClient,
        create_token,
        valid_token_payload: dict,
    ):
        """Should accept JWT with extra claims beyond required ones."""
        payload = valid_token_payload.copy()
        payload["extra_claim"] = "extra_value"
        payload["role"] = "admin"
        token = create_token(payload)

        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {token}"},
        )

        # Should not be 401 or 422 (extra claims are okay, auth should succeed)
        assert response.status_code not in [401, 422]

    async def test_very_long_token(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should handle very long invalid tokens gracefully."""
        long_token = "x" * 10000
        response = await unauthenticated_client.get(
            "/videos/test-video/captions",
            params={"start": 0, "end": 100},
            headers={"Authorization": f"Bearer {long_token}"},
        )

        assert response.status_code == 401
        assert "Invalid authentication credentials" in response.json()["detail"]


# =============================================================================
# Webhook Authentication Tests
# =============================================================================


class TestWebhookAuthentication:
    """Tests for webhook authentication (different from JWT)."""

    async def test_webhook_auth_missing_header(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should return 401 when webhook has no Authorization header."""
        response = await unauthenticated_client.post(
            "/webhooks/supabase/videos",
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "path/to/video.mp4",
                },
            },
        )

        assert response.status_code == 401
        assert "Missing Authorization header" in response.json()["detail"]

    async def test_webhook_auth_invalid_format(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should return 401 when webhook auth header has invalid format."""
        response = await unauthenticated_client.post(
            "/webhooks/supabase/videos",
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "path/to/video.mp4",
                },
            },
            headers={"Authorization": "InvalidFormat"},
        )

        assert response.status_code == 401
        assert "Invalid Authorization header format" in response.json()["detail"]

    async def test_webhook_auth_wrong_secret(
        self,
        unauthenticated_client: AsyncClient,
    ):
        """Should return 401 when webhook secret is incorrect."""
        response = await unauthenticated_client.post(
            "/webhooks/supabase/videos",
            json={
                "type": "INSERT",
                "table": "videos",
                "record": {
                    "id": "video-123",
                    "tenant_id": "tenant-456",
                    "storage_key": "path/to/video.mp4",
                },
            },
            headers={"Authorization": "Bearer wrong-secret"},
        )

        assert response.status_code == 401
        assert "Invalid webhook secret" in response.json()["detail"]
