#!/usr/bin/env python3
"""
End-to-end test for the video upload pipeline.

Tests the complete flow WITHOUT browser automation:
1. Authenticate as test user via Supabase
2. Request presigned upload URL from Edge Function
3. Upload video file to S3 (MinIO locally, Wasabi in staging)
4. Confirm upload completion
5. Verify video record created in Supabase
6. Verify Prefect flow triggered
7. (Optional) Wait for initial processing to complete

Usage:
    # Test with local MinIO (upload only)
    ./scripts/test-upload-pipeline.py --env local --video tests/fixtures/short-test.mp4

    # Test with staging Wasabi (upload only)
    ./scripts/test-upload-pipeline.py --env staging --video tests/fixtures/short-test.mp4

    # Wait for processing to complete (layout_status=annotate)
    ./scripts/test-upload-pipeline.py --env local --video tests/fixtures/short-test.mp4 --wait-for-processing

    # Verbose output
    ./scripts/test-upload-pipeline.py --env local --video tests/fixtures/short-test.mp4 -v

Environment variables (loaded from .env.local or .env.staging):
    - SUPABASE_URL
    - SUPABASE_ANON_KEY
    - PREFECT_API_URL (optional, for flow verification)
"""

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

# ============================================================================
# Configuration
# ============================================================================

@dataclass
class TestConfig:
    """Test configuration loaded from environment."""
    supabase_url: str
    supabase_anon_key: str
    prefect_api_url: Optional[str]
    test_email: str
    test_password: str
    verbose: bool = False

    @classmethod
    def from_env(cls, env_file: str, verbose: bool = False) -> "TestConfig":
        """Load configuration from environment file."""
        load_dotenv(env_file, override=True)

        return cls(
            supabase_url=os.environ["SUPABASE_URL"],
            supabase_anon_key=os.environ["SUPABASE_ANON_KEY"],
            prefect_api_url=os.environ.get("PREFECT_API_URL"),
            # Default test credentials - override via env if needed
            test_email=os.environ.get("TEST_USER_EMAIL", "admin@local.dev"),
            test_password=os.environ.get("TEST_USER_PASSWORD", "adminpass123"),
            verbose=verbose,
        )


# ============================================================================
# Test Steps
# ============================================================================

