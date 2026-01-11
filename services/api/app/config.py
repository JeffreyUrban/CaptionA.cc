"""Application configuration using pydantic-settings."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Environment
    environment: str = "development"
    debug: bool = False

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # Supabase Auth
    supabase_url: str
    supabase_jwt_secret: str

    # Wasabi S3
    wasabi_access_key_id: str = ""
    wasabi_secret_access_key: str = ""
    wasabi_bucket: str = ""
    wasabi_region: str = "us-east-1"
    wasabi_endpoint_url: str = "https://s3.wasabisys.com"

    # Prefect
    prefect_api_url: str = ""
    prefect_api_key: str = ""

    # SQLite Cache
    sqlite_cache_dir: str = "/tmp/captionacc-sqlite-cache"
    sqlite_cache_max_size_mb: int = 500  # Max cache size in MB


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
