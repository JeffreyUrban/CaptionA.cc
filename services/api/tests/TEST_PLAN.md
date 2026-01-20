# Comprehensive Test Coverage Plan for CaptionA.cc API Service

## Executive Summary

Based on exploration of `/services/api/`, this plan addresses test coverage gaps across different integration levels **within the API service boundaries** (no external service E2E testing). The API has **15 existing test files (5,145 lines)** with good endpoint coverage but **missing flow tests** and incomplete integration testing.

---

## Current State Analysis

### ✅ **Strong Coverage Areas**
- **API Endpoints**: 13/15 endpoint test files exist
  - Captions CRUD (776 lines)
  - Boxes, Layout, Preferences, Stats, Admin
  - WebSocket sync (655 lines)
  - Sync/locking endpoints (484 lines)
- **Repository Layer**: 4 repository test files
  - Caption, Layout, OCR, DatabaseState repositories
- **Infrastructure**: Excellent fixture library (766 lines in conftest.py)
  - 40+ fixtures for databases, auth, clients
  - Mock implementations for complex services

### ❌ **Critical Coverage Gaps**

1. **Prefect Flows** (0% coverage)
   - No tests for any of 3 flows: `video_initial_processing`, `crop_and_infer`, `caption_ocr`
   - No flow-level error handling tests
   - No lock management tests in flows

2. **Service Integration** (Partial coverage)
   - Have: Unit tests for priority, supabase, wasabi services (just added)
   - Missing: Background tasks service, caption service, database manager, websocket manager integration

3. **Cross-Service Integration** (Limited)
   - Endpoints tested with mocked dependencies
   - Missing: Real service interaction tests (within API)

4. **Unimplemented Endpoints** (No tests)
   - `POST /actions/analyze-layout` (501)
   - `POST /actions/calculate-predictions` (501)
   - `POST /actions/retry` (501)

---

## Test Coverage Strategy: 4 Integration Levels

### **Level 1: Unit Tests** ✅ (Already Strong)
**Scope**: Individual functions/classes in isolation
**Status**: COMPLETE for services (priority, supabase, wasabi)
**Coverage Target**: 90-100%

**Remaining Work**:
- Service classes: BackgroundTasks, CaptionService (partial coverage via endpoint tests)
- Helper utilities and data transformers

---

### **Level 2: Component Integration Tests** ⚠️ (Partially Done)
**Scope**: Service + Repository interactions, mocked external APIs
**Status**: PARTIAL (repositories tested, service integration gaps)
**Coverage Target**: 80%+

**Test Areas**:

#### 2.1 Service Layer Integration
**Files to Test**:
- `app/services/caption_service.py` - Caption CRUD with repository
- `app/services/background_tasks.py` - Task queue operations
- `app/services/database_manager.py` - Multi-DB coordination
- `app/services/websocket_manager.py` - Connection lifecycle (has basic tests)

**Test Approach**:
- Real repository objects with SQLite test databases
- Mocked external services (Supabase client, Wasabi S3)
- Verify service logic without testing external APIs

**Example Test**: CaptionService with real SQLite
```python
def test_caption_service_overlap_resolution():
    """Test caption service resolves overlaps correctly."""
    db = create_test_captions_db()
    supabase_mock = Mock()  # Mock Supabase calls

    service = CaptionService(db, supabase_mock)

    # Create overlapping captions
    result = service.update_caption_with_overlap_resolution(...)

    # Verify: SQLite operations + Supabase mock calls
    assert result.resolution_type == "trim"
    supabase_mock.update_caption_status.assert_called()
```

---

### **Level 3: API Integration Tests** ✅ (Strong, Needs Expansion)
**Scope**: HTTP endpoints + services, mocked external APIs
**Status**: GOOD (13/15 endpoint files exist)
**Coverage Target**: 85%+

**Gaps to Address**:

#### 3.1 Unimplemented Endpoint Stubs
- Create `test_actions_unimplemented.py`
  - Verify 501 responses for analyze-layout, calculate-predictions, retry
  - Ensure proper error messages
  - Validate request schemas even though not implemented

#### 3.2 Error Path Coverage
**Enhance existing test files**:
- `test_captions.py`: Add database corruption scenarios
- `test_boxes.py`: Test missing OCR data edge cases
- `test_layout.py`: Test initialization race conditions
- `test_sync_endpoints.py`: Test lock contention with concurrent requests