class UploadPipelineTest:
    """End-to-end test for the video upload pipeline."""

    def __init__(self, config: TestConfig, video_path: Path):
        self.config = config
        self.video_path = video_path
        self.client = httpx.Client(timeout=60.0)
        self.access_token: Optional[str] = None
        self.user_id: Optional[str] = None
        self.video_id: Optional[str] = None
        self.storage_key: Optional[str] = None

    def log(self, message: str, level: str = "INFO"):
        """Log a message with timestamp."""
        timestamp = time.strftime("%H:%M:%S")
        prefix = {"INFO": "ℹ️", "OK": "✅", "FAIL": "❌", "WAIT": "⏳"}.get(level, "")
        print(f"[{timestamp}] {prefix} {message}")

    def verbose(self, message: str):
        """Log verbose message."""
        if self.config.verbose:
            self.log(message, "INFO")

    # -------------------------------------------------------------------------
    # Step 1: Authenticate
    # -------------------------------------------------------------------------

    def authenticate(self) -> bool:
        """Authenticate with Supabase and get access token."""
        self.log(f"Authenticating as {self.config.test_email}...")

        url = f"{self.config.supabase_url}/auth/v1/token?grant_type=password"

        response = self.client.post(
            url,
            headers={
                "apikey": self.config.supabase_anon_key,
                "Content-Type": "application/json",
            },
            json={
                "email": self.config.test_email,
                "password": self.config.test_password,
            },
        )

        if response.status_code != 200:
            self.log(f"Authentication failed: {response.status_code} - {response.text}", "FAIL")
            return False

        data = response.json()
        self.access_token = data["access_token"]
        self.user_id = data["user"]["id"]

        self.log(f"Authenticated as user {self.user_id}", "OK")
        return True

    # -------------------------------------------------------------------------
    # Step 2: Request Presigned URL
    # -------------------------------------------------------------------------

    def request_presigned_url(self) -> bool:
        """Request presigned upload URL from Edge Function."""
        self.log("Requesting presigned upload URL...")

        file_size = self.video_path.stat().st_size
        filename = self.video_path.name
        content_type = "video/mp4"  # Assume MP4 for now

        self.verbose(f"  File: {filename} ({file_size} bytes)")

        url = f"{self.config.supabase_url}/functions/v1/captionacc-presigned-upload"

        response = self.client.post(
            url,
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json",
            },
            json={
                "filename": filename,
                "contentType": content_type,
                "sizeBytes": file_size,
            },
        )

        if response.status_code != 200:
            self.log(f"Failed to get presigned URL: {response.status_code} - {response.text}", "FAIL")
            return False

        data = response.json()
        self.video_id = data["videoId"]
        self.storage_key = data["storageKey"]
        upload_url = data["uploadUrl"]
        expires_at = data["expiresAt"]

        self.verbose(f"  Video ID: {self.video_id}")
        self.verbose(f"  Storage Key: {self.storage_key}")
        self.verbose(f"  Expires: {expires_at}")

        # Store upload URL for next step
        self._upload_url = upload_url
        self._content_type = content_type

        self.log(f"Got presigned URL for video {self.video_id}", "OK")
        return True

    # -------------------------------------------------------------------------
    # Step 3: Upload to S3
    # -------------------------------------------------------------------------

    def upload_to_s3(self) -> bool:
        """Upload video file to S3 using presigned URL."""
        self.log("Uploading video to S3...")

        file_size = self.video_path.stat().st_size

        with open(self.video_path, "rb") as f:
            file_data = f.read()

        # Translate Docker internal hostname to localhost for host-side requests
        # but preserve original Host header for S3 signature verification
        upload_url = self._upload_url
        headers = {"Content-Type": self._content_type}

        if "host.docker.internal" in upload_url:
            # Extract the original host for the Host header (required for signature)
            from urllib.parse import urlparse
            parsed = urlparse(upload_url)
            original_host = parsed.netloc
            headers["Host"] = original_host
            # Replace with localhost for actual connection
            upload_url = upload_url.replace("host.docker.internal", "localhost")

        self.verbose(f"  Uploading {file_size} bytes...")
        self.verbose(f"  URL: {upload_url[:80]}...")

        start_time = time.time()

        response = self.client.put(
            upload_url,
            headers=headers,
            content=file_data,
        )

        elapsed = time.time() - start_time

        if response.status_code not in (200, 201):
            self.log(f"S3 upload failed: {response.status_code} - {response.text}", "FAIL")
            return False

        speed = file_size / elapsed / 1024 if elapsed > 0 else 0
        self.log(f"Uploaded to S3 in {elapsed:.1f}s ({speed:.0f} KB/s)", "OK")
        return True

    # -------------------------------------------------------------------------
    # Step 4: Confirm Upload
    # -------------------------------------------------------------------------

    def confirm_upload(self) -> bool:
        """Confirm upload completion (creates video record in DB)."""
        self.log("Confirming upload completion...")

        url = f"{self.config.supabase_url}/functions/v1/captionacc-presigned-upload/confirm"

        file_size = self.video_path.stat().st_size
        filename = self.video_path.name

        response = self.client.post(
            url,
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json",
            },
            json={
                "videoId": self.video_id,
                "storageKey": self.storage_key,
                "filename": filename,
                "contentType": self._content_type,
                "sizeBytes": file_size,
                "videoPath": filename,  # Root folder
            },
        )

        if response.status_code != 200:
            self.log(f"Upload confirmation failed: {response.status_code} - {response.text}", "FAIL")
            return False

        self.log("Upload confirmed - video record created", "OK")
        return True

    # -------------------------------------------------------------------------
    # Step 5: Verify Video Record
    # -------------------------------------------------------------------------

    def verify_video_record(self) -> bool:
        """Verify video record exists in Supabase."""
        self.log("Verifying video record in database...")

        url = f"{self.config.supabase_url}/rest/v1/videos"

        response = self.client.get(
            url,
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "apikey": self.config.supabase_anon_key,
                "Accept-Profile": "captionacc",  # Use captionacc schema
            },
            params={
                "id": f"eq.{self.video_id}",
                "select": "id,video_path,storage_key,layout_status,boundaries_status,text_status,uploaded_at",
            },
        )

        if response.status_code != 200:
            self.log(f"Failed to query video: {response.status_code} - {response.text}", "FAIL")
            return False

        data = response.json()

        if not data:
            self.log(f"Video record not found: {self.video_id}", "FAIL")
            return False

        video = data[0]
        self.verbose(f"  Video record: {json.dumps(video, indent=2)}")

        self.log(f"Video record verified: {video['video_path']} (layout: {video.get('layout_status', 'N/A')})", "OK")
        return True

    # -------------------------------------------------------------------------
    # Step 6: Verify Prefect Flow Triggered
    # -------------------------------------------------------------------------

    def verify_prefect_flow(self, timeout: int = 30) -> bool:
        """Verify Prefect flow was triggered for the video."""
        if not self.config.prefect_api_url:
            self.log("Skipping Prefect verification (PREFECT_API_URL not set)", "INFO")
            return True

        # Check if Prefect server is accessible
        try:
            health_response = self.client.get(f"{self.config.prefect_api_url}/health", timeout=5.0)
            if health_response.status_code != 200:
                self.log("Skipping Prefect verification (server not healthy)", "INFO")
                return True
        except Exception:
            self.log("Skipping Prefect verification (server not reachable)", "INFO")
            return True

        self.log("Verifying Prefect flow triggered...", "WAIT")

        # Query Prefect for recent flow runs and check for our video_id in parameters
        url = f"{self.config.prefect_api_url}/flow_runs/filter"

        start_time = time.time()

        while time.time() - start_time < timeout:
            response = self.client.post(
                url,
                headers={"Content-Type": "application/json"},
                json={
                    "limit": 20,  # Get recent flow runs
                    "sort": "ID_DESC",  # Sort by ID descending (newest first)
                },
            )

            if response.status_code == 200:
                data = response.json()
                # Check if any flow run has our video_id in parameters
                for flow_run in data:
                    params = flow_run.get("parameters", {})
                    if params.get("video_id") == self.video_id:
                        state = flow_run.get("state_type", "UNKNOWN")
                        self.verbose(f"  Flow run: {flow_run['name']} (state: {state})")
                        self.log(f"Prefect flow triggered: {flow_run['name']} ({state})", "OK")
                        return True

            time.sleep(2)

        self.log(f"No Prefect flow found within {timeout}s", "FAIL")
        return False

    # -------------------------------------------------------------------------
    # Step 7: Wait for Processing to Complete
    # -------------------------------------------------------------------------

    def wait_for_processing(self, timeout: int = 300) -> bool:
        """Wait for video processing to complete (layout_status becomes 'annotate' or 'error').

        Args:
            timeout: Maximum time to wait in seconds (default: 5 minutes)
        """
        self.log(f"Waiting for processing to complete (timeout: {timeout}s)...", "WAIT")

        url = f"{self.config.supabase_url}/rest/v1/videos"

        start_time = time.time()
        last_status = None

        while time.time() - start_time < timeout:
            response = self.client.get(
                url,
                headers={
                    "Authorization": f"Bearer {self.access_token}",
                    "apikey": self.config.supabase_anon_key,
                    "Accept-Profile": "captionacc",
                },
                params={
                    "id": f"eq.{self.video_id}",
                    "select": "id,layout_status,total_frames,duration_seconds,width,height",
                },
            )

            if response.status_code != 200:
                self.log(f"Failed to query video status: {response.status_code}", "FAIL")
                return False

            data = response.json()
            if not data:
                self.log("Video record not found", "FAIL")
                return False

            video = data[0]
            layout_status = video.get("layout_status", "wait")

            if layout_status != last_status:
                last_status = layout_status
                elapsed = int(time.time() - start_time)
                self.log(f"  [{elapsed}s] layout_status: {layout_status}")

            if layout_status == "annotate":
                elapsed = int(time.time() - start_time)
                self.log(f"Processing completed in {elapsed}s", "OK")
                self.verbose(f"  Frames: {video.get('total_frames')}")
                self.verbose(f"  Duration: {video.get('duration_seconds')}s")
                self.verbose(f"  Dimensions: {video.get('width')}x{video.get('height')}")
                return True

            if layout_status == "error":
                self.log("Processing failed with error status", "FAIL")
                return False

            time.sleep(3)  # Poll every 3 seconds

        self.log(f"Processing did not complete within {timeout}s", "FAIL")
        return False

    # -------------------------------------------------------------------------
    # Run All Steps
    # -------------------------------------------------------------------------

    def run(self, wait_for_processing: bool = False) -> bool:
        """Run all test steps.

        Args:
            wait_for_processing: If True, wait for layout_status to become 'annotate'
        """
        self.log(f"Starting upload pipeline test with {self.video_path.name}")
        self.log(f"Supabase URL: {self.config.supabase_url}")
        print()

        steps = [
            ("Authenticate", self.authenticate),
            ("Request Presigned URL", self.request_presigned_url),
            ("Upload to S3", self.upload_to_s3),
            ("Confirm Upload", self.confirm_upload),
            ("Verify Video Record", self.verify_video_record),
            ("Verify Prefect Flow", self.verify_prefect_flow),
        ]

        # Add processing wait step if requested
        if wait_for_processing:
            steps.append(("Wait for Processing", self.wait_for_processing))

        for step_name, step_fn in steps:
            print()
            if not step_fn():
                self.log(f"Pipeline test FAILED at step: {step_name}", "FAIL")
                return False

        print()
        self.log("=" * 50)
        self.log("Upload pipeline test PASSED", "OK")
        self.log(f"Video ID: {self.video_id}")
        if wait_for_processing:
            self.log("Processing complete: layout_status=annotate")
        self.log("=" * 50)
        return True

    def cleanup(self):
        """Clean up resources."""
        self.client.close()


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="End-to-end test for video upload pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--env",
        choices=["local", "staging"],
        default="local",
        help="Environment to test (default: local)",
    )
    parser.add_argument(
        "--video",
        type=Path,
        required=True,
        help="Path to video file to upload",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Verbose output",
    )
    parser.add_argument(
        "--wait-for-processing",
        action="store_true",
        help="Wait for video processing to complete (layout_status=annotate)",
    )

    args = parser.parse_args()

    # Determine environment file
    project_root = Path(__file__).parent.parent
    env_file = project_root / f".env.{args.env}" if args.env != "local" else project_root / ".env.local"

    if not env_file.exists():
        print(f"Error: Environment file not found: {env_file}")
        sys.exit(1)

    if not args.video.exists():
        print(f"Error: Video file not found: {args.video}")
        sys.exit(1)

    # Load configuration
    config = TestConfig.from_env(str(env_file), verbose=args.verbose)

    # Run test
    test = UploadPipelineTest(config, args.video)

    try:
        success = test.run(wait_for_processing=args.wait_for_processing)
        sys.exit(0 if success else 1)
    finally:
        test.cleanup()


if __name__ == "__main__":
    main()
