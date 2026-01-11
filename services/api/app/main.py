"""CaptionA.cc API Service."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import actions, admin, captions, layout, videos


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown."""
    # Startup
    settings = get_settings()
    print(f"Starting API service in {settings.environment} mode")
    yield
    # Shutdown
    print("Shutting down API service")


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
    app.include_router(videos.router, prefix="/videos", tags=["videos"])
    app.include_router(captions.router, prefix="/videos", tags=["captions"])
    app.include_router(layout.router, prefix="/videos", tags=["layout"])
    app.include_router(actions.router, prefix="/videos", tags=["actions"])
    app.include_router(admin.router, prefix="/admin", tags=["admin"])

    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy", "environment": settings.environment}

    return app


app = create_app()
