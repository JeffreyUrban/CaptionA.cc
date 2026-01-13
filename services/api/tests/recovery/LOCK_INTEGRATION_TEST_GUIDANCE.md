# Lock Contention Integration Test Guidance

**Date:** 2026-01-12
**Status:** Documentation for Future Implementation

---

## Overview

This document describes lock contention scenarios that require integration testing with a real Supabase database. These scenarios involve complex state transitions and fluent interface interactions that are difficult to mock accurately at the unit test level.

---

## Scenarios Requiring Integration Testing

### 1. Lock Timeout and Retry

**Test Coverage Goal:** Verify that when a lock is held by one process and released, another waiting process can successfully acquire it.

**Scenario:**
1. Process A acquires lock on `video-123` for `layout` database
2. Process B attempts to acquire same lock (should fail with `False`)
3. Process A releases the lock
4. Process B retries and successfully acquires lock (should succeed with `True`)

**Integration Test Approach:**

```python
@pytest.mark.integration
async def test_lock_timeout_and_retry_integration():
    """Integration test: Lock retry after release."""
    # Use real Supabase connection
    supabase_service = SupabaseServiceImpl(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        schema="test_schema"
    )

    # Setup: Create test video in database
    test_video_id = f"test-video-{uuid.uuid4()}"
    # ... insert test video ...

    try:
        # Process A acquires lock
        result_a = supabase_service.acquire_server_lock(
            video_id=test_video_id,
            database_name="layout",
            lock_holder_user_id="process-a"
        )
        assert result_a is True

        # Process B attempts (should fail)
        result_b_attempt1 = supabase_service.acquire_server_lock(
            video_id=test_video_id,
            database_name="layout",
            lock_holder_user_id="process-b"
        )
        assert result_b_attempt1 is False

        # Process A releases
        supabase_service.release_server_lock(
            video_id=test_video_id,
            database_name="layout"
        )

        # Process B retries (should succeed)
        result_b_attempt2 = supabase_service.acquire_server_lock(
            video_id=test_video_id,
            database_name="layout",
            lock_holder_user_id="process-b"
        )
        assert result_b_attempt2 is True

    finally:
        # Cleanup: Delete test video and state
        # ... cleanup code ...
```

**Key Validations:**
- Lock state transitions correctly in database
- Second process can acquire after first releases
- No orphaned lock state
- Proper timestamp updates

---

### 2. Lock Release Idempotence

**Test Coverage Goal:** Verify that releasing a lock multiple times is safe and doesn't cause errors or inconsistent state.

**Scenario:**
1. Process acquires lock on `video-123` for `layout` database
2. Process releases lock (first release)
3. Process releases lock again (second release, should be idempotent)
4. No error occurs, database state remains consistent

**Integration Test Approach:**

```python
@pytest.mark.integration
def test_lock_release_idempotent_integration():
    """Integration test: Multiple lock releases are safe."""
    supabase_service = SupabaseServiceImpl(...)

    test_video_id = f"test-video-{uuid.uuid4()}"
    # ... setup test video ...

    try:
        # Acquire lock
        result = supabase_service.acquire_server_lock(
            video_id=test_video_id,
            database_name="layout",
            lock_holder_user_id="process-1"
        )
        assert result is True

        # First release
        supabase_service.release_server_lock(
            video_id=test_video_id,
            database_name="layout"
        )

        # Second release (should not error)
        supabase_service.release_server_lock(
            video_id=test_video_id,
            database_name="layout"
        )

        # Verify state is correct (lock_holder_user_id is NULL)
        state = get_lock_state(supabase_service, test_video_id, "layout")
        assert state["lock_holder_user_id"] is None
        assert state["lock_type"] is None

    finally:
        # ... cleanup ...
```

**Key Validations:**
- No exception on second release
- Database state is consistent (NULL values)
- No duplicate or conflicting records
- Proper for use in `finally` blocks

