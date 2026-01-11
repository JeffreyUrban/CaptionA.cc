"""Wasabi STS credentials service for client S3 access.

Provides temporary credentials scoped to a tenant's client/ paths using
AWS STS AssumeRole with session policies.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from functools import lru_cache

import boto3
from botocore.config import Config

from app.config import Settings, get_settings
from app.models.sync import S3CredentialsInfo, S3CredentialsResponse

logger = logging.getLogger(__name__)


class STSCredentialsError(Exception):
    """Error obtaining STS credentials."""

    pass


class STSCredentialsService:
    """Service for obtaining tenant-scoped temporary S3 credentials."""

    def __init__(self, settings: Settings | None = None):
        self._settings = settings or get_settings()
        self._sts_client = None

    def _get_sts_client(self):
        """Lazy-create STS client using assumer credentials."""
        if self._sts_client is None:
            if not self._settings.wasabi_sts_access_key:
                raise STSCredentialsError("WASABI_STS_ACCESS_KEY not configured")
            if not self._settings.wasabi_sts_secret_key:
                raise STSCredentialsError("WASABI_STS_SECRET_KEY not configured")
            if not self._settings.wasabi_sts_role_arn:
                raise STSCredentialsError("WASABI_STS_ROLE_ARN not configured")

            self._sts_client = boto3.client(
                "sts",
                endpoint_url=self._settings.wasabi_endpoint_url,
                aws_access_key_id=self._settings.wasabi_sts_access_key,
                aws_secret_access_key=self._settings.wasabi_sts_secret_key,
                region_name=self._settings.wasabi_region,
                config=Config(signature_version="v4"),
            )
        return self._sts_client

    def _build_session_policy(self, tenant_id: str) -> str:
        """Build session policy to scope credentials to tenant's client/ path.

        This policy is applied at AssumeRole time to further restrict
        the role's permissions to just this tenant's files.
        """
        policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Action": ["s3:GetObject"],
                    "Resource": f"arn:aws:s3:::{self._settings.wasabi_bucket}/{tenant_id}/videos/*/client/*",
                }
            ],
        }
        return json.dumps(policy)

    async def get_credentials(self, tenant_id: str) -> S3CredentialsResponse:
        """Get temporary S3 credentials scoped to tenant's client/ paths.

        Args:
            tenant_id: The tenant ID from the JWT token

        Returns:
            S3CredentialsResponse with temporary credentials

        Raises:
            STSCredentialsError: If STS is not configured or call fails
        """
        sts_client = self._get_sts_client()
        session_policy = self._build_session_policy(tenant_id)

        def _assume_role():
            return sts_client.assume_role(
                RoleArn=self._settings.wasabi_sts_role_arn,
                RoleSessionName=f"tenant-{tenant_id[:8]}",
                DurationSeconds=self._settings.wasabi_sts_duration_seconds,
                Policy=session_policy,
            )

        try:
            response = await asyncio.to_thread(_assume_role)
        except Exception as e:
            logger.error(f"STS AssumeRole failed for tenant {tenant_id}: {e}")
            raise STSCredentialsError(f"Failed to obtain credentials: {e}") from e

        creds = response["Credentials"]
        expiration = creds["Expiration"]

        # Ensure expiration is timezone-aware
        if expiration.tzinfo is None:
            expiration = expiration.replace(tzinfo=timezone.utc)

        return S3CredentialsResponse(
            credentials=S3CredentialsInfo(
                access_key_id=creds["AccessKeyId"],
                secret_access_key=creds["SecretAccessKey"],
                session_token=creds["SessionToken"],
            ),
            expiration=expiration,
            bucket=self._settings.wasabi_bucket,
            region=self._settings.wasabi_region,
            endpoint=self._settings.wasabi_endpoint_url,
            prefix=f"{tenant_id}/videos/*/client/",
        )


@lru_cache
def get_sts_service() -> STSCredentialsService:
    """Get cached STS credentials service instance."""
    return STSCredentialsService()
