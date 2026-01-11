"""Repository for video data access."""

import asyncio
from pathlib import Path

from sqlmodel import Session, create_engine, select

from app.models.responses import AnalysisBox, LayoutConfig, Preferences, VideoStats


class VideoRepository:
    """Data access layer for video-related SQLite operations."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.engine = create_engine(f"sqlite:///{db_path}")

    async def get_layout_config(self) -> LayoutConfig:
        """Get layout configuration from captions.db."""

        def _query():
            with Session(self.engine) as session:
                # TODO: Define actual table model and query
                return LayoutConfig()

        return await asyncio.to_thread(_query)

    async def get_analysis_boxes(self) -> list[AnalysisBox]:
        """Get analysis boxes from captions.db."""

        def _query():
            with Session(self.engine) as session:
                # TODO: Define actual table model and query
                return []

        return await asyncio.to_thread(_query)

    async def update_layout_config(self, config: LayoutConfig) -> LayoutConfig:
        """Update layout configuration in captions.db."""

        def _update():
            with Session(self.engine) as session:
                # TODO: Define actual table model and update
                session.commit()
                return config

        return await asyncio.to_thread(_update)

    async def get_preferences(self) -> Preferences:
        """Get video preferences from captions.db."""

        def _query():
            with Session(self.engine) as session:
                # TODO: Define actual table model and query
                return Preferences()

        return await asyncio.to_thread(_query)

    async def update_preferences(self, prefs: Preferences) -> Preferences:
        """Update video preferences in captions.db."""

        def _update():
            with Session(self.engine) as session:
                # TODO: Define actual table model and update
                session.commit()
                return prefs

        return await asyncio.to_thread(_update)

    async def get_stats(self) -> VideoStats:
        """Get video statistics from captions.db."""

        def _query():
            with Session(self.engine) as session:
                # TODO: Define actual table model and query
                return VideoStats(
                    total_frames=0,
                    processed_frames=0,
                    annotation_count=0,
                    duration_seconds=0.0,
                )

        return await asyncio.to_thread(_query)