**Why Integration Test:**
This ensures the idempotent behavior works correctly with real database constraints and UPDATE operations, which is critical for production reliability in error scenarios.

---

### 3. Sequential Lock Acquisition by Same Holder

**Test Coverage Goal:** Verify that a process can acquire a lock, release it, and then re-acquire the same lock.

**Scenario:**
1. Process A acquires lock on `video-123` for `layout` database
2. Process A releases the lock
3. Process A re-acquires the same lock (should succeed)

**Integration Test Approach:**

```python
@pytest.mark.integration
def test_sequential_lock_acquisition_same_holder_integration():
    """Integration test: Same process can re-acquire lock after release."""
    supabase_service = SupabaseServiceImpl(...)

    test_video_id = f"test-video-{uuid.uuid4()}"
    # ... setup test video ...

    try:
        # First acquisition
        result1 = supabase_service.acquire_server_lock(
            video_id=test_video_id,
            database_name="layout",
            lock_holder_user_id="process-a"
        )
        assert result1 is True

        # Release
        supabase_service.release_server_lock(
            video_id=test_video_id,
            database_name="layout"
        )

        # Re-acquisition by same holder
        result2 = supabase_service.acquire_server_lock(
            video_id=test_video_id,
            database_name="layout",
            lock_holder_user_id="process-a"
        )
        assert result2 is True

        # Verify state is correct
        state = get_lock_state(supabase_service, test_video_id, "layout")
        assert state["lock_holder_user_id"] == "process-a"
        assert state["lock_type"] == "server"

    finally:
        # ... cleanup ...
```

**Key Validations:**
- INSERT vs UPDATE logic works correctly
- Timestamps are updated properly
- No deadlock or state corruption
- Works across multiple lock/release cycles

**Why Integration Test:**
This tests the full lifecycle with real database state transitions, ensuring the INSERT-or-UPDATE logic works correctly with database constraints.

---

## Implementation Recommendations

### Test Infrastructure Setup

1. **Test Database Schema:**
   ```sql
   -- Create test schema separate from production
   CREATE SCHEMA IF NOT EXISTS test_lock_contention;

   -- Create required tables in test schema
   CREATE TABLE test_lock_contention.videos (
       id UUID PRIMARY KEY,
       tenant_id UUID NOT NULL,
       storage_key TEXT NOT NULL,
       status TEXT NOT NULL,
       created_at TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE TABLE test_lock_contention.video_database_state (
       video_id UUID NOT NULL,
       database_name TEXT NOT NULL,
       tenant_id UUID NOT NULL,
       server_version INTEGER DEFAULT 0,
       wasabi_version INTEGER DEFAULT 0,
       wasabi_synced_at TIMESTAMPTZ,
       lock_holder_user_id TEXT,
       lock_type TEXT,
       locked_at TIMESTAMPTZ,
       last_activity_at TIMESTAMPTZ,
       PRIMARY KEY (video_id, database_name)
   );
   ```

2. **Pytest Configuration:**
   ```python
   # conftest.py
   @pytest.fixture(scope="session")
   def integration_supabase_service():
       """Provide Supabase service for integration tests."""
       if not os.getenv("SUPABASE_TEST_URL"):
           pytest.skip("Integration tests require SUPABASE_TEST_URL")

       return SupabaseServiceImpl(
           supabase_url=os.environ["SUPABASE_TEST_URL"],
           supabase_key=os.environ["SUPABASE_TEST_SERVICE_KEY"],
           schema="test_lock_contention"
       )

   @pytest.fixture
   def test_video_id(integration_supabase_service):
       """Create and cleanup test video."""
       video_id = str(uuid.uuid4())
       tenant_id = str(uuid.uuid4())

       # Insert test video
       integration_supabase_service.client.schema("test_lock_contention") \
           .table("videos").insert({
               "id": video_id,
               "tenant_id": tenant_id,
               "storage_key": f"{tenant_id}/videos/{video_id}.mp4",
               "status": "uploading"
           }).execute()

       yield video_id

       # Cleanup
       integration_supabase_service.client.schema("test_lock_contention") \
           .table("video_database_state") \
           .delete().eq("video_id", video_id).execute()
       integration_supabase_service.client.schema("test_lock_contention") \
           .table("videos") \
           .delete().eq("id", video_id).execute()
   ```

