"""Repository for annotation data access."""

import asyncio
from pathlib import Path

from sqlmodel import Session, create_engine

from app.models.requests import AnnotationCreate, AnnotationUpdate
from app.models.responses import Annotation


class AnnotationRepository:
    """Data access layer for annotation-related SQLite operations."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.engine = create_engine(f"sqlite:///{db_path}")

    async def get_all(self) -> list[Annotation]:
        """Get all annotations from captions.db."""

        def _query():
            with Session(self.engine) as session:
                # TODO: Define actual table model and query
                return []

        return await asyncio.to_thread(_query)

    async def get_by_id(self, annotation_id: str) -> Annotation | None:
        """Get a single annotation by ID."""

        def _query():
            with Session(self.engine) as session:
                # TODO: Define actual table model and query
                return None

        return await asyncio.to_thread(_query)

    async def create(self, data: AnnotationCreate) -> Annotation:
        """Create a new annotation."""

        def _create():
            with Session(self.engine) as session:
                # TODO: Define actual table model and insert
                session.commit()
                return Annotation(
                    id="new-id",
                    frame_start=data.frame_start,
                    frame_end=data.frame_end,
                    text=data.text,
                    speaker=data.speaker,
                )

        return await asyncio.to_thread(_create)

    async def update(self, annotation_id: str, data: AnnotationUpdate) -> Annotation | None:
        """Update an existing annotation."""

        def _update():
            with Session(self.engine) as session:
                # TODO: Define actual table model and update
                session.commit()
                return None

        return await asyncio.to_thread(_update)

    async def delete(self, annotation_id: str) -> bool:
        """Delete an annotation."""

        def _delete():
            with Session(self.engine) as session:
                # TODO: Define actual table model and delete
                session.commit()
                return True

        return await asyncio.to_thread(_delete)

    async def batch_update(self, updates: list[AnnotationUpdate]) -> list[Annotation]:
        """Batch update multiple annotations."""

        def _batch():
            with Session(self.engine) as session:
                # TODO: Define actual table model and batch update
                session.commit()
                return []

        return await asyncio.to_thread(_batch)