#### 3.3 Authentication/Authorization
- Create `test_auth.py`
  - JWT validation logic
  - Tenant isolation verification
  - Admin role checks (when implemented)
  - Token expiration handling

---

### **Level 4: Flow Integration Tests** ❌ (CRITICAL GAP)
**Scope**: Prefect flows with mocked external services (Modal, Supabase, Wasabi)
**Status**: MISSING (0% coverage)
**Coverage Target**: 80%+
**Priority**: **HIGHEST**

**New Test Directory Structure**:
```
tests/
├── flows/
│   ├── __init__.py
│   ├── conftest.py              # Flow-specific fixtures
│   ├── test_video_initial_processing.py
│   ├── test_crop_and_infer.py
│   └── test_caption_ocr.py
```

#### 4.1 video_initial_processing Flow Tests

**File**: `tests/flows/test_video_initial_processing.py`
**Flow Location**: `app/flows/video_initial_processing.py`

**Test Classes**:

```python
class TestVideoInitialProcessingSuccess:
    """Test successful execution path."""

    def test_flow_updates_status_to_processing(mock_supabase, mock_modal):
        """Verify status transitions: uploading → processing → active."""

    def test_flow_calls_modal_with_correct_params(mock_modal):
        """Verify Modal function called with video_id, tenant_id, storage_key."""

    def test_flow_updates_metadata_with_frame_count(mock_supabase, mock_modal):
        """Verify frame count and duration saved to Supabase."""

    def test_flow_returns_correct_dict_structure():
        """Verify return: {video_id, frame_count, duration}."""

class TestVideoInitialProcessingErrors:
    """Test error handling and retries."""

    def test_modal_timeout_sets_error_status(mock_supabase, mock_modal):
        """Simulate Modal timeout (1800s), verify error status set."""

    def test_supabase_update_retry_logic(mock_supabase):
        """Verify 2 retries on Supabase update failures."""

    def test_metadata_update_failure_non_critical(mock_supabase):
        """Verify flow completes even if metadata update fails."""

    def test_error_message_propagation(mock_supabase):
        """Verify error message stored in video status."""

class TestVideoInitialProcessingConcurrency:
    """Test concurrent flow execution."""

    def test_multiple_videos_process_concurrently():
        """Verify flows for different videos don't conflict."""
```

**Key Mocking Strategy**:
```python
@pytest.fixture
def mock_modal(mocker):
    """Mock Modal function calls."""
    mock_function = mocker.patch('modal.Function.lookup')
    mock_result = FrameExtractionResult(
        frame_count=100,
        duration=10.0,
        # ... other fields
    )
    mock_function.return_value.remote.return_value = mock_result
    return mock_function

@pytest.fixture
def mock_supabase(mocker):
    """Mock Supabase service."""
    mock_service = mocker.patch('app.flows.video_initial_processing.SupabaseServiceImpl')
    return mock_service.return_value
```

#### 4.2 crop_and_infer Flow Tests

**File**: `tests/flows/test_crop_and_infer.py`
**Flow Location**: `app/flows/crop_and_infer.py`
**Critical Feature**: Lock management

**Test Classes**:

```python
class TestCropAndInferLockManagement:
    """Test server lock acquisition and release."""

    def test_lock_acquired_at_start(mock_supabase):
        """Verify acquire_server_lock called before processing."""

    def test_lock_released_in_finally_block(mock_supabase, mock_modal):
        """Verify lock released even on exception."""

    def test_lock_failure_prevents_processing(mock_supabase):
        """Verify flow fails fast if lock not acquired."""

    def test_lock_release_failure_logged_not_raised(mock_supabase):
        """Verify lock release errors don't fail flow."""

class TestCropAndInferSuccess:
    """Test successful execution."""

    def test_flow_updates_caption_status_to_processing(mock_supabase):
        """Verify caption_status: None → processing."""

    def test_modal_called_with_crop_region(mock_modal):
        """Verify CropRegion parameters passed to Modal."""

    def test_version_incremented(mock_supabase):
        """Verify cropped_frames_version incremented."""

    def test_artifacts_created(mock_prefect_context):
        """Verify Prefect artifacts created for observability."""

class TestCropAndInferErrors:
    """Test error handling."""

    def test_modal_failure_updates_error_status(mock_supabase, mock_modal):
        """Verify caption_status set to 'error' on Modal failure."""

    def test_task_retries_configured_correctly():
        """Verify process_inference_results has 2 retries with 10s delay."""

    def test_lock_always_released_on_error(mock_supabase):
        """Critical: Verify finally block executes on all error paths."""
```

