"""Application configuration using pydantic-settings."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),  # Check local and project root
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # Ignore extra env vars from root .env
    )

    # Environment
    environment: str = "development"
    debug: bool = False

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # Supabase Auth
    supabase_url: str = ""
    supabase_jwt_secret: str = "test-secret-for-development-only"

    # Wasabi S3
    wasabi_access_key_readwrite: str = ""
    wasabi_secret_key_readwrite: str = ""
    wasabi_bucket: str = ""
    wasabi_region: str = "us-east-1"
    wasabi_endpoint_url: str = "https://s3.wasabisys.com"

    # Prefect
    prefect_api_url: str = ""
    prefect_api_key: str = ""

    # SQLite Cache (legacy - used by database_manager.py)
    sqlite_cache_dir: str = "/tmp/captionacc-sqlite-cache"
    sqlite_cache_max_size_mb: int = 500  # Max cache size in MB

    # CR-SQLite Sync
    crsqlite_extension_path: str = ""  # Path to crsqlite.so/.dylib
    working_copy_dir: str = "/var/data/captionacc/working"
    wasabi_upload_idle_minutes: int = 5
    wasabi_upload_checkpoint_minutes: int = 15
    lock_expiry_minutes: int = 30  # Auto-release stale locks after this

    # Supabase (service role for video_database_state)
    supabase_service_role_key: str = ""
    supabase_schema: str = "captionacc_prod"

    # Namespace for dev isolation (empty = production)
    captionacc_namespace: str = ""

    @property
    def effective_work_pool(self) -> str:
        """Get the work pool name for Prefect workers."""
        # Use deployment_namespace which defaults to 'prod'
        return f"captionacc-workers-{self.deployment_namespace}"

    @property
    def modal_app_suffix(self) -> str:
        """Suffix for Modal app names (e.g., 'dev' or 'prod')"""
        if self.captionacc_namespace:
            return f"{self.captionacc_namespace}"
        return ""

    @property
    def deployment_namespace(self) -> str:
        """Get the namespace for Prefect deployment names (e.g., 'dev' or 'prod')."""
        if self.captionacc_namespace:
            return self.captionacc_namespace
        return "prod"  # Default to prod when no namespace is set

    def get_deployment_name(self, base_name: str) -> str:
        """
        Get the full deployment name with namespace prefix.

        Args:
            base_name: The base deployment name (e.g., 'video-initial-processing')

        Returns:
            Full deployment name (e.g., 'captionacc-prod-video-initial-processing')
        """
        return f"captionacc-{self.deployment_namespace}-{base_name}"

    def get_deployment_full_name(self, base_name: str) -> str:
        """
        Get the full deployment reference (flow-name/deployment-name).

        In Prefect, deployments are referenced as 'flow-name/deployment-name'.
        The flow name stays constant; the deployment name varies by namespace.

        Args:
            base_name: The base deployment name (e.g., 'video-initial-processing')

        Returns:
            Full reference (e.g., 'captionacc-video-initial-processing/captionacc-prod-video-initial-processing')
        """
        flow_name = f"captionacc-{base_name}"
        deployment_name = self.get_deployment_name(base_name)
        return f"{flow_name}/{deployment_name}"

    @property
    def effective_wasabi_access_key(self) -> str:
        """Get Wasabi access key."""
        return self.wasabi_access_key_readwrite

    @property
    def effective_wasabi_secret_key(self) -> str:
        """Get Wasabi secret key."""
        return self.wasabi_secret_key_readwrite


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
