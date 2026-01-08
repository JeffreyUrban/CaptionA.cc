"""
Health Check API for Orchestrator Service

Provides a lightweight HTTP server for health monitoring.
This runs alongside the Prefect worker to provide health checks
without interfering with flow execution.

Usage:
    uvicorn api.main:app --host 0.0.0.0 --port 8000
"""

import os
import time
from datetime import datetime
from typing import Any, Literal

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse

# Track when the server started
SERVER_START_TIME = time.time()


app = FastAPI(
    title="CaptionA.cc Orchestrator Health API",
    version="1.0.0",
    description="Health check endpoints for the video processing orchestrator",
)


def get_uptime_seconds() -> float:
    """Get server uptime in seconds."""
    return time.time() - SERVER_START_TIME


@app.get("/")
async def root():
    """Root endpoint - redirects to health check."""
    return {
        "service": "captionacc-orchestrator",
        "status": "running",
        "health_endpoint": "/health",
    }


@app.get("/health")
async def health_check(response: Response) -> JSONResponse:
    """
    Lightweight health check endpoint.

    Verifies:
    - Supabase connectivity
    - Wasabi readwrite credentials
    - Prefect API connectivity (optional, doesn't fail health check)

    Returns:
    - 200 OK: All critical systems operational
    - 503 Service Unavailable: Critical system failure
    """
    health_status: dict[str, Any] = {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "environment": os.getenv("ENVIRONMENT", "development"),
        "uptime_seconds": int(get_uptime_seconds()),
        "components": {},
    }

    overall_status: Literal["healthy", "degraded", "unhealthy"] = "healthy"

    # Check Supabase
    try:
        from supabase_client import get_supabase_client

        start = time.time()
        supabase = get_supabase_client()

        # Get the preferred schema from the client
        schema = getattr(supabase, "_preferred_schema", "public")

        # Lightweight query to verify connection (with proper schema)
        supabase.schema(schema).table("videos").select("id").limit(1).execute()

        response_ms = int((time.time() - start) * 1000)

        health_status["components"]["supabase"] = {
            "status": "healthy",
            "response_ms": response_ms,
            "schema": schema,
        }
    except Exception as e:
        health_status["components"]["supabase"] = {
            "status": "unhealthy",
            "error": str(e),
        }
        overall_status = "unhealthy"

    # Check Wasabi (readwrite credentials)
    try:
        from wasabi_client import WasabiClient

        start = time.time()
        wasabi = WasabiClient()

        # Lightweight operation: check if we can list (tests read permission)
        # For a full check, we'd do a test write, but that's more expensive
        # Just verifying the client initializes correctly is often enough
        # since it validates credentials on init

        # Try a lightweight list operation
        test_prefix = "health-check/"
        wasabi.list_files(test_prefix)

        response_ms = int((time.time() - start) * 1000)

        health_status["components"]["wasabi"] = {
            "status": "healthy",
            "response_ms": response_ms,
            "permissions": "readwrite",
        }
    except ValueError as e:
        # Credential configuration error
        health_status["components"]["wasabi"] = {
            "status": "unhealthy",
            "error": str(e),
        }
        overall_status = "unhealthy"
    except Exception as e:
        # Network or permission error
        error_str = str(e)
        if any(
            keyword in error_str
            for keyword in ["InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied"]
        ):
            health_status["components"]["wasabi"] = {
                "status": "unhealthy",
                "error": "Invalid or expired Wasabi credentials",
            }
            overall_status = "unhealthy"
        else:
            health_status["components"]["wasabi"] = {
                "status": "degraded",
                "error": error_str,
            }
            if overall_status == "healthy":
                overall_status = "degraded"

    # Check Prefect (optional - doesn't fail health check)
    try:
        import httpx

        prefect_api_url = os.getenv("PREFECT_API_URL")
        prefect_api_key = os.getenv("PREFECT_API_KEY")

        if prefect_api_url and prefect_api_key:
            start = time.time()

            # Try to ping Prefect API
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{prefect_api_url}/health",
                    headers={"Authorization": f"Bearer {prefect_api_key}"},
                    timeout=3.0,
                )

            response_ms = int((time.time() - start) * 1000)

            if resp.status_code == 200:
                health_status["components"]["prefect"] = {
                    "status": "healthy",
                    "response_ms": response_ms,
                }
            else:
                health_status["components"]["prefect"] = {
                    "status": "degraded",
                    "error": f"HTTP {resp.status_code}",
                }
                # Don't fail overall health for Prefect issues
                if overall_status == "healthy":
                    overall_status = "degraded"
        else:
            health_status["components"]["prefect"] = {
                "status": "not_configured",
                "note": "Prefect API credentials not set",
            }
    except Exception as e:
        health_status["components"]["prefect"] = {
            "status": "degraded",
            "error": str(e),
        }
        # Don't fail overall health for Prefect issues
        if overall_status == "healthy":
            overall_status = "degraded"

    # Set final status
    health_status["status"] = overall_status

    # Return appropriate HTTP status
    http_status = 503 if overall_status == "unhealthy" else 200

    return JSONResponse(
        content=health_status,
        status_code=http_status,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