#### 4.3 caption_ocr Flow Tests

**File**: `tests/flows/test_caption_ocr.py`
**Flow Location**: `app/flows/caption_ocr.py`

**Test Classes**:

```python
class TestCaptionOcrSuccess:
    """Test successful OCR generation."""

    def test_caption_status_transitions(mock_caption_service):
        """Verify: queued → processing → completed."""

    def test_modal_called_with_frame_range(mock_modal):
        """Verify Modal called with start_frame, end_frame, version."""

    def test_ocr_result_saved_to_caption(mock_caption_service):
        """Verify OCR text and confidence saved."""

    def test_flow_returns_caption_id_and_ocr():
        """Verify return dict structure."""

class TestCaptionOcrRetries:
    """Test retry mechanism."""

    def test_flow_retries_once_on_failure(mock_modal):
        """Verify 1 retry with 30s delay on exception."""

    def test_retry_success_after_transient_error(mock_modal):
        """Simulate transient error, verify retry succeeds."""

    def test_permanent_failure_after_retries(mock_modal):
        """Verify error status set after all retries exhausted."""

class TestCaptionOcrErrors:
    """Test error scenarios."""

    def test_missing_wasabi_credentials(mocker):
        """Verify ValueError raised if WASABI_ACCESS_KEY missing."""

    def test_modal_timeout_handling(mock_modal):
        """Verify timeout exception caught and status updated."""

    def test_invalid_frame_range(mock_caption_service):
        """Verify validation of start_frame < end_frame."""
```

**Shared Flow Testing Fixtures** (in `tests/flows/conftest.py`):

```python
@pytest.fixture
def mock_env_vars(monkeypatch):
    """Set up environment variables for flow testing."""
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")  # pragma: allowlist secret
    monkeypatch.setenv("WASABI_ACCESS_KEY_ID", "test-access")
    monkeypatch.setenv("WASABI_SECRET_ACCESS_KEY", "test-secret")  # pragma: allowlist secret
    monkeypatch.setenv("WASABI_BUCKET", "test-bucket")

@pytest.fixture
def mock_modal_app(mocker):
    """Mock Modal app lookup for all functions."""
    return mocker.patch('modal.Function.lookup')

@pytest.fixture
def mock_supabase_service(mocker):
    """Mock SupabaseServiceImpl for all flows."""
    mock = mocker.MagicMock(spec=SupabaseServiceImpl)
    # Configure default return values
    mock.acquire_server_lock.return_value = True
    return mock

@pytest.fixture
def mock_caption_service(mocker):
    """Mock CaptionService for caption_ocr flow."""
    return mocker.MagicMock(spec=CaptionService)
```

---

## Test Organization Improvements

### Current Structure (Flat)
```
tests/
├── conftest.py (766 lines - getting large)
├── test_captions.py
├── test_boxes.py
├── ... (13 more test files)
```

### Proposed Structure (Organized by Layer)
```
tests/
├── conftest.py (shared fixtures)
├── unit/                          # Level 1: Unit tests
│   ├── __init__.py
│   ├── services/                  # ✅ Already implemented
│   │   ├── test_priority_service.py
│   │   ├── test_supabase_service.py
│   │   └── test_wasabi_service.py
│   └── utils/                     # New
│       └── test_helpers.py
├── integration/                   # Level 2: Component integration
│   ├── __init__.py
│   ├── conftest.py (integration fixtures)
│   ├── services/                  # New
│   │   ├── test_caption_service_integration.py
│   │   ├── test_database_manager_integration.py
│   │   └── test_websocket_manager_integration.py
│   └── repositories/              # Move existing
│       ├── test_caption_repository.py
│       ├── test_layout_repository.py
│       ├── test_ocr_repository.py
│       └── test_database_state_repository.py
├── api/                           # Level 3: API integration
│   ├── __init__.py
│   ├── conftest.py (API fixtures)
│   ├── test_captions.py           # Move existing
│   ├── test_boxes.py
│   ├── test_layout.py
│   ├── test_preferences.py
│   ├── test_stats.py
│   ├── test_actions.py
│   ├── test_admin.py
│   ├── test_sync_endpoints.py
│   ├── test_websocket_sync.py
│   ├── test_auth.py               # New
│   └── test_actions_unimplemented.py  # New
└── flows/                         # Level 4: Flow integration
    ├── __init__.py
    ├── conftest.py (flow fixtures)
    ├── test_video_initial_processing.py  # New
    ├── test_crop_and_infer.py            # New
    └── test_caption_ocr.py               # New
```

