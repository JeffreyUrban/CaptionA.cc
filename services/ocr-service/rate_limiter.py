"""
Rate limiting and usage tracking for cost protection.
"""

import time
from collections import deque
from datetime import datetime
from threading import Lock
from typing import Dict, Tuple


class UsageTracker:
    """Track API usage for cost protection."""

    def __init__(self):
        self._lock = Lock()
        self._minute_requests = deque()  # Timestamps of requests in last minute
        self._hour_requests = deque()  # Timestamps of requests in last hour
        self._daily_requests = deque()  # Timestamps of requests in last day

    def _cleanup_old(self, queue: deque, seconds: int):
        """Remove timestamps older than N seconds."""
        cutoff = time.time() - seconds
        while queue and queue[0] < cutoff:
            queue.popleft()

    def check_and_record(self, minute_limit: int, hour_limit: int, daily_limit: int) -> Tuple[bool, str, Dict]:
        """
        Check if request is allowed and record it.

        Returns:
            (allowed, error_message, usage_stats)
        """
        with self._lock:
            now = time.time()

            # Cleanup old timestamps
            self._cleanup_old(self._minute_requests, 60)
            self._cleanup_old(self._hour_requests, 3600)
            self._cleanup_old(self._daily_requests, 86400)

            # Check limits
            minute_count = len(self._minute_requests)
            hour_count = len(self._hour_requests)
            daily_count = len(self._daily_requests)

            usage_stats = {
                "minute": {"current": minute_count, "limit": minute_limit},
                "hour": {"current": hour_count, "limit": hour_limit},
                "day": {"current": daily_count, "limit": daily_limit},
            }

            if minute_count >= minute_limit:
                return False, f"Rate limit: {minute_limit} jobs/minute exceeded", usage_stats

            if hour_count >= hour_limit:
                return False, f"Rate limit: {hour_limit} jobs/hour exceeded", usage_stats

            if daily_count >= daily_limit:
                # Calculate reset time
                oldest = self._daily_requests[0]
                resets_at = datetime.fromtimestamp(oldest + 86400).isoformat()
                return False, f"Daily limit: {daily_limit} jobs/day exceeded (resets at {resets_at})", usage_stats

            # Record request
            self._minute_requests.append(now)
            self._hour_requests.append(now)
            self._daily_requests.append(now)

            return True, "", usage_stats

    def get_usage(self) -> Dict:
        """Get current usage statistics."""
        with self._lock:
            self._cleanup_old(self._minute_requests, 60)
            self._cleanup_old(self._hour_requests, 3600)
            self._cleanup_old(self._daily_requests, 86400)

            return {
                "jobs_last_minute": len(self._minute_requests),
                "jobs_last_hour": len(self._hour_requests),
                "jobs_today": len(self._daily_requests),
                "oldest_job_today": (
                    datetime.fromtimestamp(self._daily_requests[0]).isoformat() if self._daily_requests else None
                ),
            }


# Singleton instance
usage_tracker = UsageTracker()
