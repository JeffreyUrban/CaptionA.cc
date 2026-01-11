"""S3 credentials endpoint for direct Wasabi access.

Provides temporary credentials scoped to the tenant's client/ paths
for high-volume media access (chunks, frames).
"""

import logging

from fastapi import APIRouter, HTTPException, status

from app.dependencies import Auth
from app.models.sync import S3CredentialsResponse
from app.services.sts_credentials import STSCredentialsError, get_sts_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/s3-credentials", response_model=S3CredentialsResponse)
async def get_s3_credentials(auth: Auth) -> S3CredentialsResponse:
    """Get temporary AWS credentials for direct Wasabi S3 access.

    Returns STS credentials scoped to the tenant's client/ paths (read-only).
    Credentials can be used with AWS S3 SDK for direct access to:
    - client/video.mp4 - Original video
    - client/full_frames/*.jpg - Frame images
    - client/cropped_frames_v*/*.webm - Video chunks

    Credentials are NOT valid for:
    - sync/*.db.gz - Use presigned URLs via sync API
    - server/* - Server-only, never accessible

    Typical usage:
    ```typescript
    const creds = await api.get('/s3-credentials');
    const s3 = new S3Client({
        region: creds.region,
        endpoint: creds.endpoint,
        credentials: {
            accessKeyId: creds.credentials.accessKeyId,
            secretAccessKey: creds.credentials.secretAccessKey,
            sessionToken: creds.credentials.sessionToken,
        },
    });
    ```
    """
    sts_service = get_sts_service()

    try:
        return await sts_service.get_credentials(auth.tenant_id)
    except STSCredentialsError as e:
        logger.error(f"Failed to get S3 credentials: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="S3 credentials service unavailable",
        )
