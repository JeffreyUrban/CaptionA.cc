# Database Administration Roadmap

## Phase 1: Basic Observability ✅ COMPLETE

**Status:** Implemented

**Features:**

- ✅ View version distribution across all databases
- ✅ Health summary (current, outdated, incomplete, unversioned counts)
- ✅ List all databases with filtering (by version, status, search)
- ✅ Inspect individual database schema
- ✅ Basic synchronous scanning (acceptable during development)

**Endpoints:**

- `GET /api/admin/databases/status` - Summary statistics
- `GET /api/admin/databases/list` - Detailed list with filters
- `GET /api/admin/databases/:videoId/schema` - Schema inspection

**UI:**

- `/admin/databases` - Dashboard with summary cards, filters, and database table

**Implementation:**

- Service: `app/services/database-admin-service.ts`
- Routes: `app/routes/api.admin.databases.*`
- UI: `app/routes/admin.databases.tsx`

**Limitations:**

- Synchronous scanning (2-3 second load time with 374 databases)
- No repair controls in UI
- No job progress tracking
- No caching

---

## Phase 2: Background Jobs & Repair Controls

**Status:** Planned

**Goal:** Move long-running operations (scan, repair) to background jobs with progress tracking.

### 2.1 Background Job Infrastructure

**Create:** `app/services/background-jobs.ts`

```typescript
interface Job {
  id: string
  type: 'scan' | 'repair' | 'repair-single'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: {
    total: number
    processed: number
    current: number
    repaired: number
    failed: number
  }
  result?: unknown
  error?: string
  startedAt: string
  completedAt?: string
}

// Job storage (simple in-memory, or persist to database_metadata)
const jobs = new Map<string, Job>()

export function createJob(type: Job['type']): string
export function getJob(jobId: string): Job | undefined
export function updateJobProgress(jobId: string, progress: Partial<Job['progress']>): void
export function completeJob(jobId: string, result?: unknown): void
export function failJob(jobId: string, error: string): void
export function cancelJob(jobId: string): void
```

### 2.2 Background Scan

**Endpoint:** `POST /api/admin/databases/scan`

```typescript
// Trigger background scan
export async function action() {
  const jobId = createJob('scan')

  // Run in background (don't await)
  runScanJob(jobId).catch(err => failJob(jobId, err.message))

  return { jobId, status: 'started' }
}

async function runScanJob(jobId: string) {
  const databases = findAllDatabases()
  updateJobProgress(jobId, { total: databases.length })

  for (const dbPath of databases) {
    const info = getDatabaseInfo(dbPath)
    // ... collect results
    updateJobProgress(jobId, { processed: i + 1, ... })
  }

  completeJob(jobId, { summary, databases })
}
```

### 2.3 Background Repair

**Endpoints:**

- `POST /api/admin/databases/repair` - Repair all databases
- `POST /api/admin/databases/:videoId/repair` - Repair single database

```typescript
export async function action() {
  const jobId = createJob('repair')
  runRepairJob(jobId).catch(err => failJob(jobId, err.message))
  return { jobId }
}

async function runRepairJob(jobId: string) {
  const databases = findAllDatabases()
  updateJobProgress(jobId, { total: databases.length })

  for (const dbPath of databases) {
    try {
      const result = repairDatabase(dbPath, schemaSQL)
      if (result.status === 'repaired') {
        updateJobProgress(jobId, { repaired: progress.repaired + 1 })
      }
    } catch {
      updateJobProgress(jobId, { failed: progress.failed + 1 })
    }
    updateJobProgress(jobId, { processed: progress.processed + 1 })
  }

  completeJob(jobId)
}
```

### 2.4 Job Status Endpoint

**Endpoint:** `GET /api/admin/jobs/:jobId`

```typescript
export async function loader({ params }: LoaderFunctionArgs) {
  const { jobId } = params
  const job = getJob(jobId)

  if (!job) {
    return { error: 'Job not found' }
  }

  return job
}
```

### 2.5 UI Updates

**Add to admin dashboard:**

```tsx
// Scan button triggers job
async function handleScan() {
  const response = await fetch('/api/admin/databases/scan', { method: 'POST' })
  const { jobId } = await response.json()

  // Poll for progress
  pollJobStatus(jobId)
}

// Repair button triggers job
async function handleRepairAll() {
  if (!confirm('Repair all databases?')) return

  const response = await fetch('/api/admin/databases/repair', { method: 'POST' })
  const { jobId } = await response.json()

  pollJobStatus(jobId)
}

// Job progress modal
function JobProgressModal({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null)

  useEffect(() => {
    const interval = setInterval(async () => {
      const response = await fetch(`/api/admin/jobs/${jobId}`)
      const data = await response.json()
      setJob(data)

      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(interval)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [jobId])

  return (
    <div>
      <h3>Scanning databases...</h3>
      <progress value={job?.progress.processed} max={job?.progress.total} />
      <div>
        {job?.progress.processed}/{job?.progress.total}
      </div>
    </div>
  )
}
```

**Implementation checklist:**

