"""Response models for API endpoints."""

from pydantic import BaseModel


class Annotation(BaseModel):
    """Single annotation data."""

    id: str
    frame_start: int
    frame_end: int
    text: str
    speaker: str | None = None


class AnnotationResponse(BaseModel):
    """Response for single annotation operations."""

    annotation: Annotation


class AnnotationListResponse(BaseModel):
    """Response for listing annotations."""

    annotations: list[Annotation]


class LayoutConfig(BaseModel):
    """Layout configuration for video editing."""

    crop_x: int | None = None
    crop_y: int | None = None
    crop_width: int | None = None
    crop_height: int | None = None
    selection_start: int | None = None
    selection_end: int | None = None


class AnalysisBox(BaseModel):
    """Analysis box coordinates."""

    x1: int
    y1: int
    x2: int
    y2: int


class LayoutResponse(BaseModel):
    """Response for layout operations."""

    config: LayoutConfig
    boxes: list[AnalysisBox]


class Preferences(BaseModel):
    """Video preferences."""

    text_size: float = 1.0
    padding_scale: float = 1.0
    text_anchor: str = "bottom"


class PreferencesResponse(BaseModel):
    """Response for preferences operations."""

    preferences: Preferences


class VideoStats(BaseModel):
    """Video statistics and progress."""

    total_frames: int
    processed_frames: int
    annotation_count: int
    duration_seconds: float


class StatsResponse(BaseModel):
    """Response for stats operations."""

    stats: VideoStats


class ImageUrl(BaseModel):
    """Presigned URL for a frame image."""

    frame: int
    url: str


class ImageUrlsResponse(BaseModel):
    """Response for image URL requests."""

    urls: list[ImageUrl]


class JobResponse(BaseModel):
    """Response for job trigger operations."""

    job_id: str
    status: str = "queued"


class UsageStats(BaseModel):
    """Platform usage statistics."""

    total_videos: int
    total_annotations: int
    storage_bytes: int
    compute_minutes: float


class UsageStatsResponse(BaseModel):
    """Response for usage stats operations."""

    stats: UsageStats
