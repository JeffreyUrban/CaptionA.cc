"""
Unit tests for priority service.

Tests the dynamic priority calculation and tag generation for Prefect flow runs.
These are pure functions with no external dependencies, so no mocking is required.

Test Coverage:
- Base priority by tenant tier (free, premium, enterprise)
- Age-based boosting with various time deltas
- Age boost cap enforcement
- Base priority override functionality
- Custom boost parameters
- Priority clamping to [0, 100] range
- Unknown tier handling
- Tag generation for observability
"""

from datetime import datetime, timedelta
from app.services.priority_service import (
    calculate_flow_priority,
    get_priority_tags,
    TenantTier,
)


class TestCalculateFlowPriority:
    """Test priority calculation logic."""

    def test_base_priority_free_tier(self):
        """Free tier gets base priority of 50."""
        priority = calculate_flow_priority(
            tenant_tier="free", request_time=None, enable_age_boosting=False
        )
        assert priority == 50

    def test_base_priority_premium_tier(self):
        """Premium tier gets base priority of 70."""
        priority = calculate_flow_priority(
            tenant_tier="premium", request_time=None, enable_age_boosting=False
        )
        assert priority == 70

    def test_base_priority_enterprise_tier(self):
        """Enterprise tier gets base priority of 90."""
        priority = calculate_flow_priority(
            tenant_tier="enterprise", request_time=None, enable_age_boosting=False
        )
        assert priority == 90

    def test_base_priority_unknown_tier(self):
        """Unknown tier defaults to free tier priority (50)."""
        priority = calculate_flow_priority(
            tenant_tier="unknown", request_time=None, enable_age_boosting=False
        )
        assert priority == 50

    def test_base_priority_case_insensitive(self):
        """Tier names are case insensitive."""
        priority_upper = calculate_flow_priority(
            tenant_tier="PREMIUM", request_time=None, enable_age_boosting=False
        )
        priority_lower = calculate_flow_priority(
            tenant_tier="premium", request_time=None, enable_age_boosting=False
        )
        priority_mixed = calculate_flow_priority(
            tenant_tier="Premium", request_time=None, enable_age_boosting=False
        )
        assert priority_upper == priority_lower == priority_mixed == 70

    def test_age_boosting_disabled(self):
        """Age boosting can be disabled."""
        old_time = datetime.now() - timedelta(hours=5)
        priority = calculate_flow_priority(
            tenant_tier="free", request_time=old_time, enable_age_boosting=False
        )
        assert priority == 50  # No boost applied

    def test_age_boosting_no_request_time(self):
        """Age boosting is skipped when request_time is None."""
        priority = calculate_flow_priority(
            tenant_tier="free", request_time=None, enable_age_boosting=True
        )
        assert priority == 50  # No boost applied without request_time

    def test_age_boosting_60_minutes(self):
        """Age boosting adds 1 point per 60 minutes."""
        old_time = datetime.now() - timedelta(minutes=120)
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=20,
        )
        assert priority == 52  # 50 + 2 (120 minutes / 60)

    def test_age_boosting_partial_hour(self):
        """Age boosting handles partial hours correctly."""
        old_time = datetime.now() - timedelta(minutes=90)
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=20,
        )
        assert priority == 51  # 50 + 1.5 = 51 (truncated to int)

    def test_age_boosting_cap(self):
        """Age boosting respects the cap."""
        old_time = datetime.now() - timedelta(hours=50)
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=20,
        )
        assert priority == 70  # 50 + 20 (capped)

    def test_age_boosting_exceeds_cap(self):
        """Age boosting is capped even with very old requests."""
        old_time = datetime.now() - timedelta(days=10)
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=20,
        )
        assert priority == 70  # 50 + 20 (capped, not 50 + 240)

    def test_base_priority_override(self):
        """Base priority can be overridden."""
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=None,
            enable_age_boosting=False,
            base_priority_override=100,
        )
        assert priority == 100

    def test_base_priority_override_with_age_boost(self):
        """Base priority override works with age boosting."""
        old_time = datetime.now() - timedelta(hours=2)
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=20,
            base_priority_override=10,
        )
        assert priority == 12  # 10 + 2 (2 hours)

    def test_custom_boost_parameters(self):
        """Custom boost parameters work correctly."""
        old_time = datetime.now() - timedelta(minutes=300)
        priority = calculate_flow_priority(
            tenant_tier="premium",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=30,  # +1 per 30 min
            age_boost_cap=15,
        )
        # 70 + min(300/30, 15) = 70 + 10 = 80
        assert priority == 80

    def test_custom_boost_parameters_with_cap(self):
        """Custom boost parameters respect custom cap."""
        old_time = datetime.now() - timedelta(minutes=600)
        priority = calculate_flow_priority(
            tenant_tier="premium",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=30,  # +1 per 30 min
            age_boost_cap=15,
        )
        # 70 + min(600/30, 15) = 70 + min(20, 15) = 70 + 15 = 85
        assert priority == 85

    def test_priority_clamped_at_100(self):
        """Priority is clamped to maximum of 100."""
        old_time = datetime.now() - timedelta(hours=100)
        priority = calculate_flow_priority(
            tenant_tier="enterprise",  # base 90
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=50,  # Would add 50, total 140
        )
        assert priority == 100  # Clamped to 100

    def test_priority_clamped_at_0(self):
        """Priority is clamped to minimum of 0."""
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=None,
            enable_age_boosting=False,
            base_priority_override=-10,
        )
        assert priority == 0  # Clamped to 0

    def test_zero_age_boost(self):
        """Zero age boost with current time."""
        current_time = datetime.now()
        priority = calculate_flow_priority(
            tenant_tier="free",
            request_time=current_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=20,
        )
        assert priority == 50  # No boost for current time

    def test_enterprise_with_age_boost(self):
        """Enterprise tier with age boosting."""
        old_time = datetime.now() - timedelta(hours=5)
        priority = calculate_flow_priority(
            tenant_tier="enterprise",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=20,
        )
        assert priority == 95  # 90 + 5

    def test_premium_with_max_age_boost(self):
        """Premium tier with maximum age boost."""
        old_time = datetime.now() - timedelta(hours=25)
        priority = calculate_flow_priority(
            tenant_tier="premium",
            request_time=old_time,
            enable_age_boosting=True,
            age_boost_per_minutes=60,
            age_boost_cap=20,
        )
        assert priority == 90  # 70 + 20 (capped)


