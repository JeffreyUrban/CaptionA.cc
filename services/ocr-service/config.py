"""
OCR Service Configuration

Centralized configuration with sensible defaults.
Override via environment variables or fly.toml
"""

import os
from typing import Optional


class Config:
    """Service configuration with defaults."""

    # Cost Protection Limits
    DAILY_API_CALLS_LIMIT: int = int(os.getenv('DAILY_API_CALLS_LIMIT', '1000'))
    JOBS_PER_MINUTE_LIMIT: int = int(os.getenv('JOBS_PER_MINUTE_LIMIT', '10'))
    JOBS_PER_HOUR_LIMIT: int = int(os.getenv('JOBS_PER_HOUR_LIMIT', '100'))

    # Technical Limits (from testing)
    MAX_FRAMES_PER_JOB: int = int(os.getenv('MAX_FRAMES_PER_JOB', '950'))
    HEIGHT_LIMIT_PX: int = int(os.getenv('HEIGHT_LIMIT_PX', '50000'))
    FILE_SIZE_LIMIT_MB: int = int(os.getenv('FILE_SIZE_LIMIT_MB', '15'))
    PIXEL_LIMIT: int = int(os.getenv('PIXEL_LIMIT', '50000000'))

    # Job Management
    JOB_RESULT_TTL_SECONDS: int = int(os.getenv('JOB_RESULT_TTL_SECONDS', '3600'))  # 1 hour
    MAX_CONCURRENT_JOBS: int = int(os.getenv('MAX_CONCURRENT_JOBS', '5'))

    # Circuit Breaker
    CIRCUIT_BREAKER_THRESHOLD: int = int(os.getenv('CIRCUIT_BREAKER_THRESHOLD', '5'))
    CIRCUIT_BREAKER_TIMEOUT_SECONDS: int = int(os.getenv('CIRCUIT_BREAKER_TIMEOUT_SECONDS', '300'))

    # Google Cloud
    GOOGLE_APPLICATION_CREDENTIALS_JSON: Optional[str] = os.getenv('GOOGLE_APPLICATION_CREDENTIALS_JSON')

    @classmethod
    def display(cls) -> dict:
        """Return configuration for display (hide secrets)."""
        return {
            'cost_protection': {
                'daily_api_calls_limit': cls.DAILY_API_CALLS_LIMIT,
                'jobs_per_minute': cls.JOBS_PER_MINUTE_LIMIT,
                'jobs_per_hour': cls.JOBS_PER_HOUR_LIMIT,
            },
            'technical_limits': {
                'max_frames_per_job': cls.MAX_FRAMES_PER_JOB,
                'height_limit_px': cls.HEIGHT_LIMIT_PX,
                'file_size_limit_mb': cls.FILE_SIZE_LIMIT_MB,
                'pixel_limit': cls.PIXEL_LIMIT,
            },
            'job_management': {
                'result_ttl_seconds': cls.JOB_RESULT_TTL_SECONDS,
                'max_concurrent_jobs': cls.MAX_CONCURRENT_JOBS,
            },
            'circuit_breaker': {
                'threshold': cls.CIRCUIT_BREAKER_THRESHOLD,
                'timeout_seconds': cls.CIRCUIT_BREAKER_TIMEOUT_SECONDS,
            },
            'google_cloud': {
                'credentials_configured': cls.GOOGLE_APPLICATION_CREDENTIALS_JSON is not None,
            }
        }


# Singleton instance
config = Config()
