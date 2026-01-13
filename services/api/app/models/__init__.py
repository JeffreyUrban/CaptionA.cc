"""API models for requests and responses."""

from app.models.captions import (
    CaptionFrameExtentsState,
    Caption,
    CaptionBatchUpdate,
    CaptionCreate,
    CaptionListResponse,
    CaptionResponse,
    CaptionRow,
    CaptionTextUpdate,
    CaptionUpdate,
    DeleteResponse,
    CaptionOcrStatus,
    OverlapResolutionResponse,
    TextStatus,
)
from app.models.requests import (
    CropFramesRequest,
    ExportRequest,
    FullFramesRequest,
    InferenceRequest,
)
from app.models.responses import (
    AnalysisBox,
    ImageUrl,
    ImageUrlsResponse,
    JobResponse,
    LayoutConfig,
    LayoutResponse,
    Preferences,
    PreferencesResponse,
    StatsResponse,
    UsageStats,
    UsageStatsResponse,
    VideoStats,
)

__all__ = [
    # Caption models
    "CaptionFrameExtentsState",
    "Caption",
    "CaptionBatchUpdate",
    "CaptionCreate",
    "CaptionListResponse",
    "CaptionResponse",
    "CaptionRow",
    "CaptionTextUpdate",
    "CaptionUpdate",
    "DeleteResponse",
    "CaptionOcrStatus",
    "OverlapResolutionResponse",
    "TextStatus",
    # Action requests
    "CropFramesRequest",
    "ExportRequest",
    "FullFramesRequest",
    "InferenceRequest",
    # Other responses
    "AnalysisBox",
    "ImageUrl",
    "ImageUrlsResponse",
    "JobResponse",
    "LayoutConfig",
    "LayoutResponse",
    "Preferences",
    "PreferencesResponse",
    "StatsResponse",
    "UsageStats",
    "UsageStatsResponse",
    "VideoStats",
]
