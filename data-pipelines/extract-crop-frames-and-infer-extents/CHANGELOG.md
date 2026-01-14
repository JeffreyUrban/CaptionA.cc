# Changelog

## [Unreleased]

### Added - 2026-01-13

#### Parallel Wasabi Uploads
- **New `ParallelUploadCoordinator` class** for background chunk uploads
  - 4 parallel upload workers (configurable)
  - Chunks upload immediately after encoding completes
  - Overlaps with ongoing encoding work for maximum throughput

- **Integration with `ParallelEncodingCoordinator`**
  - Encoder triggers upload immediately after chunk completion
  - True 3-stage pipeline: GPU → Encode → Upload (all parallel)

- **Updated architecture documentation** in module docstring
  - Now documents full pipeline: extraction → inference → encoding → uploads
  - All stages run simultaneously for optimal resource utilization

#### Pytest-Based Test Suite
- **New test structure** under `tests/`
  - `tests/conftest.py`: Pytest configuration with custom CLI options
  - `tests/integration/test_pipelined_inference.py`: Full integration test
  - Automatic setup/teardown with Wasabi cleanup

- **Command-line options**
  - `--run-modal`: Enable Modal tests (skipped by default)
  - `--full-video`: Use full-length test video
  - `--batch-size`: Configure inference batch size (default: 32)

- **Test markers**
  - `@pytest.mark.modal`: Tests requiring Modal deployment
  - `@pytest.mark.integration`: Slower integration tests

- **Comprehensive test documentation** in `tests/README.md`
  - Quick start guide
  - Architecture highlights
  - Performance metrics and expected results
  - Troubleshooting common issues
  - CI/CD integration examples

- **Legacy script deprecation**
  - `test_pipelined.py` marked as deprecated
  - Shows migration path to pytest-based tests
  - Still functional for backward compatibility

### Changed

- **Pipeline architecture** now includes parallel uploads
  - Encoding coordinator accepts `upload_coordinator` parameter
  - `_encode_chunk()` triggers upload after successful encoding
  - Main pipeline waits for both encoding and upload completion

- **Module docstring** updated with 5-stage pipeline flow
  - Documents overlapped GPU processing, encoding, and uploads
  - Updated architecture diagram

- **Test workflow** modernized
  - Migrate from standalone script to pytest integration
  - Better fixtures and parametrization
  - Improved debugging and CI/CD support

### Performance Impact

- **Reduced wall-clock time** for full pipeline
  - Uploads now overlap with encoding (previously sequential)
  - Especially beneficial for large videos with many chunks
  - Network I/O hidden behind CPU encoding work

- **Better resource utilization**
  - 4 upload workers + 4 encoding workers = 8 parallel operations
  - GPU, CPU, and Network all utilized simultaneously

## Previous Releases

See git history for earlier changes.