class TestGetPriorityTags:
    """Test priority tag generation."""

    def test_tags_with_age_boosting_enabled(self):
        """Tags include age boosting status when enabled."""
        tags = get_priority_tags(
            priority=75,
            tenant_id="tenant-123",
            tenant_tier="premium",
            age_boosting_enabled=True,
        )

        assert "tenant:tenant-123" in tags
        assert "tier:premium" in tags
        assert "priority:75" in tags
        assert "age-boosting:enabled" in tags
        assert len(tags) == 4

    def test_tags_with_age_boosting_disabled(self):
        """Tags reflect disabled age boosting."""
        tags = get_priority_tags(
            priority=50,
            tenant_id="tenant-456",
            tenant_tier="free",
            age_boosting_enabled=False,
        )

        assert "tenant:tenant-456" in tags
        assert "tier:free" in tags
        assert "priority:50" in tags
        assert "age-boosting:disabled" in tags
        assert len(tags) == 4

    def test_tags_enterprise_tier(self):
        """Tags for enterprise tier."""
        tags = get_priority_tags(
            priority=95,
            tenant_id="enterprise-tenant",
            tenant_tier="enterprise",
            age_boosting_enabled=True,
        )

        assert "tenant:enterprise-tenant" in tags
        assert "tier:enterprise" in tags
        assert "priority:95" in tags
        assert "age-boosting:enabled" in tags

    def test_tags_with_max_priority(self):
        """Tags with maximum priority value."""
        tags = get_priority_tags(
            priority=100,
            tenant_id="test-tenant",
            tenant_tier="enterprise",
            age_boosting_enabled=True,
        )

        assert "priority:100" in tags

    def test_tags_with_min_priority(self):
        """Tags with minimum priority value."""
        tags = get_priority_tags(
            priority=0,
            tenant_id="test-tenant",
            tenant_tier="free",
            age_boosting_enabled=False,
        )

        assert "priority:0" in tags

    def test_tags_format_consistency(self):
        """Tags maintain consistent format."""
        tags = get_priority_tags(
            priority=60,
            tenant_id="uuid-123-456",
            tenant_tier="premium",
            age_boosting_enabled=True,
        )

        # Verify format: key:value
        for tag in tags:
            assert ":" in tag
            parts = tag.split(":", 1)
            assert len(parts) == 2
            assert len(parts[0]) > 0
            assert len(parts[1]) > 0

    def test_tags_order(self):
        """Tags are returned in expected order."""
        tags = get_priority_tags(
            priority=75,
            tenant_id="tenant-xyz",
            tenant_tier="premium",
            age_boosting_enabled=True,
        )

        assert tags[0].startswith("tenant:")
        assert tags[1].startswith("tier:")
        assert tags[2].startswith("priority:")
        assert tags[3].startswith("age-boosting:")


class TestTenantTier:
    """Test TenantTier enum."""

    def test_tenant_tier_values(self):
        """TenantTier enum has correct values."""
        assert TenantTier.FREE == 50
        assert TenantTier.PREMIUM == 70
        assert TenantTier.ENTERPRISE == 90

    def test_tenant_tier_ordering(self):
        """TenantTier values are ordered correctly."""
        assert TenantTier.FREE < TenantTier.PREMIUM < TenantTier.ENTERPRISE

    def test_tenant_tier_names(self):
        """TenantTier enum has correct names."""
        assert TenantTier.FREE.name == "FREE"
        assert TenantTier.PREMIUM.name == "PREMIUM"
        assert TenantTier.ENTERPRISE.name == "ENTERPRISE"

    def test_tenant_tier_access_by_name(self):
        """TenantTier can be accessed by name."""
        assert TenantTier["FREE"].value == 50
        assert TenantTier["PREMIUM"].value == 70
        assert TenantTier["ENTERPRISE"].value == 90
