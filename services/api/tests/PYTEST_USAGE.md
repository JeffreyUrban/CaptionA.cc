# Pytest Usage Guide

## Overview

The CaptionA.cc API test suite uses pytest markers to categorize tests by integration level, making it easy to run specific subsets of tests based on your needs.

## Custom Test Markers

The following markers are available:

- **`@pytest.mark.unit`**: Unit tests (fast, no external dependencies)
- **`@pytest.mark.integration`**: Integration tests (moderate speed, mocked externals)
- **`@pytest.mark.api`**: API endpoint tests (uses TestClient)
- **`@pytest.mark.flows`**: Prefect flow tests (mocked Modal/Supabase/Wasabi)
- **`@pytest.mark.slow`**: Slow-running tests (> 1s per test)
- **`@pytest.mark.websocket`**: WebSocket connection tests

## Running Tests by Marker

### Run specific test categories

```bash
# Run only unit tests (fastest)
pytest -m unit

# Run only integration tests
pytest -m integration

# Run only API endpoint tests
pytest -m api

# Run only flow tests
pytest -m flows

# Run only WebSocket tests
pytest -m websocket

# Exclude slow tests (useful for quick feedback)
pytest -m "not slow"
```

### Combine markers

```bash
# Run unit and integration tests only
pytest -m "unit or integration"

# Run all tests except flows and slow tests
pytest -m "not (flows or slow)"

# Run API and flow tests together
pytest -m "api or flows"
```

## Running Tests by Directory

```bash
# Run all tests in a specific directory
pytest tests/unit/
pytest tests/integration/
pytest tests/api/
pytest tests/flows/

# Run a specific test file
pytest tests/unit/services/test_priority_service.py

# Run a specific test function
pytest tests/unit/services/test_priority_service.py::test_specific_function
```

## Coverage Reports

### Generate coverage report

```bash
# Run all tests with coverage
pytest --cov=app --cov-report=term-missing

# Generate HTML coverage report
pytest --cov=app --cov-report=html
# Then open htmlcov/index.html in your browser

# Run with both terminal and HTML reports
pytest --cov=app --cov-report=term-missing --cov-report=html

# Fail if coverage is below threshold (80%)
pytest --cov=app --cov-fail-under=80
```

### Coverage for specific modules

```bash
# Check coverage for flows only
pytest tests/flows/ --cov=app.flows --cov-report=term-missing

# Check coverage for services only
pytest tests/unit/services/ --cov=app.services --cov-report=term-missing

# Check coverage for API endpoints
pytest tests/api/ --cov=app.endpoints --cov-report=term-missing
```

## Common Workflows

### Quick feedback loop (development)

```bash
# Run fast tests only (unit tests, skip slow tests)
pytest -m "unit and not slow" -v
```

### Pre-commit checks

```bash
# Run all tests except slow ones
pytest -m "not slow" --cov=app --cov-report=term-missing
```

### Full test suite with coverage

```bash
# Run everything with detailed coverage
pytest -v --cov=app --cov-report=term-missing --cov-report=html
```

### Focus on critical areas

```bash
# Run flow and webhook tests (critical gaps identified in test plan)
pytest -m "flows" -v

# Run integration and API tests
pytest -m "integration or api" -v
```

## Verbose Output Options

```bash
# Basic verbose output
pytest -v

# Show all output (including print statements)
pytest -v -s

# Show test durations
pytest --durations=10

# Show only failed tests
pytest -v --tb=short
```

## Parallel Execution (optional)

If you install `pytest-xdist`:

```bash
pip install pytest-xdist

# Run tests in parallel using multiple CPUs
pytest -n auto

# Run with 4 workers
pytest -n 4
```

## Configuration

The pytest configuration is defined in `/services/api/pyproject.toml`:

- **Test discovery**: Automatically finds `test_*.py` files in the `tests/` directory
- **Async support**: Uses `asyncio_mode = "auto"` for async test functions
- **Coverage**: Configured to measure coverage for the `app/` directory
- **Minimum coverage**: Set to 80% (`fail_under = 80`)

## Examples

### Example 1: Add marker to a test

```python
import pytest

@pytest.mark.unit
def test_priority_service():
    """Unit test for priority service."""
    assert priority_service.calculate() == expected_value

@pytest.mark.integration
def test_caption_service_with_repository():
    """Integration test with real SQLite database."""
    service = CaptionService(db)
    result = service.create_caption(...)
    assert result.id is not None

@pytest.mark.api
@pytest.mark.slow
async def test_api_endpoint_with_large_dataset(client):
    """API test that takes > 1s."""
    response = await client.post("/captions/batch", json=large_dataset)
    assert response.status_code == 200

@pytest.mark.flows
async def test_video_initial_processing_flow(mock_modal, mock_supabase):
    """Flow test with mocked external services."""
    result = await video_initial_processing(video_id="test-123")
    assert result["frame_count"] > 0
```

### Example 2: Run tests during development

```bash
# 1. Make code changes
# 2. Run relevant unit tests (fast feedback)
pytest -m unit -v

# 3. If unit tests pass, run integration tests
pytest -m integration -v

# 4. Run full suite with coverage before committing
pytest --cov=app --cov-report=term-missing
```

## Tips

1. **Use markers consistently**: Always mark your tests with the appropriate marker
2. **Start with unit tests**: They're fastest and give quick feedback
3. **Check coverage regularly**: Aim for 80%+ overall coverage
4. **Use `-v` for verbose output**: Easier to see which tests pass/fail
5. **Combine markers wisely**: Use boolean expressions to run exactly what you need
6. **Watch test duration**: Use `--durations=10` to identify slow tests

## Troubleshooting

### Tests not discovered

- Ensure test files start with `test_`
- Ensure test functions start with `test_`
- Ensure test classes start with `Test`

### Async tests failing

- Ensure you have `pytest-asyncio` installed
- The configuration already sets `asyncio_mode = "auto"`

### Coverage too low

```bash
# Find uncovered lines
pytest --cov=app --cov-report=term-missing

# Focus on specific modules
pytest tests/flows/ --cov=app.flows --cov-report=term-missing
```

## Resources

- [Pytest Documentation](https://docs.pytest.org/)
- [Pytest Markers](https://docs.pytest.org/en/stable/how-to/mark.html)
- [Coverage.py](https://coverage.readthedocs.io/)
- [Test Plan](./TEST_PLAN.md)
