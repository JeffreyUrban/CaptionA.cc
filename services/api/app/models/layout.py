"""Layout models for layout.db API operations."""

from enum import Enum

from pydantic import BaseModel


class LabelSource(str, Enum):
    """Source of a box label."""

    USER = "user"
    MODEL = "model"


class BoxLabel(str, Enum):
    """Box classification label."""

    IN = "in"
    OUT = "out"


class SelectionMode(str, Enum):
    """Selection mode for caption region."""

    DISABLED = "disabled"
    MANUAL = "manual"
    AUTO = "auto"


# =============================================================================
# Database Row Models (matches SQLite schema - snake_case)
# =============================================================================


class VideoLayoutConfigRow(BaseModel):
    """Database row from video_layout_config table."""

    id: int
    frame_width: int
    frame_height: int
    crop_left: int
    crop_top: int
    crop_right: int
    crop_bottom: int
    selection_left: int | None = None
    selection_top: int | None = None
    selection_right: int | None = None
    selection_bottom: int | None = None
    selection_mode: str
    vertical_position: float | None = None
    vertical_std: float | None = None
    box_height: float | None = None
    box_height_std: float | None = None
    anchor_type: str | None = None
    anchor_position: float | None = None
    top_edge_std: float | None = None
    bottom_edge_std: float | None = None
    horizontal_std_slope: float | None = None
    horizontal_std_intercept: float | None = None
    crop_bounds_version: int
    analysis_model_version: str | None = None
    updated_at: str


class FullFrameBoxLabelRow(BaseModel):
    """Database row from full_frame_box_labels table."""

    id: int
    frame_index: int
    box_index: int
    label: str
    label_source: str
    created_at: str


class BoxClassificationModelRow(BaseModel):
    """Database row from box_classification_model table."""

    id: int
    model_data: bytes | None = None
    model_version: str | None = None
    trained_at: str | None = None


class VideoPreferencesRow(BaseModel):
    """Database row from video_preferences table."""

    id: int
    layout_approved: int  # 0 or 1


# =============================================================================
# API Models (camelCase for frontend)
# =============================================================================


class VideoLayoutConfig(BaseModel):
    """Video layout configuration for API responses."""

    frameWidth: int
    frameHeight: int
    cropLeft: int
    cropTop: int
    cropRight: int
    cropBottom: int
    selectionLeft: int | None = None
    selectionTop: int | None = None
    selectionRight: int | None = None
    selectionBottom: int | None = None
    selectionMode: SelectionMode
    verticalPosition: float | None = None
    verticalStd: float | None = None
    boxHeight: float | None = None
    boxHeightStd: float | None = None
    anchorType: str | None = None
    anchorPosition: float | None = None
    topEdgeStd: float | None = None
    bottomEdgeStd: float | None = None
    horizontalStdSlope: float | None = None
    horizontalStdIntercept: float | None = None
    cropBoundsVersion: int
    analysisModelVersion: str | None = None
    updatedAt: str

    @classmethod
    def from_row(cls, row: VideoLayoutConfigRow) -> "VideoLayoutConfig":
        """Transform database row to API model."""
        return cls(
            frameWidth=row.frame_width,
            frameHeight=row.frame_height,
            cropLeft=row.crop_left,
            cropTop=row.crop_top,
            cropRight=row.crop_right,
            cropBottom=row.crop_bottom,
            selectionLeft=row.selection_left,
            selectionTop=row.selection_top,
            selectionRight=row.selection_right,
            selectionBottom=row.selection_bottom,
            selectionMode=SelectionMode(row.selection_mode),
            verticalPosition=row.vertical_position,
            verticalStd=row.vertical_std,
            boxHeight=row.box_height,
            boxHeightStd=row.box_height_std,
            anchorType=row.anchor_type,
            anchorPosition=row.anchor_position,
            topEdgeStd=row.top_edge_std,
            bottomEdgeStd=row.bottom_edge_std,
            horizontalStdSlope=row.horizontal_std_slope,
            horizontalStdIntercept=row.horizontal_std_intercept,
            cropBoundsVersion=row.crop_bounds_version,
            analysisModelVersion=row.analysis_model_version,
            updatedAt=row.updated_at,
        )


class FrameBoxLabel(BaseModel):
    """Box label for API responses."""

    id: int
    frameIndex: int
    boxIndex: int
    label: BoxLabel
    labelSource: LabelSource
    createdAt: str

    @classmethod
    def from_row(cls, row: FullFrameBoxLabelRow) -> "FrameBoxLabel":
        """Transform database row to API model."""
        return cls(
            id=row.id,
            frameIndex=row.frame_index,
            boxIndex=row.box_index,
            label=BoxLabel(row.label),
            labelSource=LabelSource(row.label_source),
            createdAt=row.created_at,
        )


class VideoPreferences(BaseModel):
    """Video preferences for API responses."""

    layoutApproved: bool

    @classmethod
    def from_row(cls, row: VideoPreferencesRow) -> "VideoPreferences":
        """Transform database row to API model."""
        return cls(layoutApproved=row.layout_approved == 1)


# =============================================================================
# Request Models
# =============================================================================


class VideoLayoutConfigInit(BaseModel):
    """Request body for initializing video layout config."""

    frameWidth: int
    frameHeight: int


class VideoLayoutConfigUpdate(BaseModel):
    """Request body for updating video layout config."""

    cropLeft: int | None = None
    cropTop: int | None = None
    cropRight: int | None = None
    cropBottom: int | None = None
    selectionLeft: int | None = None
    selectionTop: int | None = None
    selectionRight: int | None = None
    selectionBottom: int | None = None
    selectionMode: SelectionMode | None = None


class AnalysisResultsUpdate(BaseModel):
    """Request body for updating layout analysis results."""

    verticalPosition: float | None = None
    verticalStd: float | None = None
    boxHeight: float | None = None
    boxHeightStd: float | None = None
    anchorType: str | None = None
    anchorPosition: float | None = None
    topEdgeStd: float | None = None
    bottomEdgeStd: float | None = None
    horizontalStdSlope: float | None = None
    horizontalStdIntercept: float | None = None
    analysisModelVersion: str | None = None


class BoxLabelCreate(BaseModel):
    """Request body for creating a box label."""

    frameIndex: int
    boxIndex: int
    label: BoxLabel
    labelSource: LabelSource = LabelSource.USER


class BoxLabelBatchCreate(BaseModel):
    """Request body for creating multiple box labels."""

    labels: list[BoxLabelCreate]


class VideoPreferencesUpdate(BaseModel):
    """Request body for updating video preferences."""

    layoutApproved: bool


# =============================================================================
# Response Models
# =============================================================================


class VideoLayoutConfigResponse(BaseModel):
    """Response for video layout config operations."""

    config: VideoLayoutConfig


class BoxLabelResponse(BaseModel):
    """Response for single box label operations."""

    label: FrameBoxLabel


class BoxLabelListResponse(BaseModel):
    """Response for listing box labels."""

    labels: list[FrameBoxLabel]


class VideoPreferencesResponse(BaseModel):
    """Response for video preferences operations."""

    preferences: VideoPreferences


class DeleteResponse(BaseModel):
    """Response for delete operations."""

    deleted: bool


class BatchCreateResponse(BaseModel):
    """Response for batch create operations."""

    created: int
    labels: list[FrameBoxLabel]
