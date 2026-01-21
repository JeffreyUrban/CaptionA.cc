"""CaptionA.cc API Service."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.prefect_runner import get_worker_manager
from app.routers import (
    actions,
    admin,
    boxes,
    captions,
    internal,
    layout,
    preferences,
    stats,
    sync,
    websocket_sync,
)
from app.services.background_tasks import get_upload_worker
from app.services.realtime_subscriber import get_realtime_subscriber

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown."""
    # Startup
    settings = get_settings()
    logger.info(f"Starting API service in {settings.environment} mode")

    # Check for failed uploads from previous shutdown
    try:
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
    except Exception as e:
        logger.error(f"Failed to check for unsaved changes: {e}")
        # Continue startup even if this check fails

    # Start background Wasabi upload worker
    upload_worker = get_upload_worker()
    try:
        await upload_worker.start()
    except Exception as e:
        logger.error(f"Failed to start upload worker: {e}")
        # Continue startup even if upload worker fails

    # Start Prefect worker to execute flows
    worker_manager = get_worker_manager()
    try:
        await worker_manager.start()
    except Exception as e:
        logger.error(f"Failed to start Prefect worker: {e}")
        # Continue startup even if Prefect worker fails

    # Start Realtime subscriber for video INSERT events
    realtime_subscriber = get_realtime_subscriber()
    try:
        await realtime_subscriber.start()
    except Exception as e:
        logger.error(f"Failed to start Realtime subscriber: {e}")
        # Continue startup - cron fallback will still work

    yield

    # Shutdown - stop all background services
    logger.info("Shutting down API service")
    await realtime_subscriber.stop()
    await worker_manager.stop()
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
    # Note: allow_credentials=True requires specific origins (not "*")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://localhost:5174",
            "https://caption-a.cc",
            "https://www.caption-a.cc",
        ],
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

    # Internal system endpoints
    app.include_router(internal.router, tags=["internal"])

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy", "environment": settings.environment}

    return app


app = create_app()
