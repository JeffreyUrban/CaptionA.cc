"""API models for requests and responses."""

from app.models.requests import (
    AnnotationBatchUpdate,
    AnnotationCreate,
    AnnotationUpdate,
    CropFramesRequest,
    ExportRequest,
    FullFramesRequest,
    InferenceRequest,
)
from app.models.responses import (
    AnnotationListResponse,
    AnnotationResponse,
    ImageUrlsResponse,
    JobResponse,
    LayoutResponse,
    PreferencesResponse,
    StatsResponse,
    UsageStatsResponse,
)

__all__ = [
    # Requests
    "AnnotationBatchUpdate",
    "AnnotationCreate",
    "AnnotationUpdate",
    "CropFramesRequest",
    "ExportRequest",
    "FullFramesRequest",
    "InferenceRequest",
    # Responses
    "AnnotationListResponse",
    "AnnotationResponse",
    "ImageUrlsResponse",
    "JobResponse",
    "LayoutResponse",
    "PreferencesResponse",
    "StatsResponse",
    "UsageStatsResponse",
]
