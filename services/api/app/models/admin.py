"""Models for admin endpoints."""

from enum import Enum

from pydantic import BaseModel


class DatabaseStatus(str, Enum):
    """Database status."""

    CURRENT = "current"
    OUTDATED = "outdated"
    INCOMPLETE = "incomplete"
    MISSING = "missing"


class DatabaseInfo(BaseModel):
    """Information about a single database."""

    videoId: str
    tenantId: str
    database: str  # captions.db, layout.db, fullOCR.db
    status: DatabaseStatus
    schemaVersion: int | None = None
    targetVersion: int | None = None
    sizeBytes: int | None = None
    lastModified: str | None = None


class DatabaseListResponse(BaseModel):
    """Response for database list endpoint."""

    databases: list[DatabaseInfo]
    total: int
    current: int
    outdated: int
    incomplete: int


class DatabaseRepairRequest(BaseModel):
    """Request body for database repair endpoint."""

    targetVersion: int | None = None
    force: bool = False
    videoIds: list[str] | None = None  # If None, repair all


class DatabaseRepairResponse(BaseModel):
    """Response for database repair endpoint."""

    success: bool
    repaired: int
    failed: int
    errors: list[str]


class SecurityEventSeverity(str, Enum):
    """Security event severity levels."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class SecurityEvent(BaseModel):
    """A security audit event."""

    timestamp: str
    severity: SecurityEventSeverity
    eventType: str
    message: str
    tenantId: str | None = None
    userId: str | None = None
    ipAddress: str | None = None
    details: dict | None = None


class SecurityMetrics(BaseModel):
    """Security metrics summary."""

    totalEvents: int
    criticalEvents: int
    attackAttempts: int
    uniqueIps: int
    affectedTenants: int


class SecurityAuditView(str, Enum):
    """View type for security audit."""

    CRITICAL = "critical"
    ATTACKS = "attacks"
    RECENT = "recent"
    METRICS = "metrics"


class SecurityAuditResponse(BaseModel):
    """Response for security audit endpoint."""

    view: SecurityAuditView
    events: list[SecurityEvent] | None = None
    metrics: SecurityMetrics | None = None
    timeWindowHours: int
