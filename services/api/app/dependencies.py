"""FastAPI dependencies for auth, database access, etc."""

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from pydantic import BaseModel

from app.config import Settings, get_settings


class AuthContext(BaseModel):
    """Authenticated user context extracted from JWT."""

    user_id: str
    tenant_id: str
    email: str | None = None


async def get_auth_context(
    authorization: Annotated[str, Header()],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthContext:
    """
    Extract and validate auth context from Supabase JWT.

    The JWT contains:
    - sub: user ID
    - tenant_id: custom claim for tenant isolation (optional - fetched from DB if missing)
    - email: user's email
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Extract token from header
    if not authorization.startswith("Bearer "):
        raise credentials_exception

    token = authorization.removeprefix("Bearer ")

    try:
        import logging
        from app.services.supabase_client import get_supabase_client

        logger = logging.getLogger(__name__)

        # Use Supabase client to verify token and get user info
        # This works for both ES256 and HS256 tokens
        supabase = get_supabase_client()

        # Verify token by getting user from Supabase
        response = supabase.auth.get_user(token)

        if not response.user:
            logger.error("Failed to verify token with Supabase")
            raise credentials_exception

        user = response.user
        user_id = user.id
        email = user.email

        logger.info(f"Authenticated user: {user_id}")

        # Fetch tenant_id from user_profiles
        result = (
            supabase.schema(settings.supabase_schema)
            .table("user_profiles")
            .select("tenant_id")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )

        if result.data is None:
            logger.error(f"No user_profile found for user_id: {user_id}")
            raise credentials_exception

        tenant_id = result.data.get("tenant_id")
        if tenant_id is None:
            logger.error(f"User profile has no tenant_id: {result.data}")
            raise credentials_exception

        logger.info(f"Found tenant_id: {tenant_id}")

        return AuthContext(
            user_id=user_id,
            tenant_id=tenant_id,
            email=email,
        )

    except Exception as e:
        import logging

        logger = logging.getLogger(__name__)
        logger.error(f"Authentication error: {e}")
        raise credentials_exception


# Type alias for dependency injection
Auth = Annotated[AuthContext, Depends(get_auth_context)]


def require_admin(auth: Auth) -> AuthContext:
    """Dependency that requires platform admin access."""
    # TODO: Check admin status from Supabase or JWT claim
    # For now, just return auth context
    return auth


Admin = Annotated[AuthContext, Depends(require_admin)]