---

## Pytest Configuration Enhancements

### Current (`pyproject.toml`)
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

### Proposed Enhancements
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]

# Custom markers for test categorization
markers = [
    "unit: Unit tests (fast, no external dependencies)",
    "integration: Integration tests (moderate speed, mocked externals)",
    "api: API endpoint tests (uses TestClient)",
    "flows: Prefect flow tests (mocked Modal/Supabase/Wasabi)",
    "slow: Slow-running tests (> 1s per test)",
    "websocket: WebSocket connection tests",
]

# Coverage settings
[tool.coverage.run]
source = ["app"]
omit = [
    "*/tests/*",
    "*/conftest.py",
    "*/__init__.py",
]

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "def __repr__",
    "raise AssertionError",
    "raise NotImplementedError",
    "if __name__ == .__main__.:",
    "if TYPE_CHECKING:",
    "@abstractmethod",
]
fail_under = 80  # Minimum coverage threshold
```

### Running Tests by Level
```bash
# Run by marker
pytest -m unit          # Fast unit tests
pytest -m integration   # Component integration tests
pytest -m api           # API endpoint tests
pytest -m flows         # Flow tests

# Run specific levels
pytest tests/unit/      # All unit tests
pytest tests/flows/     # All flow tests

# Run with coverage
pytest --cov=app --cov-report=html --cov-report=term-missing

# Run excluding slow tests
pytest -m "not slow"
```

---

## Test Coverage Metrics & Targets

### Coverage Goals by Component

| Component | Current | Target | Priority |
|-----------|---------|--------|----------|
| **Services** (priority, supabase, wasabi) | 100% | 100% | ✅ Done |
| **Services** (caption, background, db mgr) | ~40% | 85% | High |
| **Repositories** | 90% | 90% | ✅ Good |
| **API Endpoints** | 85% | 90% | Medium |
| **Prefect Flows** | 0% | 80% | **CRITICAL** |
| **Auth/Security** | Unknown | 90% | High |
| **WebSocket** | 70% | 85% | Medium |
| **Overall** | ~65% | 85% | Target |

### Priority Order for Implementation

1. **CRITICAL**: Flow integration tests (0% → 80%)
   - `test_video_initial_processing.py` (Priority 1)
   - `test_crop_and_infer.py` (Priority 1)
   - `test_caption_ocr.py` (Priority 2)

2. **HIGH**: Missing endpoint tests
   - `test_auth.py` (new)
   - Enhanced error paths in existing endpoint tests

3. **MEDIUM**: Service integration tests
   - `test_caption_service_integration.py`
   - `test_database_manager_integration.py`

4. **LOW**: Organizational refactoring
   - Restructure tests into unit/integration/api/flows directories
   - Split large conftest.py into level-specific fixtures

---

## Testing Principles for API Service

### 1. **Boundary Definition**
- ✅ Test: API logic, routing, validation, flow orchestration
- ❌ Don't Test: Modal function internals, Supabase reliability, S3 upload success
- 🎯 Mock: All external service calls (Modal, Supabase, Wasabi)

### 2. **Focus Areas**
- **Flow Logic**: Task sequencing, error handling, lock management
- **API Contracts**: Request/response schemas, status codes
- **Business Logic**: Overlap resolution, caption merging, status transitions
- **Error Recovery**: Retries, fallbacks, status updates

### 3. **Mock Strategy**
```python
# Mock at service boundaries
@patch('app.flows.video_initial_processing.SupabaseServiceImpl')
@patch('modal.Function.lookup')
def test_flow(mock_modal, mock_supabase):
    # Test flow orchestration logic
    # Verify service method calls
    # Verify error handling
