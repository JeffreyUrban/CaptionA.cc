"""Admin endpoints: platform administration."""

from fastapi import APIRouter

from app.dependencies import Admin
from app.models.responses import UsageStatsResponse

router = APIRouter()


@router.get("/usage", response_model=UsageStatsResponse)
async def get_usage_stats(admin: Admin):
    """Get platform usage statistics (admin only)."""
    # TODO: Implement
    raise NotImplementedError


@router.get("/tenants/{tenant_id}/usage", response_model=UsageStatsResponse)
async def get_tenant_usage(tenant_id: str, admin: Admin):
    """Get usage statistics for a specific tenant (admin only)."""
    # TODO: Implement
    raise NotImplementedError
