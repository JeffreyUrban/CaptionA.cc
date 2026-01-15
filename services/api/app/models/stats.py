"""Models for the /stats endpoint."""

from pydantic import BaseModel


class VideoStats(BaseModel):
    """Video statistics and progress information."""

    totalFrames: int
    coveredFrames: int
    progressPercent: float
    annotationCount: int
    needsTextCount: int
    processingStatus: str


class StatsResponse(BaseModel):
    """Response for GET /stats endpoint."""

    stats: VideoStats
