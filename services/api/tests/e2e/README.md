# End-to-End Testing Guide

This directory contains end-to-end (E2E) integration tests for the CaptionA.cc video processing system. These tests validate the complete integration of our implementation with real external services: Modal, Supabase, and Wasabi.

## Table of Contents

1. [Overview](#overview)
2. [Test Philosophy](#test-philosophy)
3. [Test Files](#test-files)
4. [Prerequisites](#prerequisites)
5. [Running Tests](#running-tests)
6. [Test Structure](#test-structure)
7. [Debugging](#debugging)
8. [CI/CD Integration](#cicd-integration)
9. [Troubleshooting](#troubleshooting)

---

## Overview

End-to-end tests validate the complete integration of our video processing workflows by executing flows directly with real external services. These tests:

- Execute Prefect flows with real Modal GPU functions
- Store and retrieve data from real Supabase databases
- Upload and download files from real Wasabi S3 storage
- Verify lock management and concurrent processing safeguards
- Validate complete data flow from video upload to processed results

**What E2E tests ARE:**
- Integration validation for OUR implementation code
- Verification that we correctly call and integrate with external APIs
- Testing of our business logic with real service responses
- Validation of our error handling and recovery mechanisms

**What E2E tests ARE NOT:**
- Tests of external service reliability (we trust Prefect, Modal, Supabase, Wasabi)
- Performance benchmarks of external services
- Tests of Prefect scheduling (we bypass Prefect scheduler and execute flows directly)

---

## Test Philosophy

### Focus: Testing OUR Code, Not External Services

As outlined in `docs/prefect-orchestration/TEST_PLAN.md`, our E2E tests focus exclusively on testing **our implementation**, not the reliability of external services.

#### What We Test ✅

- **Our business logic:** Priority calculation, lock management, data transformations
- **Our integration code:** How we call Prefect API, Modal functions, Supabase, Wasabi
- **Our flow orchestration:** The steps our flows take, error handling, status updates
- **Our error handling:** How we recover from failures in external services

#### What We Don't Test ❌

- **Prefect's scheduling:** We trust Prefect schedules flows correctly
- **Prefect's priority queues:** We trust Prefect honors priority values
- **Prefect's worker reliability:** We trust Prefect workers execute flows
- **External service correctness:** We trust Supabase, Wasabi, Modal work as documented

#### Testing Approach

1. **Execute flows directly** - We bypass Prefect's scheduler and invoke flows directly to test our flow logic
2. **Use real services** - We connect to real Modal, Supabase, and Wasabi to test actual integration
3. **Verify our results** - We check that our code produces correct outputs and updates
4. **Clean up thoroughly** - We remove all test data after each test run

**Key Principle:** We test the boundary - that we integrate correctly with external services - not the services themselves.

---

## Test Files

### `test_video_processing_flow.py`

**Purpose:** Tests the complete video upload to initial processing flow.

**What it tests:**
- Webhook handler receives video insert events correctly
- `video_initial_processing` flow executes with real Modal frame extraction
- Video metadata is updated in Supabase with correct status
- Frame images are uploaded to Wasabi in correct locations
- OCR and layout databases are created and uploaded to Wasabi

**Flow tested:** `app.flows.video_initial_processing.video_initial_processing`

**Real services used:**
- Modal: `extract_frames_and_ocr` function
- Supabase: Video records, status updates
- Wasabi: Video file storage, frame storage, database storage

**Typical runtime:** 2-5 minutes (depends on video length and Modal GPU availability)

**Test scenarios:**
- `test_full_video_processing_integration` - Complete happy path from webhook to processed frames

### `test_crop_and_infer_flow.py`

**Purpose:** Tests the crop and infer caption frame extents workflow.

**What it tests:**
- Lock acquisition prevents concurrent processing (critical for data integrity)
- `crop_and_infer` flow executes with real Modal GPU inference
- Cropped frame images are created and versioned correctly
- Caption frame extents database is generated
- Lock is properly released after processing (even on errors)
- Video metadata is updated with new version number

**Flow tested:** `app.flows.crop_and_infer.crop_and_infer`

**Real services used:**
- Modal: `crop_and_infer_caption_frame_extents` function
- Supabase: Lock management, video metadata, database state tracking
- Wasabi: Layout database retrieval, cropped frames storage, extents database storage

**Typical runtime:** 3-8 minutes (depends on video length and Modal GPU availability)

**Test scenarios:**
- `test_crop_and_infer_integration` - Happy path with lock management verification
- `test_crop_and_infer_lock_contention` - Validates flow fails correctly when lock is held

---

## Prerequisites

### Required Environment Variables

E2E tests require real service credentials configured via environment variables:

#### Supabase Configuration
```bash
# Required
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..."  # Service role key for admin access
export SUPABASE_JWT_SECRET="your-jwt-secret"    # For generating test auth tokens  # pragma: allowlist secret

# Optional
export SUPABASE_SCHEMA="captionacc_prod"  # Default: captionacc_prod
```

#### Wasabi S3 Configuration
```bash
# Required (use either set)
export WASABI_ACCESS_KEY_READWRITE="WASABI_ACCESS_KEY"  # pragma: allowlist secret
export WASABI_SECRET_KEY_READWRITE="WASABI_SECRET_KEY"  # pragma: allowlist secret
# OR
export WASABI_ACCESS_KEY_ID="WASABI_ACCESS_KEY"  # pragma: allowlist secret
export WASABI_SECRET_ACCESS_KEY="WASABI_SECRET_KEY"  # pragma: allowlist secret

export WASABI_BUCKET="your-bucket-name"

# Optional
export WASABI_REGION="us-east-1"  # Default: us-east-1
```

#### Modal Configuration
```bash
# Required
export MODAL_TOKEN_ID="your-modal-token-id"
export MODAL_TOKEN_SECRET="your-modal-token-secret"  # pragma: allowlist secret

# Optional
export MODAL_ENVIRONMENT="main"  # Default: main
```

#### Webhook Configuration (for webhook handler tests)
```bash
# Optional
export WEBHOOK_SECRET="test-webhook-secret"  # Default: test-webhook-secret  # pragma: allowlist secret
```

### Service Requirements

1. **Modal Account**
   - Active Modal account with sufficient credits
   - GPU quota available (tests use GPU functions)
   - Modal CLI authenticated: `modal token set --token-id <id> --token-secret <secret>`

2. **Supabase Instance**
   - Database schema deployed (tables: `videos`, `video_database_state`)
   - Service role key with admin privileges
   - JWT secret for token generation

3. **Wasabi S3 Bucket**
   - Read/write access credentials
   - Bucket must exist
   - Sufficient storage quota

4. **FFmpeg (for test video generation)**
   - FFmpeg installed and available in PATH
   - Used by `tests/utils/helpers.py` to create test videos
   - Install: `brew install ffmpeg` (macOS) or `apt-get install ffmpeg` (Linux)

### Setup Steps

1. **Clone repository and install dependencies:**
   ```bash
   cd services/api
   uv pip install -e ".[dev]"
   ```

2. **Configure environment variables:**
   ```bash
   # Copy example env file (if available)
   cp .env.example .env

   # Edit .env with your credentials
   vim .env

   # Source environment
   source .env
   ```

3. **Verify Modal authentication:**
   ```bash
   modal token set --token-id <id> --token-secret <secret>
   modal app list  # Should show your apps
   ```

4. **Verify Supabase connection:**
   ```bash
   # Quick Python check
   python -c "from app.services.supabase_service import SupabaseServiceImpl; import os; s = SupabaseServiceImpl(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'], os.environ.get('SUPABASE_SCHEMA', 'captionacc_prod')); print('Connected:', s.client is not None)"
   ```

5. **Verify Wasabi connection:**
   ```bash
   # Quick Python check
   python -c "from app.services.wasabi_service import WasabiServiceImpl; import os; w = WasabiServiceImpl(os.environ.get('WASABI_ACCESS_KEY_READWRITE') or os.environ['WASABI_ACCESS_KEY_ID'], os.environ.get('WASABI_SECRET_KEY_READWRITE') or os.environ['WASABI_SECRET_ACCESS_KEY'], os.environ['WASABI_BUCKET'], os.environ.get('WASABI_REGION', 'us-east-1')); print('Connected')"
   ```

---

## Running Tests

### Run All E2E Tests

```bash
cd services/api

# Run all E2E tests (marked with @pytest.mark.e2e)
pytest tests/e2e/ -v

# Run with coverage
pytest tests/e2e/ -v --cov=app --cov-report=html

# Run with detailed output
pytest tests/e2e/ -v -s  # -s shows print statements
```

### Skip E2E Tests

E2E tests are automatically marked with `@pytest.mark.e2e`. Skip them during regular development:

```bash
# Run all tests EXCEPT E2E tests
pytest -m "not e2e" -v

# Run only unit tests
pytest tests/unit/ -v
```

### Run Specific Test Files

```bash
# Run only video processing flow tests
pytest tests/e2e/test_video_processing_flow.py -v

# Run only crop and infer flow tests
pytest tests/e2e/test_crop_and_infer_flow.py -v
```

### Run Specific Test Cases

```bash
# Run a specific test method
pytest tests/e2e/test_video_processing_flow.py::TestVideoProcessingE2E::test_full_video_processing_integration -v

# Run lock contention test
pytest tests/e2e/test_crop_and_infer_flow.py::TestCropAndInferE2E::test_crop_and_infer_lock_contention -v
```

### Run with Timeout

E2E tests can take several minutes. Set a timeout to prevent hanging:

```bash
# Set 10-minute timeout per test
pytest tests/e2e/ -v --timeout=600

# Set 5-minute timeout
pytest tests/e2e/ -v --timeout=300
```

### Parallel Execution (Not Recommended)

⚠️ **Warning:** E2E tests create real resources in external services. Running them in parallel may cause:
- Lock contention in Supabase
- Rate limiting on Modal/Wasabi
- Test interference and flaky results

If you must run in parallel, ensure tests use completely isolated resources:

```bash
# Run with pytest-xdist (use with caution)
pytest tests/e2e/ -v -n 2  # Max 2 parallel workers
```

### Test Output and Logging

E2E tests include detailed logging for debugging:

```bash
# Show all output including print statements
pytest tests/e2e/ -v -s

# Show only failures with full output
pytest tests/e2e/ -v --tb=long

# Quiet mode (minimal output)
pytest tests/e2e/ -q
```

---

## Test Structure

### Fixtures (from `conftest.py`)

E2E tests use pytest fixtures defined in `tests/e2e/conftest.py`:

#### Configuration Fixtures

- **`e2e_settings`** (session) - Loads and validates all required environment variables
- **`supabase_service`** (session) - Real Supabase service instance with service role key
- **`wasabi_service`** (session) - Real Wasabi S3 service instance

#### Test Data Fixtures

- **`e2e_tenant_id`** - Generates unique tenant ID for test isolation
- **`e2e_video_id`** - Generates unique video ID for test isolation
- **`e2e_user_id`** - Generates unique user ID for test authentication

#### Data Management Fixtures

- **`test_video_record`** - Creates video record in Supabase, cleans up after test
- **`test_database_state`** - Creates database state record for lock management, cleans up
- **`temp_test_video`** - Creates temporary video file with FFmpeg, cleans up
- **`uploaded_test_video`** - Uploads test video to Wasabi, cleans up

#### Authentication Fixtures

- **`e2e_auth_token`** - Generates real JWT token for API authentication
- **`e2e_auth_context`** - Creates AuthContext for authenticated requests
- **`e2e_app`** - FastAPI application instance configured for E2E testing
- **`e2e_client`** - Async HTTP client with authentication headers

### Test Flow Pattern

All E2E tests follow a similar pattern:

```python
@pytest.mark.e2e
@pytest.mark.slow
class TestMyFlowE2E:
    """E2E tests for my_flow."""

    @pytest.fixture
    async def test_video(self):
        """Create test resources (video, upload to Wasabi, etc.)."""
        # Setup
        resources = setup_test_resources()
        yield resources
        # Cleanup
        cleanup_test_resources(resources)

    @pytest.mark.asyncio
    async def test_my_flow_integration(self, test_video):
        """Test flow with real services."""
        # Step 1: Setup and prerequisites
        # Step 2: Execute flow directly (bypass Prefect scheduler)
        result = await my_flow(...)

        # Step 3: Verify flow results
        assert result["status"] == "success"

        # Step 4: Verify database updates
        metadata = supabase.get_video_metadata(video_id)
        assert metadata["status"] == "active"

        # Step 5: Verify file creation
        assert wasabi.file_exists(expected_key)

        # Step 6: Verify cleanup/locks released
        assert lock_is_released()
```

### Cleanup Strategy

Tests use try/finally blocks and fixture teardown to ensure cleanup:

1. **Fixtures handle cleanup** - All fixtures with `yield` clean up resources automatically
2. **Unique IDs** - Tests use UUID-based IDs to avoid conflicts
3. **Prefix-based deletion** - Wasabi cleanup deletes entire tenant prefix
4. **Database cleanup** - Supabase records deleted by video_id
5. **Lock cleanup** - Locks explicitly released in finally blocks

**Example cleanup in fixture:**

```python
@pytest.fixture
async def test_video(self):
    tenant_id = f"test-tenant-{uuid.uuid4()}"
    video_id = f"test-video-{uuid.uuid4()}"

    # Setup
    create_video_record(video_id, tenant_id)

    yield {"video_id": video_id, "tenant_id": tenant_id}

    # Cleanup (always runs even if test fails)
    try:
        delete_video_record(video_id)
        wasabi.delete_prefix(f"{tenant_id}/")
    except Exception as e:
        print(f"Warning: Cleanup failed: {e}")
```

---

## Debugging

### Debugging Failing E2E Tests

1. **Check environment variables:**
   ```bash
   # Verify all required vars are set
   env | grep SUPABASE
   env | grep WASABI
   env | grep MODAL
   ```

2. **Run with verbose output:**
   ```bash
   pytest tests/e2e/test_video_processing_flow.py -v -s
   ```

3. **Check Modal function logs:**
   ```bash
   # View Modal logs for recent runs
   modal app logs captionacc-modal

   # View specific function logs
   modal app logs captionacc-modal --function extract_frames_and_ocr
   ```

4. **Inspect Supabase data:**
   ```python
   from app.services.supabase_service import SupabaseServiceImpl
   import os

   supabase = SupabaseServiceImpl(
       os.environ["SUPABASE_URL"],
       os.environ["SUPABASE_SERVICE_ROLE_KEY"],
       os.environ.get("SUPABASE_SCHEMA", "captionacc_prod")
   )

   # Check video record
   result = supabase.client.schema(supabase.schema).table("videos").select("*").eq("id", "test-video-xyz").execute()
   print(result.data)

   # Check lock state
   result = supabase.client.schema(supabase.schema).table("video_database_state").select("*").eq("video_id", "test-video-xyz").execute()
   print(result.data)
   ```

5. **Inspect Wasabi files:**
   ```python
   from app.services.wasabi_service import WasabiServiceImpl
   import os

   wasabi = WasabiServiceImpl(
       os.environ.get("WASABI_ACCESS_KEY_READWRITE") or os.environ["WASABI_ACCESS_KEY_ID"],
       os.environ.get("WASABI_SECRET_KEY_READWRITE") or os.environ["WASABI_SECRET_ACCESS_KEY"],
       os.environ["WASABI_BUCKET"],
       os.environ.get("WASABI_REGION", "us-east-1")
   )

   # List files for test tenant
   files = wasabi.list_files(prefix="test-tenant-xyz/")
   for f in files:
       print(f)
   ```

### Common Debugging Commands

```bash
# Drop into debugger on failure
pytest tests/e2e/ -v --pdb

# Drop into debugger on first failure, then exit
pytest tests/e2e/ -v --pdb -x

# Show local variables in traceback
pytest tests/e2e/ -v --showlocals

# Run last failed tests only
pytest tests/e2e/ -v --lf

# Run failed tests first, then others
pytest tests/e2e/ -v --ff
```

### Interactive Debugging

Add breakpoints in test code:

```python
@pytest.mark.asyncio
async def test_my_flow(self, test_video):
    video_id = test_video["video_id"]

    # Add breakpoint
    import pdb; pdb.set_trace()

    result = await my_flow(video_id=video_id)
    assert result["status"] == "success"
```

Or use `breakpoint()` (Python 3.7+):

```python
@pytest.mark.asyncio
async def test_my_flow(self, test_video):
    video_id = test_video["video_id"]

    # Modern breakpoint
    breakpoint()

    result = await my_flow(video_id=video_id)
```

### Debugging Modal Functions

To debug Modal functions called by E2E tests:

1. **Enable Modal remote debugging:**
   ```python
   import modal

   with modal.enable_remote_debugging():
       result = extract_frames_and_ocr.remote(...)
   ```

2. **View Modal logs in real-time:**
   ```bash
   modal app logs captionacc-modal --follow
   ```

3. **Test Modal function directly:**
   ```python
   import modal

   app = modal.App.lookup("captionacc-modal", create_if_missing=False)
   extract_func = modal.Function.lookup("captionacc-modal", "extract_frames_and_ocr")

   result = extract_func.remote(
       video_key="test-tenant/videos/test-video/video.mp4",
       tenant_id="test-tenant",
       video_id="test-video",
       frame_rate=0.1
   )
   print(result)
   ```

---

## CI/CD Integration

### GitHub Actions Configuration

E2E tests should run on:
- ✅ Pull requests to `main` branch (optional, as they're slow)
- ✅ Merge to `main` branch (always)
- ✅ Nightly scheduled runs
- ✅ Manual trigger (workflow_dispatch)

**Recommended GitHub Actions workflow:**

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  # Run on pull requests (optional, comment out if too slow)
  pull_request:
    branches: [main]

  # Always run on merge to main
  push:
    branches: [main]

  # Nightly at 2 AM UTC
  schedule:
    - cron: '0 2 * * *'

  # Allow manual trigger
  workflow_dispatch:

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 30  # E2E tests can take time

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install FFmpeg
        run: sudo apt-get update && sudo apt-get install -y ffmpeg

      - name: Install dependencies
        run: |
          cd services/api
          uv pip install -e ".[dev]"

      - name: Run E2E tests
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          SUPABASE_JWT_SECRET: ${{ secrets.SUPABASE_JWT_SECRET }}
          SUPABASE_SCHEMA: ${{ secrets.SUPABASE_SCHEMA }}
          WASABI_ACCESS_KEY_READWRITE: ${{ secrets.WASABI_ACCESS_KEY_READWRITE }}
          WASABI_SECRET_KEY_READWRITE: ${{ secrets.WASABI_SECRET_KEY_READWRITE }}
          WASABI_BUCKET: ${{ secrets.WASABI_BUCKET }}
          WASABI_REGION: ${{ secrets.WASABI_REGION }}
          MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}
          MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }}
          WEBHOOK_SECRET: ${{ secrets.WEBHOOK_SECRET }}
        run: |
          cd services/api
          pytest tests/e2e/ -v --timeout=600 --tb=short

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-test-results
          path: services/api/htmlcov/
```

### Required GitHub Secrets

Configure these secrets in your repository:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `SUPABASE_SCHEMA`
- `WASABI_ACCESS_KEY_READWRITE`
- `WASABI_SECRET_KEY_READWRITE`
- `WASABI_BUCKET`
- `WASABI_REGION`
- `MODAL_TOKEN_ID`
- `MODAL_TOKEN_SECRET`
- `WEBHOOK_SECRET`

### Pre-Deployment Checklist

Before deploying to production:

- [ ] All unit tests pass (`pytest tests/unit/ -v`)
- [ ] All integration tests pass (`pytest tests/integration/ -v`)
- [ ] All E2E tests pass (`pytest tests/e2e/ -v`)
- [ ] No flaky test failures (run E2E tests 3x, all pass)
- [ ] Manual smoke test in staging environment
- [ ] Review Modal GPU quotas and costs
- [ ] Verify Wasabi storage limits not exceeded
- [ ] Check Supabase database size and performance

---

## Troubleshooting

### Common Issues and Solutions

#### Issue: "SUPABASE_URL environment variable is required"

**Cause:** Environment variables not configured.

**Solution:**
```bash
# Check if variables are set
env | grep SUPABASE

# Source your .env file
source .env

# Or export directly
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..."
```

#### Issue: "Failed to create test video record in Supabase"

**Cause:** Supabase service role key lacks permissions or schema doesn't exist.

**Solution:**
1. Verify service role key has admin privileges
2. Check that schema exists: `SELECT schema_name FROM information_schema.schemata;`
3. Verify tables exist: `\dt captionacc_prod.*` (in psql)
4. Check network connectivity to Supabase

#### Issue: "Modal function failed: GPU timeout"

**Cause:** Modal GPU unavailable or quota exceeded.

**Solution:**
1. Check Modal GPU quota: `modal quota`
2. Check Modal account status and credits
3. Retry test (GPUs may be temporarily unavailable)
4. Consider using smaller test videos to reduce GPU time

#### Issue: "No files found at Wasabi prefix"

**Cause:** Modal function failed silently or Wasabi credentials incorrect.

**Solution:**
1. Check Modal logs: `modal app logs captionacc-modal`
2. Verify Wasabi credentials and bucket name
3. Test Wasabi connection manually (see Prerequisites)
4. Check if Modal function completed successfully (review logs)

#### Issue: "Lock was not released"

**Cause:** Flow raised exception before reaching finally block, or bug in lock management.

**Solution:**
1. Check flow logs for exceptions
2. Manually release lock:
   ```python
   from app.services.supabase_service import SupabaseServiceImpl
   import os

   supabase = SupabaseServiceImpl(...)
   supabase.release_server_lock(video_id="test-video-xyz", database_name="layout")
   ```
3. Review flow code for missing try/finally around lock acquisition

#### Issue: "FFmpeg not found"

**Cause:** FFmpeg not installed or not in PATH.

**Solution:**
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt-get install ffmpeg

# Verify installation
ffmpeg -version
```

#### Issue: Tests hang/timeout

**Cause:** Modal function stuck, network issue, or infinite loop.

**Solution:**
1. Set explicit timeout: `pytest tests/e2e/ --timeout=300`
2. Check Modal logs for stuck functions
3. Cancel stuck Modal functions: `modal app stop captionacc-modal`
4. Check network connectivity to all services

#### Issue: "FileNotFoundError: layout.db"

**Cause:** Previous test step failed, layout.db not created.

**Solution:**
1. Run `test_video_processing_flow.py` first to create layout.db
2. Check that video_initial_processing flow completed successfully
3. Verify Wasabi has the layout.db.gz file for the test video

#### Issue: Flaky tests (pass sometimes, fail sometimes)

**Cause:** Race conditions, resource contention, or external service instability.

**Solution:**
1. Run test multiple times: `pytest tests/e2e/test_crop_and_infer_flow.py -v --count=5`
2. Check for race conditions in lock management
3. Ensure unique test IDs (use UUID, not timestamps)
4. Add retries for transient failures
5. Check Modal/Wasabi/Supabase status pages for incidents

### Getting Help

If you encounter issues not covered here:

1. **Check test logs:** Run with `-v -s` for detailed output
2. **Check service logs:** Modal, Supabase, Wasabi dashboards
3. **Check documentation:** Review `docs/prefect-orchestration/TEST_PLAN.md`
4. **Ask the team:** Post in #engineering Slack channel
5. **File an issue:** Create GitHub issue with full error logs

### Cleaning Up Leftover Test Data

If tests fail to clean up (crashes, SIGKILL, etc.), manually clean up:

```python
from app.services.supabase_service import SupabaseServiceImpl
from app.services.wasabi_service import WasabiServiceImpl
import os

# Initialize services
supabase = SupabaseServiceImpl(...)
wasabi = WasabiServiceImpl(...)

# Find test resources (look for "test-tenant-" prefix)
files = wasabi.list_files(prefix="test-tenant-")
print(f"Found {len(files)} test files")

# Delete all test files
for prefix in set(f.split('/')[0] for f in files if f.startswith("test-tenant-")):
    deleted = wasabi.delete_prefix(f"{prefix}/")
    print(f"Deleted {deleted} files from {prefix}/")

# Clean up test video records (be careful with this!)
result = supabase.client.schema(supabase.schema).table("videos").delete().like("id", "test-video-%").execute()
print(f"Deleted {len(result.data)} test video records")

# Clean up test database states
result = supabase.client.schema(supabase.schema).table("video_database_state").delete().like("video_id", "test-video-%").execute()
print(f"Deleted {len(result.data)} test database state records")
```

**⚠️ Warning:** Be very careful with cleanup scripts. Always use `test-` prefixes and verify queries before executing!

---

## Additional Resources

- **Test Plan:** `docs/prefect-orchestration/TEST_PLAN.md` - Comprehensive test strategy
- **Test Helpers:** `tests/utils/helpers.py` - Utility functions for creating test data
- **Conftest:** `tests/e2e/conftest.py` - Pytest fixtures and configuration
- **Pytest Configuration:** `pyproject.toml` - Pytest settings and markers

## Questions?

For questions about E2E testing:
- Review this README and the test plan
- Check existing test code for examples
- Ask in #engineering Slack channel
- File a GitHub issue for documentation improvements

---

**Last Updated:** 2026-01-12
**Version:** 2.0