```

### 4. **Integration Levels Within API**
- **Level 1**: Service methods (pure unit tests)
- **Level 2**: Service + Repository (real SQLite, mocked Supabase/Wasabi)
- **Level 3**: Endpoint + Services (TestClient, mocked externals)
- **Level 4**: Flow + Services (Prefect context, mocked externals)

---

## Implementation Timeline

### Phase 1: Flow Tests (Week 1) - CRITICAL
- Day 1-2: Set up `tests/flows/` structure and fixtures
- Day 3-4: Implement `test_video_initial_processing.py` (20 tests)
- Day 5-6: Implement `test_crop_and_infer.py` (25 tests, focus on lock management)
- Day 7: Implement `test_caption_ocr.py` (15 tests)

**Deliverable**: 60+ flow tests, 80% flow coverage

### Phase 2: Missing API Tests (Week 2)
- Day 1-2: Implement `test_auth.py` (20 tests)
- Day 3: Implement `test_actions_unimplemented.py` (5 tests)
- Day 4-7: Add error path tests to existing endpoint files (30+ tests)

**Deliverable**: 55+ new API tests, 90% endpoint coverage

### Phase 3: Service Integration (Week 3)
- Day 1-3: Implement `test_caption_service_integration.py` (25 tests)
- Day 4-6: Implement `test_database_manager_integration.py` (30 tests)
- Day 7: Enhance `test_websocket_manager.py` (10 additional tests)

**Deliverable**: 65+ integration tests, 85% service coverage

### Phase 4: Organization & CI (Week 4)
- Day 1-2: Restructure tests into unit/integration/api/flows
- Day 3-4: Update pytest configuration with markers
- Day 5-6: Set up coverage reporting and thresholds
- Day 7: CI integration and documentation

**Deliverable**: Organized test suite, 85% overall coverage

---

## Verification Plan

### Running the Test Suite
```bash
# Quick smoke test (unit tests only)
pytest tests/unit/ -v

# Full test suite
pytest -v

# With coverage report
pytest --cov=app --cov-report=html --cov-report=term-missing

# By integration level
pytest tests/unit/ tests/integration/ tests/api/ tests/flows/

# Specific priorities
pytest -m "flows"  # Critical gaps
```

### Coverage Validation
```bash
# Check overall coverage
pytest --cov=app --cov-report=term --cov-fail-under=85

# Generate HTML report
pytest --cov=app --cov-report=html
open htmlcov/index.html

# Check specific modules
pytest --cov=app.flows --cov-report=term-missing
pytest --cov=app.services --cov-report=term-missing
```

### Success Criteria
- [ ] All 3 Prefect flows have 80%+ test coverage
- [ ] Authentication logic has 90%+ coverage
- [ ] Overall API service coverage ≥ 85%
- [ ] All tests pass in < 30 seconds (excluding slow markers)
- [ ] No flaky tests (run suite 3x, 100% pass rate)

---

## Critical Files Reference

### Files to Create (Priority Order)
1. `tests/flows/conftest.py` - Flow testing fixtures
2. `tests/flows/test_video_initial_processing.py` - 20+ tests
3. `tests/flows/test_crop_and_infer.py` - 25+ tests
4. `tests/flows/test_caption_ocr.py` - 15+ tests
5. `tests/api/test_auth.py` - 20+ tests
6. `tests/integration/services/test_caption_service_integration.py` - 25+ tests

### Files to Enhance
1. `tests/test_captions.py` - Add error path tests
2. `tests/test_actions.py` - Add error handling tests
3. `tests/conftest.py` - Split into level-specific fixture files
4. `pyproject.toml` - Add pytest markers and coverage config

### Flow Files Under Test
1. `app/flows/video_initial_processing.py` (122 lines)
2. `app/flows/crop_and_infer.py` (195 lines)
3. `app/flows/caption_ocr.py` (121 lines)

---

## Summary

This plan addresses the **critical gap in Prefect flow testing** (0% → 80% coverage) while enhancing existing API and service tests to achieve **85% overall coverage**. The focus remains **within API service boundaries** by mocking all external services (Modal, Supabase, Wasabi). Implementation prioritizes flow tests (Week 1) as they represent the highest risk area with zero current coverage.