3. **Helper Functions:**
   ```python
   def get_lock_state(service, video_id, database_name):
       """Query current lock state from database."""
       response = service.client.schema(service.schema) \
           .table("video_database_state") \
           .select("*") \
           .eq("video_id", video_id) \
           .eq("database_name", database_name) \
           .maybe_single() \
           .execute()
       return response.data
   ```

### CI/CD Integration

```yaml
# .github/workflows/integration-tests.yml
name: Integration Tests

on:
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2 AM

jobs:
  integration-tests:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: supabase/postgres:15.1.0.117
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install -r requirements-test.txt

      - name: Run integration tests
        env:
          SUPABASE_TEST_URL: http://localhost:54321
          SUPABASE_TEST_SERVICE_KEY: ${{ secrets.SUPABASE_TEST_KEY }}
        run: pytest services/api/tests/integration/locks/ -v -m integration
```

---

## Test Organization

### Directory Structure

```
services/api/tests/
├── recovery/                          # Unit tests with mocks
│   ├── test_modal_failures.py        # ✅ 12/12 passing
│   ├── test_network_failures.py      # ✅ 9/9 passing
│   └── test_lock_contention.py       # ✅ 4/4 passing (core behavior)
│
└── integration/                       # Integration tests with real services
    └── locks/
        ├── conftest.py                # Fixtures for integration tests
        ├── test_lock_lifecycle.py     # Lock timeout and retry
        ├── test_lock_idempotence.py   # Lock release idempotence
        └── test_lock_reacquisition.py # Sequential acquisition
```

---

## Validation Criteria

### Lock Timeout and Retry
- ✅ Lock prevents concurrent access
- ✅ Released lock can be acquired by another process
- ✅ State transitions are atomic
- ✅ Timestamps reflect actual activity

### Lock Release Idempotence
- ✅ No errors on multiple releases
- ✅ Database state is consistent
- ✅ NULL values set correctly
- ✅ Safe for use in exception handlers

### Sequential Acquisition
- ✅ Same process can re-acquire after release
- ✅ INSERT vs UPDATE logic handles both scenarios
- ✅ Timestamps are updated on re-acquisition
- ✅ No orphaned or duplicate records

---

## Benefits of Integration Testing

1. **Real Database Constraints:** Tests actual PostgreSQL behavior, constraints, and transactions
2. **Fluent Interface:** No complex mocking of Supabase's query builder
3. **Race Conditions:** Can test with actual concurrent processes
4. **State Verification:** Direct database queries validate state
5. **Production Confidence:** Tests actual code paths used in production

---

## Migration Path

### Phase 1: Setup Infrastructure (Week 1)
- Create test database schema
- Setup CI/CD pipeline with test database
- Implement helper functions and fixtures

### Phase 2: Implement Tests (Week 2)
- Implement lock timeout and retry test
- Implement lock release idempotence test
- Implement sequential acquisition test

### Phase 3: Validation (Week 3)
- Run tests in CI/CD
- Verify test isolation and cleanup
- Document test execution and results

---

## Conclusion

These three scenarios require integration testing because they involve:
- Complex fluent interface interactions with Supabase
- Real database state transitions (INSERT vs UPDATE logic)
- Atomic operations and database constraints
- Multiple sequential operations with state verification

Unit tests with mocks successfully validate the core lock contention behavior (concurrent access, lock independence, graceful failures). Integration tests will validate the complete lifecycle with real database interactions.

**Current Coverage:** Core lock behavior validated with unit tests (4/4 passing)
**Future Coverage:** Lifecycle and state transitions with integration tests (3 scenarios)
**Total Coverage:** Comprehensive lock contention testing across both levels
