"""Supabase Realtime subscription for video INSERT events.

This is the PRIMARY mechanism for triggering video processing.
When a video is inserted, Realtime notifies the API immediately,
which triggers the process_new_videos flow for instant processing.

The 15-minute cron job is a RECOVERY mechanism that catches any
events missed due to network issues, API restarts, etc.
"""

import asyncio
import logging
from typing import Any

import httpx
from supabase import acreate_client, AsyncClient

from app.config import get_settings

logger = logging.getLogger(__name__)


class RealtimeSubscriber:
    """Subscribes to Supabase Realtime for video INSERT events.

    On INSERT, triggers the /internal/process-new-videos/trigger endpoint
    which runs the process_new_videos flow for immediate processing.

    Uses supabase-py async client for Realtime support.
    """

    def __init__(self):
        self._settings = get_settings()
        self._running = False
        self._client: AsyncClient | None = None
        self._channel = None

    async def start(self) -> None:
        """Start Realtime subscription."""
        if self._running:
            return

        if (
            not self._settings.supabase_url
            or not self._settings.supabase_service_role_key
        ):
            logger.warning(
                "Supabase credentials not configured, skipping Realtime subscription"
            )
            return

        self._running = True

        try:
            await self._connect()
            logger.info(
                f"Realtime subscriber started for schema {self._settings.supabase_schema}"
            )
        except Exception as e:
            logger.error(f"Failed to start Realtime subscriber: {e}")
            self._running = False

    async def stop(self) -> None:
        """Stop Realtime subscription."""
        self._running = False

        if self._channel and self._client:
            try:
                await self._client.remove_channel(self._channel)
            except Exception as e:
                logger.debug(f"Error removing Realtime channel: {e}")

        logger.info("Realtime subscriber stopped")

    async def _connect(self) -> None:
        """Connect to Supabase Realtime and subscribe to videos table."""
        self._client = await acreate_client(
            self._settings.supabase_url,
            self._settings.supabase_service_role_key,
        )

        # Create channel for videos table
        channel_name = f"videos-{self._settings.supabase_schema}"
        self._channel = self._client.channel(channel_name)

        # Subscribe to INSERT events on videos table
        self._channel.on_postgres_changes(
            event="INSERT",  # type: ignore[arg-type]  # TODO: Update when supabase-py exports proper Realtime types
            schema=self._settings.supabase_schema,
            table="videos",
            callback=self._handle_video_insert,  # type: ignore[arg-type]  # TODO: Update when supabase-py exports proper Realtime types
        )

        # Subscribe to the channel
        await self._channel.subscribe(self._handle_subscription_status)

        logger.info(
            f"Subscribed to {self._settings.supabase_schema}.videos INSERT events"
        )

    def _handle_subscription_status(
        self, status: str, err: Exception | None = None
    ) -> None:
        """Handle subscription status changes."""
        if err:
            logger.error(f"Realtime subscription error: {err}")
        else:
            logger.info(f"Realtime subscription status: {status}")

    def _handle_video_insert(self, payload: dict[str, Any]) -> None:
        """Handle video INSERT event from Realtime.

        Triggers the process_new_videos flow via internal endpoint.
        """
        try:
            # Extract record from payload (structure may vary)
            record = payload.get("data", {}).get("record", {})
            if not record:
                record = payload.get("record", {})
            if not record:
                record = payload.get("new", {})

            video_id = record.get("id", "unknown")
            display_path = record.get("display_path", video_id)

            logger.info(
                f"Realtime: Video INSERT detected - {display_path} ({video_id})"
            )

            # Trigger processing asynchronously
            asyncio.create_task(self._trigger_processing())

        except Exception as e:
            logger.error(f"Error handling video INSERT: {e}")

    async def _trigger_processing(self) -> None:
        """Trigger the process_new_videos endpoint."""
        try:
            settings = get_settings()
            trigger_url = f"{settings.effective_api_internal_url}/internal/process-new-videos/trigger"

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    trigger_url,
                    headers={"Content-Type": "application/json"},
                    timeout=30.0,
                )

                if response.status_code == 200:
                    data = response.json()
                    logger.info(
                        f"Realtime: Triggered process_new_videos, flow_run_id={data.get('flow_run_id')}"
                    )
                else:
                    logger.error(
                        f"Realtime: Failed to trigger processing, status={response.status_code}"
                    )

        except Exception as e:
            logger.error(f"Realtime: Error triggering processing: {e}")


# Singleton instance
_realtime_subscriber: RealtimeSubscriber | None = None


def get_realtime_subscriber() -> RealtimeSubscriber:
    """Get singleton Realtime subscriber."""
    global _realtime_subscriber
    if _realtime_subscriber is None:
        _realtime_subscriber = RealtimeSubscriber()
    return _realtime_subscriber
