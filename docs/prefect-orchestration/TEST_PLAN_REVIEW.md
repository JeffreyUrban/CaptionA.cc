# Test Plan Review: Testing Our Code vs. Testing Prefect

**Date:** 2026-01-12
**Reviewer:** Analysis of test coverage boundaries

---

## Executive Summary

After reviewing the test plan, I've identified several tests that inadvertently test Prefect's functionality rather than our implementation. This document categorizes all tests and provides corrections.

### Key Findings

**✅ Good Tests (Keep):** 85% of tests correctly focus on our implementation
**⚠️ Problematic Tests:** 15% test Prefect rather than our code
**Action Required:** Remove or refactor 8 test cases

---

## What We SHOULD Test

### Our Business Logic ✅
- Priority calculation algorithm (tier mapping + age boosting)
- Lock acquisition/release logic
- Service method implementations (Supabase, Wasabi, Caption)
- Data transformations and validations
- Error handling in our code

### Our Integration Logic ✅
- That we call external services with correct parameters
- That we handle external service responses correctly
- That we construct API requests properly (to Prefect, Modal, etc.)
- That we parse and validate webhook payloads
- Authentication and authorization logic

### Our Flow Orchestration ✅
- Flow function logic (what steps we take)
- Modal function parameter construction
- Status update sequencing
- Error handling and recovery in flows
- Lock management patterns

---

## What We Should NOT Test

### Prefect's Core Functionality ❌
- That Prefect schedules flows correctly
- That Prefect's work pools distribute work
- That Prefect's priority queues order flows
- That Prefect's retry mechanisms work
- That Prefect's state management is consistent
- Prefect worker process stability

### External Service Functionality ❌
- That Supabase stores data correctly
- That Wasabi S3 uploads work
- That Modal executes functions
- That Google Vision OCR is accurate

### Infrastructure Performance ❌
- How fast Prefect can process flows
- Worker throughput capabilities
- Network latency between services

---

## Test-by-Test Review

### Level 1: Unit Tests ✅ ALL GOOD

All unit tests correctly test our implementation:

**Priority Service Tests** ✅
- `test_base_priority_*` - Tests our tier mapping logic
- `test_age_boosting_*` - Tests our age calculation algorithm
- `test_priority_tags_*` - Tests our tag generation logic

**Supabase Service Tests** ✅
- `test_update_video_status` - Tests our update logic with mocked client
- `test_acquire_server_lock` - Tests our lock acquisition logic
- `test_get_tenant_tier` - Tests our tier mapping logic

**Wasabi Service Tests** ✅
- All tests mock boto3 and verify we call it correctly
- Tests our wrapper logic, not S3 itself

**Verdict:** ✅ Keep all unit tests as-is

---

### Level 2: Service Integration Tests

#### Flow Integration Tests ✅ MOSTLY GOOD

**File:** `test_video_initial_processing.py`

**✅ Good Tests:**
```python
@pytest.mark.asyncio
async def test_flow_success(self, mock_services):
    """Test successful flow execution."""
    result = await video_initial_processing(...)

    # ✅ Tests our flow logic directly
    # ✅ Verifies we call services in correct order
    # ✅ Checks our status update logic
```

**Analysis:** These tests call our flow functions directly (not via Prefect), mock external services, and verify our business logic. This is correct.

**Verdict:** ✅ Keep these tests

---

#### API Endpoint Tests ✅ ALL GOOD

**File:** `test_webhooks.py`

All webhook tests correctly test our implementation:
- `test_webhook_auth_*` - Tests our authentication logic ✅
- `test_webhook_invalid_payload` - Tests our validation logic ✅
- `test_webhook_success` - Tests we construct Prefect API call correctly ✅

**Key characteristic:** Mocks Prefect API response, verifies we call it with correct parameters.

**Verdict:** ✅ Keep these tests

---

### Level 3: E2E Integration Tests ⚠️ NEEDS CLARIFICATION

#### Video Processing Flow

**File:** `test_video_processing_flow.py`

```python
@pytest.mark.asyncio
async def test_full_video_processing_flow(self, test_video):
    """Test complete flow from video INSERT to processed state."""

    # 1. Insert video record (triggers webhook)
    # 2. Wait for flow to complete (poll for status)  # ⚠️ CONCERN
    # 3. Verify results
```

