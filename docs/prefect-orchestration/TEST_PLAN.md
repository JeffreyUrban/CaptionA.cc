# Prefect Orchestration Test Plan

This document outlines the testing strategy for the Prefect orchestration system.

---

## Testing Approach

We test **our implementation** - the integration code, business logic, and orchestration flows - not the external services themselves.

### What We Test
- Priority calculation logic
- Lock management (acquire/release)
- Flow orchestration (steps, error handling, status updates)
- Service integrations (how we call Prefect, Modal, Supabase, Wasabi)
- Webhook handling and authentication
- Error recovery strategies

### What We Don't Test
- Prefect's scheduling reliability
- Modal's GPU execution
- Supabase's database consistency
- Wasabi's S3 compatibility

We trust external services work as documented and test the boundaries.

---

## Test Pyramid

```
                  ┌─────────────┐
                  │  Manual E2E │  (5%)
                  └─────────────┘
              ┌───────────────────┐
              │  Automated E2E    │  (15%)
              └───────────────────┘
          ┌───────────────────────────┐
          │  Integration Tests        │  (30%)
          └───────────────────────────┘
      ┌───────────────────────────────────┐
      │  Unit Tests                       │  (50%)
      └───────────────────────────────────┘
```

---

## Level 1: Unit Tests

**Goal:** Test business logic in isolation with mocked dependencies

### 1.1 Priority Service Tests

**File:** `services/api/tests/unit/services/test_priority_service.py`

**Test Cases:**
- Base priority by tenant tier (free=50, premium=70, enterprise=90)
- Age boosting calculation (+1 per hour, cap at 20)
- Age boosting can be disabled
- Custom boost parameters work correctly
- Base priority override
- Priority tags generation

**Coverage Target:** 100% (pure functions, no mocking needed)

### 1.2 Supabase Service Tests

**File:** `services/api/tests/unit/services/test_supabase_service.py`

**Test Cases:**
- Video status updates (single and multiple fields)
- Lock acquisition (success when unlocked, failure when locked)
- Lock release
- Tenant tier lookup with mapping
- Metadata updates

**Mocking:** Mock Supabase client responses

**Coverage Target:** 90%

### 1.3 Wasabi Service Tests

**File:** `services/api/tests/unit/services/test_wasabi_service.py`

**Test Cases:**
- File upload (bytes and file objects)
- File download (creates parent dirs if needed)
- Bulk delete with prefix
- File existence checks
- Presigned URL generation

**Mocking:** Mock boto3 S3 client

**Coverage Target:** 85%

---

## Level 2: Integration Tests

**Goal:** Test integration between our components with mocked external services

### 2.1 Flow Integration Tests

**File:** `services/api/tests/integration/flows/test_video_initial_processing.py`

**Test Cases:**
- Flow executes successfully with mocked Modal
- Flow handles Modal function failures
- Flow handles Supabase update failures
- Status transitions are correct
- Error messages are set on failure

**Mocking:** Mock Modal functions, Supabase, Wasabi

**Coverage Target:** 80%

### 2.2 Webhook Handler Tests

**File:** `services/api/tests/integration/routers/test_webhooks.py`

**Test Cases:**
- Authentication (missing, invalid, valid tokens)
- Invalid payload handling
- Non-INSERT event ignored
- Successful flow triggering
- Priority calculation
- Prefect API called correctly

**Mocking:** Mock Prefect API, Supabase

**Coverage Target:** 85%

---

## Level 3: End-to-End Tests

**Goal:** Test complete workflows with real services

### 3.1 Video Processing E2E

**File:** `services/api/tests/e2e/test_video_processing_flow.py`

**Scenario:** Upload video → Initial processing completes
1. Upload test video to Wasabi
2. Trigger webhook (or call flow directly)
3. Verify Modal function executes
4. Verify files uploaded to Wasabi
5. Verify Supabase status updated

**Dependencies:** Modal, Wasabi, Supabase (real or staging)

**Run Frequency:** Pre-deployment, nightly builds

### 3.2 Crop and Infer E2E

**Scenario:** Approve layout → Crop/infer completes
1. Trigger approve-layout endpoint
2. Verify lock acquired
3. Verify Modal function executes
4. Verify lock released
5. Verify outputs created

**Dependencies:** Modal, Wasabi, Supabase

### 3.3 Caption OCR E2E

**Scenario:** Request caption OCR → OCR completes
1. Trigger caption OCR endpoint
2. Verify Modal function executes
3. Verify captions.db updated
4. Verify status updates

**Dependencies:** Modal, Wasabi, Supabase

---

## Level 4: Load & Performance Tests

**Goal:** Verify system handles concurrent requests

### 4.1 Concurrent Flow Execution

**File:** `services/api/tests/load/test_concurrent_flows.py`

**Test Cases:**
- 10 concurrent webhook requests complete successfully
- Response times acceptable (< 1s p95)
- Priority calculation remains accurate under load
- Worker handles queue depth

**Run Frequency:** Weekly, pre-deployment

### 4.2 Resource Usage

**File:** `services/api/tests/load/test_resource_usage.py`

**Test Cases:**
- Memory usage stays within limits under load
- Database connections are reused (no leaks)
- API starts even if worker fails
- Worker crashes are detected and logged

