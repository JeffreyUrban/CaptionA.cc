# Integration Tests for Modal Functions

This directory contains integration tests for the Modal serverless functions used in the CaptionA.cc video processing pipeline.

## Test Files

- `test_extract.py` - Integration tests for the `extract_frames_and_ocr` Modal function

## Running Integration Tests

Integration tests are **skipped by default** because they require:
- Modal deployment and configuration
- Wasabi S3 credentials and test data
- Google Cloud Vision API credentials

### Prerequisites

1. **Environment Variables**:
   ```bash
   export WASABI_REGION="your-region"
   export WASABI_ACCESS_KEY="your-access-key"  # pragma: allowlist secret
   export WASABI_SECRET_KEY="your-secret-key"  # pragma: allowlist secret
   export WASABI_BUCKET="your-bucket-name"
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
   ```

2. **Test Videos**: Upload test videos to Wasabi S3:
   - `test-tenant/client/videos/test-video-1/video.mp4` (small video with text, <10 seconds)
   - `test-tenant/client/videos/no-text/video.mp4` (small video without text)

3. **Enable Integration Tests**:
   ```bash
   export RUN_INTEGRATION_TESTS=1
   ```

### Running Tests

**Run all integration tests**:
```bash
RUN_INTEGRATION_TESTS=1 pytest tests/integration/
```

**Run specific test file**:
```bash
RUN_INTEGRATION_TESTS=1 pytest tests/integration/test_extract.py
```

**Run specific test**:
```bash
RUN_INTEGRATION_TESTS=1 pytest tests/integration/test_extract.py::TestExtractFramesAndOcrIntegration::test_extract_with_real_video
```

**Run with verbose output**:
```bash
RUN_INTEGRATION_TESTS=1 pytest tests/integration/ -v
```

**Run only slow tests**:
```bash
RUN_INTEGRATION_TESTS=1 pytest -m slow
```

**Run only integration tests** (across all test directories):
```bash
RUN_INTEGRATION_TESTS=1 pytest -m integration
```

**Skip integration tests** (runs only unit tests):
```bash
pytest -m "not integration"
```

## Test Coverage

### `test_extract.py` - Extract Frames and OCR Tests

Tests for the `extract_frames_and_ocr` Modal function (Section 2.1 of TEST_PLAN.md):

1. **test_extract_with_real_video** - Happy path with video containing text
   - Validates frame extraction, OCR processing, database creation
   - Verifies result metadata and S3 key structure
   - Runtime: ~2-5 minutes

2. **test_extract_handles_video_without_text** - Edge case with no text
   - Ensures OCR handles blank frames gracefully
   - Verifies `ocr_box_count == 0` and `failed_ocr_count == 0`
   - Runtime: ~1-3 minutes

3. **test_extract_different_frame_rates** - Parametrized frame rate testing
   - Tests frame extraction at 0.05Hz, 0.1Hz, and 0.2Hz
   - Validates frame count matches expected rate (within 10% tolerance)
   - Runtime: ~2-5 minutes per rate (6-15 minutes total)

4. **test_extract_creates_valid_databases** - Database validation
   - Downloads and decompresses databases from S3
   - Verifies SQLite format and schema
   - Validates OCR box counts match metadata
   - Runtime: ~2-5 minutes

## CI/CD Integration

For CI/CD pipelines, use the following approach:

```yaml
# Example GitHub Actions workflow
- name: Run Integration Tests
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  env:
    RUN_INTEGRATION_TESTS: "1"
    WASABI_REGION: ${{ secrets.WASABI_REGION }}
    WASABI_ACCESS_KEY: ${{ secrets.WASABI_ACCESS_KEY }}
    WASABI_SECRET_KEY: ${{ secrets.WASABI_SECRET_KEY }}
    WASABI_BUCKET: ${{ secrets.WASABI_BUCKET }}
    GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GCP_SERVICE_ACCOUNT }}
  run: |
    pytest tests/integration/ -v --tb=short
```

## Troubleshooting

**Tests are skipped**:
- Ensure `RUN_INTEGRATION_TESTS=1` is set
- Check that all required environment variables are configured

**Modal import errors**:
- Verify Modal is installed: `pip install modal`
- Ensure Modal is configured: `modal token new`

**S3 connection errors**:
- Verify Wasabi credentials are correct
- Check that test videos exist in S3

**Google Vision API errors**:
- Verify `GOOGLE_APPLICATION_CREDENTIALS` points to valid service account JSON
- Ensure the service account has Vision API permissions

**Database verification fails**:
- Check that the S3 bucket has the databases uploaded
- Verify boto3 is installed: `pip install boto3`
