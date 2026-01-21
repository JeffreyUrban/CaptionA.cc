"""
Prefect Worker Integration

Starts a Prefect Worker alongside the FastAPI application to execute flows.
The worker connects to the Prefect server and polls the work pool for flow runs.
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from prefect.client.orchestration import get_client

from app.config import get_settings

logger = logging.getLogger(__name__)


class PrefectWorkerManager:
    """
    Manages Prefect Worker lifecycle alongside FastAPI application.

    The worker connects to the Prefect server and executes flows from
    the namespace-specific work pool (e.g., 'captionacc-workers-prod').

    Note: This uses subprocess to run 'prefect worker start' since Prefect 3.x
    doesn't provide a Python API for embedded workers.
    """

    def __init__(self):
        self.worker_process: Optional[asyncio.subprocess.Process] = None
        self.monitor_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """
        Start the Prefect worker in background.

        Raises:
            Exception: If worker fails to start or connect to Prefect server
        """
        settings = get_settings()

        if not settings.prefect_api_url:
            logger.warning(
                "PREFECT_API_URL not configured. Prefect worker will not start. "
                "Flows cannot be executed."
            )
            return

        logger.info(
            f"Starting Prefect worker for work pool '{settings.effective_work_pool}'"
        )
        logger.info(f"Connecting to Prefect server: {settings.prefect_api_url}")

        try:
            # Verify connection to Prefect server
            async with get_client() as client:
                # Check server health (using direct HTTP request due to client.api_healthcheck() returning None)
                import httpx

                async with httpx.AsyncClient() as http_client:
                    response = await http_client.get(
                        f"{settings.prefect_api_url.rstrip('/api')}/api/health"
                    )
                    if response.status_code != 200 or not response.json():
                        raise Exception(
                            f"Prefect server health check failed: {response.status_code}"
                        )
                logger.info("Successfully connected to Prefect server")

                # Ensure work pool exists (optional - worker will create if needed)
                try:
                    await client.read_work_pool(settings.effective_work_pool)
                    logger.info(f"Work pool '{settings.effective_work_pool}' exists")
                except Exception as e:
                    logger.info(
                        f"Work pool '{settings.effective_work_pool}' not found ({e}), worker will create it"
                    )
        except Exception as e:
            logger.error(f"Failed to connect to Prefect server: {e}")
            raise Exception(
                f"Cannot start Prefect worker - server connection failed: {e}"
            ) from e

        # Import all flows to make them discoverable
        loaded_flows = []

        try:
            from app import flows  # noqa: F401
            from app.flows import caption_ocr, crop_and_infer, video_initial_processing  # noqa: F401

            loaded_flows = ["caption_ocr", "crop_and_infer", "video_initial_processing"]
            logger.info(f"Loaded flows: {', '.join(loaded_flows)}")
        except ImportError as e:
            logger.warning(f"Failed to import flows: {e}")
            logger.warning(
                "Worker will start but cannot execute flows until dependencies are installed"
            )

        # Set environment variable for worker
        env = os.environ.copy()
        env["PREFECT_API_URL"] = settings.prefect_api_url
        if settings.prefect_api_key:
            env["PREFECT_API_KEY"] = settings.prefect_api_key

        # Start worker as subprocess
        try:
            self.worker_process = await asyncio.create_subprocess_exec(
                "prefect",
                "worker",
                "start",
                "--pool",
                settings.effective_work_pool,
                "--type",
                "process",
                "--name",
                f"captionacc-api-worker-{settings.captionacc_namespace or 'prod'}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )

            # Start monitor task to log worker output
            self.monitor_task = asyncio.create_task(
                self._monitor_worker_output(), name="prefect-worker-monitor"
            )

            logger.info("Prefect worker started successfully")

        except Exception as e:
            logger.error(f"Failed to start Prefect worker: {e}", exc_info=True)
            raise

    async def _monitor_worker_output(self) -> None:
        """
        Monitor worker subprocess output and log it.

        This ensures worker logs are visible in the API service logs.
        """
        if not self.worker_process:
            return

        async def monitor_stream(stream, prefix):
            """Monitor a single stream (stdout or stderr)."""
            if not stream:
                return
            try:
                while True:
                    line = await stream.readline()
                    if not line:
                        break
                    decoded = line.decode().strip()
                    if "exception" in decoded.lower() or "error" in decoded.lower():
                        logger.error(f"[Worker {prefix}] {decoded}")
                    else:
                        logger.info(f"[Worker {prefix}] {decoded}")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"Error monitoring worker {prefix}: {e}", exc_info=True)

        try:
            # Monitor both stdout and stderr concurrently
            await asyncio.gather(
                monitor_stream(self.worker_process.stdout, "stdout"),
                monitor_stream(self.worker_process.stderr, "stderr"),
                return_exceptions=True,
            )
        except asyncio.CancelledError:
            logger.info("Worker output monitoring cancelled")
            raise
        except Exception as e:
            logger.error(f"Error monitoring worker output: {e}", exc_info=True)

    async def stop(self) -> None:
        """
        Stop the Prefect worker gracefully.

        Sends SIGTERM to worker process and waits for shutdown.
        """
        if not self.worker_process:
            logger.info("Prefect worker was not started, skipping shutdown")
            return

        logger.info("Stopping Prefect worker...")

        try:
            # Cancel monitor task
            if self.monitor_task and not self.monitor_task.done():
                self.monitor_task.cancel()
                try:
                    await asyncio.wait_for(self.monitor_task, timeout=2.0)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    pass

            # Send SIGTERM to worker process
            if self.worker_process.returncode is None:
                self.worker_process.terminate()

                # Wait for graceful shutdown
                try:
                    await asyncio.wait_for(self.worker_process.wait(), timeout=10.0)
                    logger.info("Prefect worker stopped successfully")
                except asyncio.TimeoutError:
                    logger.warning("Worker did not stop gracefully, killing process")
                    self.worker_process.kill()
                    await self.worker_process.wait()

        except Exception as e:
            logger.error(f"Error stopping Prefect worker: {e}", exc_info=True)


# Global instance
_worker_manager: Optional[PrefectWorkerManager] = None


def get_worker_manager() -> PrefectWorkerManager:
    """Get or create the global worker manager instance."""
    global _worker_manager
    if _worker_manager is None:
        _worker_manager = PrefectWorkerManager()
    return _worker_manager


@asynccontextmanager
async def prefect_worker_lifespan():
    """
    Context manager for Prefect worker lifecycle.

    Usage:
        async with prefect_worker_lifespan():
            # Worker is active
            pass
        # Worker is stopped
    """
    worker_manager = get_worker_manager()

    # Startup
    try:
        await worker_manager.start()
    except Exception as e:
        logger.error(f"Failed to start Prefect worker: {e}")
        # Don't raise - allow FastAPI to start even if worker fails
        # This ensures the API remains available for debugging

    yield

    # Shutdown
    await worker_manager.stop()