---

## Level 5: Error Recovery Tests

**Goal:** Verify system recovers from failures

### 5.1 Modal Function Failures

**Test Cases:**
- Modal timeout triggers retry
- GPU unavailable queues for retry
- Partial failures handled correctly

### 5.2 Network Failures

**Test Cases:**
- Prefect API connection loss returns 503
- Supabase timeouts trigger retries
- Wasabi upload failures retry

### 5.3 Lock Contention

**Test Cases:**
- Only one flow acquires lock (concurrent attempts)
- Flow retries when lock held
- Stale locks cleaned up after expiry

---

## Level 6: Security Tests

### 6.1 Webhook Authentication

**Test Cases:**
- Missing Authorization header rejected
- Invalid secret rejected
- Valid secret accepted
- Rate limiting (if implemented)

### 6.2 Tenant Isolation

**Test Cases:**
- Tenant cannot access other tenant's videos
- Tenant cannot trigger flows for other tenants
- All Wasabi keys include tenant_id prefix

---

## Test Execution Strategy

### Development Workflow

```bash
# Fast feedback (unit tests only)
pytest tests/unit/ -v

# Service integration tests
pytest tests/integration/ -v

# All except E2E and load
pytest -m "not e2e and not load" -v
```

### CI/CD Pipeline

```yaml
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - run: pytest tests/unit/ --cov --cov-report=xml

  integration-tests:
    needs: unit-tests
    steps:
      - run: pytest tests/integration/ -v

  e2e-tests:
    needs: integration-tests
    if: github.ref == 'refs/heads/main'
    steps:
      - run: pytest tests/e2e/ -v --timeout=1800
```

### Pre-Deployment Checklist

- [ ] All unit tests pass (90%+ coverage target)
- [ ] All integration tests pass
- [ ] At least 1 E2E test per flow passes
- [ ] Load tests show acceptable performance
- [ ] Security tests pass
- [ ] Manual smoke test in staging

---

## Test Data Management

### Test Video Library

Create videos with different characteristics:

```
tests/fixtures/videos/
├── short-5s-text-bottom.mp4
├── short-5s-no-text.mp4
├── medium-30s-multiple-captions.mp4
├── long-2m-dense-text.mp4
├── high-res-4k.mp4
├── low-res-480p.mp4
└── edge-cases/
    ├── vertical-video.mp4
    └── variable-framerate.mp4
```

### Test Database Snapshots

```
tests/fixtures/databases/
├── empty-layout.db
├── layout-with-annotations.db
├── caption-frame-extents-sample.db
└── captions-with-ocr.db.gz
```

---

## Success Criteria

### Coverage Targets

- **Unit Tests:** 90%+
- **Integration Tests:** 80%+
- **E2E Tests:** 100% of happy paths
- **Error Recovery:** 80%+ of failure scenarios

### Performance Targets

- **Webhook Response:** < 1s (p95)
- **Extract Frames:** < 5 min for 60s video
- **Crop and Infer:** < 10 min for 60s video
- **Caption OCR:** < 30s per caption
- **Concurrent Flows:** 10+ simultaneous

### Reliability Targets

- **Webhook Availability:** 99.9%
- **Flow Success Rate:** 95%+
- **Retry Success Rate:** 90%+ (after 1-2 retries)
- **Lock Contention:** < 1% of flows blocked

---

## pytest Configuration

**File:** `services/api/pytest.ini`

```ini
[pytest]
testpaths = tests
python_files = test_*.py

markers =
    unit: Unit tests (fast, no external dependencies)
    integration: Integration tests (mocked externals)
    e2e: End-to-end tests (real services)
    load: Load and performance tests
    recovery: Error recovery tests
    security: Security tests
    slow: Slow-running tests

addopts =
    --strict-markers
    --tb=short
    --disable-warnings

timeout = 300
asyncio_mode = auto
```

---

## Implementation Priority

### Phase 1: Unit Tests (Week 1)
- Priority service tests
- Supabase service tests
- Wasabi service tests
- **Target:** 90% coverage

### Phase 2: Integration Tests (Week 2)
- Flow integration tests
- Webhook handler tests
- **Target:** 80% coverage

### Phase 3: E2E Tests (Week 3)
- Video processing E2E
- Crop and infer E2E
- Caption OCR E2E
- **Target:** 3 complete workflows

### Phase 4: Load & Recovery (Week 4)
- Concurrent flow tests
- Error recovery tests
- Security tests
- **Target:** Performance benchmarks

### Phase 5: CI/CD Integration (Week 5)
- GitHub Actions workflows
- Test reporting
- Automated E2E testing
- **Target:** Full automation

---

## Key Principles

1. **Fast feedback loops** - Most tests run in < 5 seconds
2. **Realistic integration** - Mock responses match real behavior
3. **Production validation** - E2E tests use real or staging services
4. **Performance assurance** - Load tests prevent regressions
5. **Resilience verification** - Recovery tests ensure graceful degradation
6. **Security validation** - Security tests prevent common vulnerabilities

The test pyramid approach ensures most tests run quickly during development, while comprehensive E2E and load tests validate production readiness before deployment.