- [ ] Create background job service
- [ ] Add scan endpoint
- [ ] Add repair endpoints (all + single)
- [ ] Add job status endpoint
- [ ] Add UI controls (Scan, Repair buttons)
- [ ] Add job progress modal
- [ ] Handle job cancellation
- [ ] Persist jobs (optional: survive server restart)

---

## Phase 3: Caching & Performance

**Status:** Planned

**Goal:** Instant page loads via caching, with background refresh.

### 3.1 Cache Storage

**Options:**

**Option A: File-based cache** (simplest, good for development)

```typescript
// app/services/admin-cache.ts
const CACHE_FILE = 'admin-cache.json'
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

interface CachedStatus {
  summary: StatusSummary
  databases: DatabaseInfo[]
  timestamp: string
}

export function getCachedStatus(): CachedStatus | null {
  if (!existsSync(CACHE_FILE)) return null

  const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))

  // Check if recent
  if (Date.now() - new Date(cached.timestamp).getTime() > CACHE_TTL) {
    return null
  }

  return cached
}

export function updateCache(status: CachedStatus) {
  writeFileSync(
    CACHE_FILE,
    JSON.stringify({
      ...status,
      timestamp: new Date().toISOString(),
    })
  )
}
```

**Option B: Database cache table** (more structured, easier to query)

```sql
CREATE TABLE admin_cache (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  summary_json TEXT NOT NULL,
  databases_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Option C: Redis** (best for production, if available)

```typescript
await redis.set('admin:database-status', JSON.stringify(status), 'EX', 300)
```

### 3.2 Cache-First Strategy

**Update status endpoint:**

```typescript
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const forceRefresh = url.searchParams.get('refresh') === 'true'

  // Check cache first
  if (!forceRefresh) {
    const cached = getCachedStatus()
    if (cached) {
      return { ...cached, source: 'cached' }
    }
  }

  // Cache miss or forced refresh - trigger background scan
  const jobId = createJob('scan')
  runScanAndCache(jobId).catch(console.error)

  return {
    status: 'scanning',
    jobId,
    message: 'Scan started, check job status for results',
  }
}

async function runScanAndCache(jobId: string) {
  const result = await runScanJob(jobId)
  updateCache({
    summary: result.summary,
    databases: result.databases,
    timestamp: new Date().toISOString(),
  })
}
```

### 3.3 Background Refresh

**Auto-refresh cache periodically:**

```typescript
// app/services/cache-refresher.ts
let refreshInterval: NodeJS.Timeout | null = null

export function startCacheRefresh(intervalMs = 5 * 60 * 1000) {
  if (refreshInterval) return // Already running

  refreshInterval = setInterval(() => {
    const jobId = createJob('scan')
    runScanAndCache(jobId).catch(console.error)
  }, intervalMs)
}

export function stopCacheRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
}

// Start on server boot
// In app entry point or route loader
startCacheRefresh()
```

### 3.4 UI Updates

**Show cache freshness:**

```tsx
{
  summary && (
    <div>
      <p>Last updated: {new Date(summary.timestamp).toLocaleString()}</p>
      {summary.source === 'cached' && (
        <p style={{ color: '#666', fontSize: '0.875rem' }}>
          (Cached data, <a href="?refresh=true">force refresh</a>)
        </p>
      )}
    </div>
  )
}
```

**Implementation checklist:**

- [ ] Choose cache storage (file, DB, or Redis)
- [ ] Implement cache read/write
- [ ] Update endpoints to check cache first
- [ ] Update scan job to write to cache
- [ ] Add background refresh service
- [ ] Add cache invalidation on repair
- [ ] Show cache age in UI
- [ ] Add manual refresh control

---

## Phase 4: Advanced Features (Future)

**Status:** Ideas for future consideration

### 4.1 Version Migration Controls

- UI to trigger migration to specific version
- Migration dry-run (show what would change)
- Rollback capability (if migration fails)

### 4.2 Batch Operations

- Repair selected databases (not all)
- Migrate selected databases to specific version
- Export/import database lists

### 4.3 Health Monitoring

- Alert when databases drift from expected schema
- Track repair history over time
- Identify frequently failing databases

### 4.4 Schema Comparison

- Visual diff between database schema and expected schema
- Show missing/extra columns with details
- Compare two database schemas

### 4.5 Metrics & Analytics

- Database size distribution
- Repair success rate over time
- Version migration timeline
- Performance metrics (scan/repair duration)

---

## Implementation Priority

**For development (current):**

1. ✅ Phase 1 (complete) - Basic observability is sufficient
2. Phase 2 - Add when repair operations become frequent
3. Phase 3 - Add when 374+ databases make load time unacceptable

**For production:**

1. Phase 2 (required) - Can't block requests on long scans
2. Phase 3 (required) - Instant page loads expected
3. Phase 4 (nice-to-have) - Based on operational needs

**Triggers for implementing Phase 2:**

- Repair operations happen daily
- Need to repair from admin UI (not just scripts)
- Multiple admins need visibility into repair status

**Triggers for implementing Phase 3:**

- Database count > 500 (scan takes > 5 seconds)
- Admin page accessed frequently
- Cache hit rate would be high (same data viewed repeatedly)
