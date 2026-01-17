"""
Dynamic priority calculation for Prefect flow runs.
Priority range: 0-100 (higher = more urgent)
Age-based boosting is enabled by default to prevent starvation.

TODO: Priority system is currently non-functional with Prefect 3.x

This module calculates dynamic priorities based on tenant tier and request age,
but Prefect 3.x does not support dynamic priority on flow runs. The calculated
priority values are used for logging and observability (tags) only.

Prefect 2.x vs 3.x Priority Model:
- Prefect 2.x: Supported 'priority' field on flow runs (0-100, higher = more urgent)
- Prefect 3.x: Uses work queues with static priority values (lower number = higher priority)

Why this doesn't work for age-boosting:
- Flow runs are assigned to a work queue at creation time
- Once assigned, they cannot be moved between queues
- Our age-boosting model requires priority to increase over time
- Example: A free-tier video waiting 20 hours should eventually get same priority
  as a newly uploaded premium video, but static queue assignment prevents this

Current behavior:
- Priority values are calculated correctly
- Values are included in flow run tags for observability
- All flow runs go to the 'default' work queue in FIFO order
- No actual prioritization occurs during execution

See app/routers/webhooks.py for additional details and possible solutions.
"""

from datetime import datetime, timezone
from enum import IntEnum
from typing import Optional


class TenantTier(IntEnum):
    """Base priority by tenant tier"""

    FREE = 50
    PREMIUM = 70
    ENTERPRISE = 90


def calculate_flow_priority(
    tenant_tier: str,
    request_time: Optional[datetime] = None,
    enable_age_boosting: bool = True,
    age_boost_per_minutes: int = 60,
    age_boost_cap: int = 20,
    base_priority_override: Optional[int] = None,
) -> int:
    """
    Calculate dynamic priority for flow execution.

    Priority is calculated based on multiple factors:
    - Tenant tier (base priority)
    - Request age (age-based boosting, default enabled)

    Args:
        tenant_tier: Tenant tier (free, premium, enterprise)
        request_time: When the request was created (for age-based boosting)
        enable_age_boosting: Enable age-based priority boost (default: True)
        age_boost_per_minutes: Minutes per +1 priority point (default: 60 = 1pt/hour)
        age_boost_cap: Maximum age boost points (default: 20)
        base_priority_override: Override base priority from tier (useful for testing)

    Returns:
        Priority value (0-100, higher = more urgent)

    Examples:
        # Standard usage (age boosting enabled by default)
        >>> priority = calculate_flow_priority("premium", datetime.now())
        70

        # Disable age boosting for batch jobs
        >>> priority = calculate_flow_priority("free", datetime.now(), enable_age_boosting=False)
        50

        # Custom age boosting: +1 point per 30 minutes, cap at 30
        >>> priority = calculate_flow_priority(
        ...     "free",
        ...     datetime.now() - timedelta(hours=2),
        ...     age_boost_per_minutes=30,
        ...     age_boost_cap=30
        ... )
        54  # 50 (base) + 4 (age boost: 120 minutes / 30 = 4 points)

        # Override base priority for testing
        >>> priority = calculate_flow_priority("free", enable_age_boosting=False, base_priority_override=10)
        10
    """
    # Base priority from tier (or override)
    if base_priority_override is not None:
        priority = base_priority_override
    else:
        try:
            priority = TenantTier[tenant_tier.upper()].value
        except KeyError:
            # Unknown tier, default to FREE
            priority = TenantTier.FREE.value

    # Age-based boost (default enabled, prevents starvation)
    if enable_age_boosting and request_time:
        age_minutes = (datetime.now(timezone.utc) - request_time).total_seconds() / 60
        age_boost = min(age_minutes / age_boost_per_minutes, age_boost_cap)
        priority += age_boost

    # Ensure priority is within valid range
    return int(min(max(priority, 0), 100))  # Clamp to [0, 100]


def get_priority_tags(
    priority: int, tenant_id: str, tenant_tier: str, age_boosting_enabled: bool
) -> list[str]:
    """
    Generate Prefect tags for flow run observability.

    Args:
        priority: Calculated priority value
        tenant_id: Tenant UUID
        tenant_tier: Tenant tier name
        age_boosting_enabled: Whether age boosting was enabled

    Returns:
        List of tags for Prefect flow run

    Example:
        >>> tags = get_priority_tags(75, "tenant-123", "premium", True)
        ['tenant:tenant-123', 'tier:premium', 'priority:75', 'age-boosting:enabled']
    """
    tags = [
        f"tenant:{tenant_id}",
        f"tier:{tenant_tier}",
        f"priority:{priority}",
        f"age-boosting:{'enabled' if age_boosting_enabled else 'disabled'}",
    ]
    return tags
