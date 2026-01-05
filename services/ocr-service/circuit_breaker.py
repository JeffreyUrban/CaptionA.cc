"""
Circuit breaker pattern to prevent cascading failures.
"""

import time
from enum import Enum
from threading import Lock


class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if recovered


class CircuitBreaker:
    """Circuit breaker to stop processing on repeated failures."""

    def __init__(self, failure_threshold: int = 5, timeout_seconds: int = 300):
        self.failure_threshold = failure_threshold
        self.timeout_seconds = timeout_seconds
        self._lock = Lock()
        self._state = CircuitState.CLOSED
        self._failures = 0
        self._last_failure_time = None

    def call(self, func, *args, **kwargs):
        """Execute function with circuit breaker protection."""
        with self._lock:
            if self._state == CircuitState.OPEN:
                # Check if timeout expired
                if time.time() - self._last_failure_time >= self.timeout_seconds:
                    self._state = CircuitState.HALF_OPEN
                    self._failures = 0
                else:
                    raise CircuitBreakerOpen(
                        f"Circuit breaker open. Too many failures. "
                        f"Try again in {self.timeout_seconds - (time.time() - self._last_failure_time):.0f}s"
                    )

        # Execute function
        try:
            result = func(*args, **kwargs)
            with self._lock:
                # Success - reset if half-open
                if self._state == CircuitState.HALF_OPEN:
                    self._state = CircuitState.CLOSED
                    self._failures = 0
            return result

        except Exception as e:
            with self._lock:
                self._failures += 1
                self._last_failure_time = time.time()

                if self._failures >= self.failure_threshold:
                    self._state = CircuitState.OPEN

            raise e

    def get_status(self) -> dict:
        """Get circuit breaker status."""
        with self._lock:
            return {
                'state': self._state.value,
                'failures': self._failures,
                'threshold': self.failure_threshold,
                'last_failure': (
                    time.time() - self._last_failure_time
                    if self._last_failure_time else None
                )
            }


class CircuitBreakerOpen(Exception):
    """Exception raised when circuit breaker is open."""
    pass


# Singleton instance
circuit_breaker = CircuitBreaker()
