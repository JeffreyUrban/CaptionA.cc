"""FastAPI dependencies for auth, database access, etc."""

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
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
    - tenant_id: custom claim for tenant isolation
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
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )

        user_id: str | None = payload.get("sub")
        tenant_id: str | None = payload.get("tenant_id")

        if user_id is None:
            raise credentials_exception

        if tenant_id is None:
            # Fall back to user_id if tenant_id not set (single-user tenant)
            tenant_id = user_id

        return AuthContext(
            user_id=user_id,
            tenant_id=tenant_id,
            email=payload.get("email"),
        )

    except JWTError:
        raise credentials_exception


# Type alias for dependency injection
Auth = Annotated[AuthContext, Depends(get_auth_context)]


def require_admin(auth: Auth) -> AuthContext:
    """Dependency that requires platform admin access."""
    # TODO: Check admin status from Supabase or JWT claim
    # For now, just return auth context
    return auth


Admin = Annotated[AuthContext, Depends(require_admin)]
