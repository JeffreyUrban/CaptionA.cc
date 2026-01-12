"""CaptionA.cc API Service."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)
from app.routers import (
    actions,
    admin,
    boxes,
    captions,
    layout,
    preferences,
    stats,
    sync,
    websocket_sync,
)
from app.services.background_tasks import get_upload_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown."""
    # Startup
    settings = get_settings()
    logger.info(f"Starting API service in {settings.environment} mode")

    # Check for failed uploads from previous shutdown
    from app.services.supabase_client import DatabaseStateRepository

    repo = DatabaseStateRepository()
    unsaved = await repo.get_all_with_unsaved_changes()
    if unsaved:
        logger.error(
            f"Found {len(unsaved)} databases with unsaved changes from previous session. "
            "Previous shutdown may have failed to upload to Wasabi."
        )
        for state in unsaved:
            logger.error(
                f"  - {state.get('video_id')}/{state.get('database_name')}: "
                f"server_version={state.get('server_version')} wasabi_version={state.get('wasabi_version')}"
            )

    # Start background Wasabi upload worker
    upload_worker = get_upload_worker()
    await upload_worker.start()

    yield

    # Shutdown - upload all pending changes before exit
    logger.info("Shutting down API service")
    await upload_worker.stop()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="CaptionA.cc API",
        description="Caption annotation platform API",
        version="0.1.0",
        lifespan=lifespan,
        debug=settings.debug,
    )

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    app.include_router(captions.router, prefix="/videos", tags=["captions"])
    app.include_router(boxes.router, prefix="/videos", tags=["boxes"])
    app.include_router(layout.router, prefix="/videos", tags=["layout"])
    app.include_router(preferences.router, prefix="/videos", tags=["preferences"])
    app.include_router(stats.router, prefix="/videos", tags=["stats"])
    app.include_router(actions.router, prefix="/videos", tags=["actions"])
    app.include_router(admin.router, prefix="/admin", tags=["admin"])

    # CR-SQLite sync routers
    app.include_router(sync.router, prefix="/videos", tags=["sync"])
    app.include_router(websocket_sync.router, prefix="/videos", tags=["sync"])

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy", "environment": settings.environment}

    return app


app = create_app()
