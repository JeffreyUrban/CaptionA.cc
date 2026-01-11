"""Admin endpoints: database management and security audit."""

import asyncio
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, Query

from app.config import get_settings
from app.dependencies import Admin
from app.models.admin import (
    DatabaseInfo,
    DatabaseListResponse,
    DatabaseRepairRequest,
    DatabaseRepairResponse,
    DatabaseStatus,
    SecurityAuditResponse,
    SecurityAuditView,
    SecurityMetrics,
)

router = APIRouter()


# =============================================================================
# Database Management Endpoints
# =============================================================================


@router.get("/databases", response_model=DatabaseListResponse)
async def list_databases(
    admin: Admin,
    status_filter: DatabaseStatus | None = Query(None, alias="status"),
    search: str | None = Query(None, description="Video ID search"),
):
    """
    List databases with status and version info.

    Returns information about all video databases including schema version,
    status, and size.
    """
    settings = get_settings()

    # Create S3 client for Wasabi
    s3_client = boto3.client(
        "s3",
        endpoint_url=settings.wasabi_endpoint_url,
        aws_access_key_id=settings.wasabi_access_key_id,
        aws_secret_access_key=settings.wasabi_secret_access_key,
        region_name=settings.wasabi_region,
    )

    databases: list[DatabaseInfo] = []
    db_names = ["captions.db", "layout.db", "fullOCR.db"]

    # Target schema versions for each database type
    target_versions = {
        "captions.db": 2,
        "layout.db": 1,
        "fullOCR.db": 1,
    }

    def list_video_databases():
        """List all databases from S3."""
        found_dbs = []
        paginator = s3_client.get_paginator("list_objects_v2")

        try:
            for page in paginator.paginate(Bucket=settings.wasabi_bucket, Delimiter="/"):
                # Get tenant prefixes
                for prefix in page.get("CommonPrefixes", []):
                    tenant_id = prefix["Prefix"].rstrip("/")

                    # List videos for this tenant
                    for video_page in paginator.paginate(
                        Bucket=settings.wasabi_bucket,
                        Prefix=f"{tenant_id}/videos/",
                        Delimiter="/",
                    ):
                        for video_prefix in video_page.get("CommonPrefixes", []):
                            video_path = video_prefix["Prefix"]
                            video_id = video_path.split("/")[-2]

                            # Check each database type
                            for db_name in db_names:
                                db_key = f"{video_path}{db_name}"
                                try:
                                    response = s3_client.head_object(
                                        Bucket=settings.wasabi_bucket, Key=db_key
                                    )
                                    found_dbs.append(
                                        {
                                            "tenant_id": tenant_id,
                                            "video_id": video_id,
                                            "db_name": db_name,
                                            "size": response.get("ContentLength", 0),
                                            "last_modified": response.get(
                                                "LastModified"
                                            ),
                                        }
                                    )
                                except ClientError as e:
                                    if e.response["Error"]["Code"] == "404":
                                        # Database doesn't exist
                                        found_dbs.append(
                                            {
                                                "tenant_id": tenant_id,
                                                "video_id": video_id,
                                                "db_name": db_name,
                                                "size": None,
                                                "last_modified": None,
                                                "missing": True,
                                            }
                                        )
        except ClientError:
            pass

        return found_dbs

    found = await asyncio.to_thread(list_video_databases)

    # Process results
    for db_info in found:
        if search and search.lower() not in db_info["video_id"].lower():
            continue

        if db_info.get("missing"):
            db_status = DatabaseStatus.MISSING
            schema_version = None
        else:
            # For now, assume current version - actual version check would require
            # downloading and inspecting the database
            db_status = DatabaseStatus.CURRENT
            schema_version = target_versions.get(db_info["db_name"])

        if status_filter and db_status != status_filter:
            continue

        last_modified_str = None
        if db_info["last_modified"]:
            last_modified_str = db_info["last_modified"].isoformat()

        databases.append(
            DatabaseInfo(
                videoId=db_info["video_id"],
                tenantId=db_info["tenant_id"],
                database=db_info["db_name"],
                status=db_status,
                schemaVersion=schema_version,
                targetVersion=target_versions.get(db_info["db_name"]),
                sizeBytes=db_info["size"],
                lastModified=last_modified_str,
            )
        )

    # Count statuses
    current_count = sum(1 for d in databases if d.status == DatabaseStatus.CURRENT)
    outdated_count = sum(1 for d in databases if d.status == DatabaseStatus.OUTDATED)
    incomplete_count = sum(
        1 for d in databases if d.status == DatabaseStatus.INCOMPLETE
    )

    return DatabaseListResponse(
        databases=databases,
        total=len(databases),
        current=current_count,
        outdated=outdated_count,
        incomplete=incomplete_count,
    )


@router.post("/databases/repair", response_model=DatabaseRepairResponse)
async def repair_databases(body: DatabaseRepairRequest, admin: Admin):
    """
    Repair/migrate databases to target schema.

    Downloads databases, applies migrations, and re-uploads.
    """
    # TODO: Implement actual database migration logic
    # This would:
    # 1. Download databases that need migration
    # 2. Apply schema migrations
    # 3. Re-upload to S3

    return DatabaseRepairResponse(
        success=True,
        repaired=0,
        failed=0,
        errors=["Database repair not yet implemented - this is a placeholder"],
    )


# =============================================================================
# Security Audit Endpoints
# =============================================================================


@router.get("/security", response_model=SecurityAuditResponse)
async def get_security_audit(
    admin: Admin,
    view: SecurityAuditView = Query(
        SecurityAuditView.RECENT, description="View type"
    ),
    hours: int = Query(24, description="Time window in hours", ge=1, le=720),
):
    """
    Get security audit logs.

    Returns security events based on the specified view and time window.
    """
    # Calculate time window
    now = datetime.now(timezone.utc)
    start_time = now - timedelta(hours=hours)

    # TODO: Implement actual security log retrieval from Supabase
    # For now, return placeholder data

    if view == SecurityAuditView.METRICS:
        return SecurityAuditResponse(
            view=view,
            metrics=SecurityMetrics(
                totalEvents=0,
                criticalEvents=0,
                attackAttempts=0,
                uniqueIps=0,
                affectedTenants=0,
            ),
            timeWindowHours=hours,
        )

    # For other views, return empty events list
    return SecurityAuditResponse(
        view=view,
        events=[],
        timeWindowHours=hours,
    )
