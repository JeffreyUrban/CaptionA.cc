"""API routers."""

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

__all__ = [
    "actions",
    "admin",
    "boxes",
    "captions",
    "layout",
    "preferences",
    "stats",
    "sync",
    "websocket_sync",
]