**Analysis:**
- **⚠️ Borderline:** This waits for Prefect to schedule and execute the flow
- **Purpose:** Validates end-to-end integration works
- **What it tests:**
  - ✅ Our webhook triggers Prefect correctly
  - ✅ Our flow logic produces correct results
  - ❌ That Prefect schedules and runs the flow (Prefect's job)

**Recommendation:**
```python
# REVISED: Focus on integration, not Prefect scheduling
@pytest.mark.e2e
async def test_full_video_processing_flow(self, test_video):
    """Test complete integration of all services."""

    # 1. Trigger flow via webhook (tests our webhook handler)
    response = trigger_webhook(test_video)
    assert response["success"] is True
    flow_run_id = response["flow_run_id"]

    # 2. Execute flow directly (bypass Prefect scheduling)
    #    This tests our flow logic, not Prefect
    result = await video_initial_processing(
        video_id=test_video["video_id"],
        tenant_id=test_video["tenant_id"],
        storage_key=test_video["storage_key"]
    )

    # 3. Verify results in Supabase and Wasabi
    assert result["status"] == "success"
    # ... verify files exist, status updated, etc.
```

**Verdict:** ⚠️ Refactor to execute flow directly, not wait for Prefect scheduling

---

### Level 4: Load and Performance Tests ❌ MAJOR ISSUES

#### Concurrent Flow Execution

**File:** `test_concurrent_flows.py`

**❌ REMOVE: test_worker_throughput**
```python
async def test_worker_throughput(self):
    """Test worker can process flows at expected rate."""
    # Queue 50 flows
    # Measure time to complete all
    # Verify throughput meets requirements (e.g., 10 flows/minute)
```

**Issue:** This tests Prefect worker performance, not our code.

**What we should test instead:**
```python
async def test_webhook_handler_throughput(self):
    """Test webhook handler can accept requests at expected rate."""
    # Send 50 webhook requests concurrently
    # Measure response time
    # Verify all return 202 (accepted)
    # Verify all create flow runs via Prefect API

    # ✅ Tests our webhook handler performance
    # ✅ Tests we can call Prefect API quickly
    # ❌ Does NOT test Prefect execution speed
```

---

**❌ REMOVE: test_priority_queue_ordering**
```python
async def test_priority_queue_ordering(self):
    """Test priority queue processes high-priority flows first."""
    # Queue 10 free tier flows (priority 50)
    # Queue 1 enterprise flow (priority 90)
    # Verify enterprise flow completes before free flows
```

**Issue:** This tests Prefect's priority queue implementation, not our code.

**What we should test instead:**
```python
async def test_priority_calculation_and_tagging(self):
    """Test we calculate and apply priority correctly."""
    # Trigger flows with different tiers and ages
    # Verify each gets correct priority value
    # Verify priority tags are applied to flow run

    # Mock Prefect API, capture the request
    # Verify request includes correct priority value

    # ✅ Tests our priority calculation
    # ✅ Tests we send correct priority to Prefect
    # ❌ Does NOT test Prefect honors the priority
```

---

**✅ KEEP: test_10_concurrent_webhooks**
```python
async def test_10_concurrent_webhooks(self):
    """Test system handles 10 concurrent webhook requests."""
    results = await asyncio.gather(*[
        trigger_webhook(i) for i in range(10)
    ])

    assert all(r["status_code"] == 202 for r in results)
    assert avg_duration < 1.0  # Average under 1 second
```

**Analysis:** This tests our webhook handler's concurrency, not Prefect. ✅ Good test.

---

#### Resource Usage Monitoring

**File:** `test_resource_usage.py`

**❌ REMOVE: test_prefect_worker_health**
```python
async def test_prefect_worker_health(self):
    """Monitor Prefect worker health during load."""
    # Check worker process is responsive
    # Verify worker doesn't crash under load
    # Monitor worker memory usage
```

**Issue:** This tests Prefect worker stability, not our code.

**What we should test instead:**
```python
async def test_worker_manager_handles_worker_crash(self):
    """Test our worker manager handles worker process crashes."""

    # Kill the worker subprocess
    worker_manager.worker_process.kill()

    # Verify our manager detects the crash
    # Verify appropriate logging occurs
    # Verify API continues to function

    # ✅ Tests our worker manager logic
    # ✅ Tests our error handling
    # ❌ Does NOT test Prefect worker stability
```

---

**✅ KEEP: test_memory_usage_under_load**
```python
async def test_memory_usage_under_load(self):
    """Verify memory usage stays within limits."""
    baseline_memory = process.memory_info().rss
    # Run load test
    peak_memory = process.memory_info().rss
    assert memory_increase < 500  # MB
```

**Analysis:** This tests our application's memory management. ✅ Good test.

---

### Level 5: Error Handling Tests ⚠️ MIXED

#### Modal Function Failures ✅ GOOD

**File:** `test_modal_failures.py`

All tests focus on our error handling:
- `test_modal_timeout_retry` - Tests our retry logic ✅
- `test_modal_gpu_unavailable` - Tests our error handling ✅
- `test_partial_frame_extraction_failure` - Tests our failure handling ✅

**Verdict:** ✅ Keep these tests

---

#### Lock Contention ✅ GOOD

**File:** `test_lock_contention.py`

All tests focus on our lock implementation:
- `test_concurrent_lock_acquisition` - Tests our lock logic ✅
- `test_lock_timeout_and_retry` - Tests our retry logic ✅
- `test_stale_lock_cleanup` - Tests our cleanup logic ✅

**Verdict:** ✅ Keep these tests

---

## Revised Test Statistics

### Original Plan
- **Total test cases:** ~45
- **Testing our code:** ~38 (84%)
- **Testing Prefect:** ~7 (16%)

### After Corrections
- **Tests to keep:** ~40 (89%)
- **Tests to remove:** 3 (7%)
- **Tests to refactor:** 2 (4%)

---

## Action Items

### 1. Remove These Tests ❌

```python
# In test_concurrent_flows.py
- test_worker_throughput()          # Tests Prefect worker
- test_priority_queue_ordering()    # Tests Prefect queue

# In test_resource_usage.py
- test_prefect_worker_health()      # Tests Prefect worker
```

### 2. Replace With These Tests ✅

```python
# In test_concurrent_flows.py

@pytest.mark.load
class TestWebhookHandlerPerformance:
    """Test our webhook handler performance, not Prefect."""

    @pytest.mark.asyncio
    async def test_webhook_handler_throughput(self):
        """Test webhook handler processes requests quickly."""
        start = datetime.now()

        # Send 50 concurrent requests
        results = await asyncio.gather(*[
            trigger_webhook(i) for i in range(50)
        ])

        duration = (datetime.now() - start).total_seconds()

        # All should succeed
        assert all(r["status_code"] == 202 for r in results)

        # Should complete quickly (< 5 seconds for 50 requests)
        assert duration < 5.0

        # Each should have called Prefect API
        assert all("flow_run_id" in r for r in results)

    @pytest.mark.asyncio
    async def test_priority_calculation_under_load(self):
        """Test priority calculation remains correct under load."""
        # Trigger flows with different tiers concurrently
        free_tier_requests = [
            trigger_webhook(i, tier="free") for i in range(10)
        ]
        enterprise_requests = [
            trigger_webhook(i, tier="enterprise") for i in range(2)
        ]

        results = await asyncio.gather(
            *free_tier_requests,
            *enterprise_requests
        )

        # Verify priorities were calculated correctly
        free_results = results[:10]
        enterprise_results = results[10:]

        # All free tier should have priority 50-70 (with age boost)
        for r in free_results:
            assert 50 <= r["priority"] <= 70

        # All enterprise should have priority 90-110 (with age boost)
        for r in enterprise_results:
            assert 90 <= r["priority"] <= 110


# In test_resource_usage.py

@pytest.mark.load
class TestWorkerManagerResilience:
    """Test our worker manager, not Prefect worker."""

    @pytest.mark.asyncio
    async def test_api_continues_if_worker_fails_to_start(self):
        """Test API starts even if worker fails."""
        # Mock Prefect server unreachable
        with patch('prefect.client.orchestration.get_client') as mock_client:
            mock_client.side_effect = Exception("Connection refused")

            # Start API
            # Should succeed despite worker failure
            # Verify API endpoints still work
            response = client.get("/health")
            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_worker_manager_logs_worker_output(self):
        """Test our worker manager captures worker logs."""
        # Start worker manager
        # Verify logs show worker output
        # This tests our _monitor_worker_output() logic
        pass
```

### 3. Refactor These Tests ⚠️

```python
# In test_video_processing_flow.py

# BEFORE (waits for Prefect to schedule):
@pytest.mark.e2e
async def test_full_video_processing_flow(self, test_video):
    # Insert video record
    # Wait for Prefect to schedule and execute  # ❌ Testing Prefect
    # Check results

# AFTER (executes flow directly):
@pytest.mark.e2e
async def test_full_video_processing_integration(self, test_video):
    """Test complete integration with all real services."""

    # 1. Test webhook trigger
    response = client.post("/webhooks/supabase/videos", ...)
    assert response.status_code == 202
    flow_run_id = response.json()["flow_run_id"]

    # 2. Execute flow directly (bypass Prefect scheduling)
    #    This tests our flow logic with real Modal/Supabase/Wasabi
    result = await video_initial_processing(
        video_id=test_video["video_id"],
        tenant_id=test_video["tenant_id"],
        storage_key=test_video["storage_key"]
    )

    # 3. Verify results
    assert result["status"] == "success"

    # Verify in Supabase
    video = supabase.get_video_metadata(test_video["video_id"])
    assert video["status"] == "active"
    assert video["frame_count"] > 0

    # Verify in Wasabi
    assert wasabi.file_exists(f"{tenant_id}/server/videos/{video_id}/layout.db.gz")
```

---

## Revised Test Coverage

### Unit Tests (50%)
- ✅ Priority calculation logic
- ✅ Service method implementations
- ✅ Data validation and transformations
- ✅ Error handling paths

### Integration Tests (35%)
- ✅ Flow orchestration logic (direct calls)
- ✅ API endpoint behavior (mocked Prefect)
- ✅ Service integration (mocked external services)
- ✅ Webhook authentication and validation

### E2E Tests (10%)
- ✅ Complete integration (direct flow execution)
- ✅ Real Modal/Supabase/Wasabi interaction
- ✅ End-to-end data flow
- ❌ No waiting for Prefect scheduling

### Load Tests (5%)
- ✅ Webhook handler performance
- ✅ Priority calculation under load
- ✅ Concurrent request handling
- ✅ Our application's resource usage
- ❌ No Prefect worker performance tests

---

## Testing Philosophy

### The Boundary Principle

**We control:** Our code
**We don't control:** External services (Prefect, Modal, Supabase, Wasabi)

**Test Strategy:**
1. **Unit tests:** Test our logic in isolation (mock everything external)
2. **Integration tests:** Test we integrate correctly (mock responses, verify calls)
3. **E2E tests:** Test complete workflows work (use real services, but execute directly)
4. **Don't test:** That external services work as documented

### Example: Testing Prefect Integration

```python
# ❌ BAD: Testing Prefect's priority queue
def test_prefect_honors_priority():
    # Queue low priority flow
    # Queue high priority flow
    # Wait for Prefect to schedule both
    # Assert high priority ran first
    # ^ This tests Prefect, not our code

# ✅ GOOD: Testing we set priority correctly
def test_we_set_priority_correctly():
    with patch('httpx.AsyncClient') as mock_client:
        trigger_webhook(tier="enterprise", age_minutes=120)

        # Verify we calculated priority correctly
        call_args = mock_client.post.call_args
        assert call_args["json"]["priority"] == 92  # 90 + 2 age boost

        # ^ This tests our code, trusts Prefect to honor it
```

---

## Summary

**Original Test Plan:**
- Good foundation with 84% of tests correctly scoped
- 16% inadvertently tested Prefect functionality

**Revised Test Plan:**
- 89% focus on our implementation (improved)
- 0% test Prefect functionality (fixed)
- Added tests for our worker manager resilience
- Refactored E2E tests to execute flows directly

**Key Changes:**
1. ❌ Removed 3 tests that tested Prefect
2. ✅ Added 3 tests for our infrastructure code
3. ⚠️ Refactored 2 E2E tests to bypass Prefect scheduling

**Result:** All tests now meaningfully validate our implementation rather than testing Prefect's documented behavior.
