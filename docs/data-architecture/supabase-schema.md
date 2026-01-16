# Supabase Schema Reference

Supabase (PostgreSQL) serves as the metadata layer for CaptionA.cc, providing multi-tenant access control, queryable video catalog, and operational state management.

## Configuration

| Property | Value |
|----------|-------|
| Postgres Version | 17 |
| Primary Schema | `captionacc_production` |
| Staging Schema | `captionacc_staging` |
| RLS | Enabled (production schema) |

### Environment Variables

```bash
SUPABASE_URL=https://your-project.supabase.co  # or http://localhost:54321
SUPABASE_SCHEMA=captionacc_production          # or captionacc_staging
SUPABASE_ANON_KEY=<public_key>                 # RLS-enforced access
SUPABASE_SERVICE_ROLE_KEY=<service_key>        # Bypasses RLS (backend only)

# Web app (Vite)
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_SUPABASE_SCHEMA=...
```

## Schema Organization

| Schema | Purpose | RLS |
|--------|---------|-----|
| `captionacc_production` | Main production environment | Yes |
| `captionacc_staging` | Testing/review apps | No |
| `prefect` | Prefect Server database | N/A |
| `umami` | Analytics database | N/A |
| `public` | Standard Postgres schema | N/A | <- Not allowed to be used in this project. 

---

## Tables

### Core Tables

#### `tenants`

Multi-tenant workspace isolation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Tenant identifier |
| `name` | TEXT NOT NULL | Display name |
| `slug` | TEXT UNIQUE | URL-safe identifier |
| `storage_quota_gb` | INTEGER | Storage limit |
| `daily_upload_limit` | INTEGER | Uploads per day |
| `video_count_limit` | INTEGER | Max videos |
| `processing_minutes_limit` | INTEGER | Processing quota |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

#### `user_profiles`

Extended user metadata (extends `auth.users`).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK FK | References `auth.users` |
| `tenant_id` | UUID FK | User's tenant |
| `full_name` | TEXT | Display name |
| `avatar_url` | TEXT | Profile image |
| `role` | TEXT | 'owner' or 'member' |
| `approval_status` | TEXT | 'pending', 'approved', 'rejected' |
| `access_tier_id` | TEXT FK | References `access_tiers` |
| `invite_code_used` | TEXT FK | Code used at signup |
| `approved_at` | TIMESTAMPTZ | Approval timestamp |
| `approved_by` | UUID FK | Admin who approved |

#### `videos`

Video catalog with multi-tenant isolation. (added width, height)

| Column | Type | Description                                  |
|--------|------|----------------------------------------------|
| `id` | UUID PK | Video identifier                             |
| `tenant_id` | UUID FK | Owner tenant                                 |
| `display_path` | TEXT NOT NULL | User-facing path for organization            |
| `size_bytes` | BIGINT | File size                                    |
| `duration_seconds` | REAL | Video duration                               |
| `width` | INTEGER NOT NULL | Width                                        |
| `height` | INTEGER NOT NULL | Height                                       |
| `status` | TEXT | 'processing', 'active', 'error'              |
| `uploaded_by_user_id` | UUID FK | Uploader                                     |
| `uploaded_at` | TIMESTAMPTZ | Upload timestamp                             |
| `locked_by_user_id` | UUID FK | Current editor (locking)                     |
| `locked_at` | TIMESTAMPTZ | Lock timestamp                               |
| `annotations_db_key` | TEXT | captions.db storage key                      |
| `prefect_flow_run_id` | TEXT | Processing flow ID                           |
| `is_demo` | BOOLEAN | Shared demo video flag                       |
| `deleted_at` | TIMESTAMPTZ | Soft delete timestamp                        |

**Note:** `storage_key` is computed as `{tenant_id}/client/videos/{id}/video.mp4` and not stored in the database.
| `current_cropped_frames_version` | INTEGER | Active frames version                        |

#### `cropped_frames_versions`

Frame extraction versioning for cache invalidation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Version identifier |
| `video_id` | UUID FK | Parent video |
| `version` | INTEGER NOT NULL | Version number |
| `storage_prefix` | TEXT | Wasabi prefix for chunks |
| `crop_region` | JSONB | `{left, top, right, bottom}` |
| `frame_rate` | REAL | Extraction frame rate |
| `chunk_count` | INTEGER | Number of WebM chunks |
| `total_frames` | INTEGER | Total frames extracted |
| `total_size_bytes` | BIGINT | Total storage size |
| `status` | TEXT | 'processing', 'active', 'archived', 'failed' |
| `layout_db_storage_key` | TEXT | layout.db key used |
| `layout_db_hash` | TEXT | Hash for deduplication |
| `prefect_flow_run_id` | TEXT | Processing flow ID |
| `activated_at` | TIMESTAMPTZ | When version became active |
| `archived_at` | TIMESTAMPTZ | When version was archived |
| `created_by_user_id` | UUID FK | Creator |

#### `video_database_state`

Tracks versioning, working copies, and locks for per-video SQLite databases (layout.db, captions.db). Used by CR-SQLite sync system.

| Column | Type | Description |
|--------|------|-------------|
| `video_id` | UUID PK FK | References `videos` |
| `database_name` | TEXT PK | 'layout' or 'captions' |
| `tenant_id` | UUID FK NOT NULL | References `tenants` (for RLS) |
| **Versioning** | | |
| `server_version` | BIGINT NOT NULL | Increments on every change (authoritative) |
| `wasabi_version` | BIGINT NOT NULL | Version currently in Wasabi (cold storage) |
| `wasabi_synced_at` | TIMESTAMPTZ | When Wasabi was last updated |
| **Working Copy** | | |
| `working_copy_path` | TEXT | Local filesystem path on server |
| **Lock (user-level)** | | |
| `lock_holder_user_id` | UUID FK | User who owns the lock |
| `lock_type` | TEXT | 'client' or 'server' |
| `locked_at` | TIMESTAMPTZ | When lock was acquired |
| `last_activity_at` | TIMESTAMPTZ | Last change (for idle timeout) |
| **Active Connection** | | |
| `active_connection_id` | TEXT | WebSocket connection ID (for routing only) |

**Primary Key:** `(video_id, database_name)`

**Key concepts:**
- `server_version > wasabi_version` means Wasabi is stale (server has unsaved changes)
- Lock is **user-level**, not session-level. Same user can transparently switch tabs.
- `active_connection_id` identifies which WebSocket to notify on session transfer.

**Indexes:**

```sql
-- Find databases needing Wasabi upload (idle with unsaved changes)
CREATE INDEX idx_vds_pending_upload ON video_database_state(last_activity_at)
    WHERE server_version > wasabi_version;

-- Find databases locked by a user
CREATE INDEX idx_vds_lock_holder ON video_database_state(lock_holder_user_id)
    WHERE lock_holder_user_id IS NOT NULL;
```

See: [Sync Protocol Reference](./sync-protocol.md) for usage details.

---

### Access Control Tables

#### `platform_admins`

Cross-tenant admin access.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID PK FK | References `auth.users` |
| `admin_level` | TEXT | 'super_admin' or 'support' |
| `granted_at` | TIMESTAMPTZ | When granted |
| `granted_by` | UUID FK | Granting admin |
| `revoked_at` | TIMESTAMPTZ | Revocation timestamp |
| `notes` | TEXT | Admin notes |

#### `access_tiers`

Feature access levels.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | 'demo', 'trial', 'active' |
| `name` | TEXT NOT NULL | Display name |
| `features` | JSONB | Feature flags |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

#### `invite_codes`

Preview access control.

| Column | Type | Description |
|--------|------|-------------|
| `code` | TEXT PK | Invite code |
| `created_by` | UUID FK | Creator |
| `used_by` | UUID FK | User who used it |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `used_at` | TIMESTAMPTZ | Usage timestamp |
| `expires_at` | TIMESTAMPTZ | Expiration |
| `max_uses` | INTEGER | Maximum uses |
| `uses_count` | INTEGER | Current uses |
| `notes` | TEXT | Admin notes |

---

### ML Processing Tables

#### `caption_frame_extents_inference_runs`

Completed inference runs. Used to avoid redundant processing—before starting a new job, check for existing run with same (video_id, cropped_frames_version, model_version).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Run identifier |
| `run_id` | TEXT UNIQUE | External run ID |
| `video_id` | UUID FK | Processed video |
| `tenant_id` | UUID FK | Owner tenant |
| `cropped_frames_version` | INTEGER | Input version |
| `model_version` | TEXT | Model used |
| `wasabi_storage_key` | TEXT | Results database key |
| `file_size_bytes` | BIGINT | Results size |
| `total_pairs` | INTEGER | Frame pairs processed |
| `processing_time_seconds` | REAL | Total time |
| `started_at/completed_at` | TIMESTAMPTZ | Timestamps |

#### `caption_frame_extents_inference_jobs`

Active inference queue.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Job identifier |
| `video_id` | UUID FK | Target video |
| `tenant_id` | UUID FK | Owner tenant |
| `cropped_frames_version` | INTEGER | Input version |
| `model_version` | TEXT | Model to use |
| `status` | TEXT | Job status |
| `priority` | TEXT | 'high' or 'low' |
| `started_at/completed_at` | TIMESTAMPTZ | Timestamps |
| `error_message` | TEXT | Error if failed |
| `inference_run_id` | UUID FK | Completed run reference |

#### `caption_frame_extents_inference_rejections`

Validation failure tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Rejection identifier |
| `video_id` | UUID FK | Rejected video |
| `tenant_id` | UUID FK | Owner tenant |
| `rejection_type` | TEXT | 'frame_count_exceeded', 'cost_exceeded', etc. |
| `rejection_message` | TEXT | Human-readable message |
| `frame_count` | INTEGER | Actual frame count |
| `estimated_cost_usd` | NUMERIC | Cost estimate |
| `acknowledged` | BOOLEAN | User acknowledged |
| `acknowledged_at` | TIMESTAMPTZ | Acknowledgment time |
| `acknowledged_by` | UUID FK | Acknowledging user |

---

### Audit & Monitoring Tables

#### `security_audit_log`

Authentication and authorization events.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Event identifier |
| `event_type` | TEXT | 'auth_success', 'auth_failure', 'authz_failure', 'cross_tenant_attempt' |
| `severity` | TEXT | 'info', 'warning', 'critical' |
| `user_id` | UUID FK | Acting user |
| `tenant_id` | UUID FK | User's tenant |
| `target_tenant_id` | UUID FK | Target of cross-tenant attempt |
| `resource_type` | TEXT | Accessed resource type |
| `resource_id` | TEXT | Accessed resource ID |
| `ip_address` | INET | Client IP |
| `user_agent` | TEXT | Client user agent |
| `request_path` | TEXT | Request path |
| `request_method` | TEXT | HTTP method |
| `error_message` | TEXT | Error if failed |
| `metadata` | JSONB | Additional context |
| `created_at` | TIMESTAMPTZ | Event timestamp |

#### `usage_metrics`

Quota usage recording.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Metric identifier |
| `tenant_id` | UUID FK | Tenant |
| `metric_type` | TEXT | 'storage_gb', 'processing_minutes', 'video_count' |
| `metric_value` | NUMERIC | Measured value |
| `cost_estimate_usd` | NUMERIC | Cost estimate |
| `metadata` | JSONB | Additional context |
| `recorded_at` | TIMESTAMPTZ | Recording timestamp |

#### `daily_uploads`

Rate limiting per tenant.

| Column | Type | Description |
|--------|------|-------------|
| `tenant_id` | UUID PK | Tenant |
| `upload_date` | DATE PK | Date |
| `upload_count` | INTEGER | Uploads that day |
| `total_bytes` | BIGINT | Total bytes uploaded |

---

### Training Data Tables

#### `training_cohorts`

ML training dataset registry.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Cohort identifier |
| `language` | TEXT | Dataset language |
| `domain` | TEXT | Content domain |
| `snapshot_storage_key` | TEXT | Wasabi key for snapshot |
| `status` | TEXT | 'building', 'training', 'completed', 'deprecated' |
| `wandb_run_id` | TEXT | Weights & Biases run |
| `git_commit` | TEXT | Code version |
| `total_videos` | INTEGER | Videos in cohort |
| `total_frames` | INTEGER | Frames in cohort |
| `total_annotations` | INTEGER | Annotations in cohort |
| `immutable` | BOOLEAN | Lock for production use |

#### `cohort_videos`

Many-to-many: videos in training cohorts.

| Column | Type | Description |
|--------|------|-------------|
| `cohort_id` | TEXT PK FK | Parent cohort |
| `video_id` | UUID PK FK | Included video |
| `tenant_id` | UUID FK | Video's tenant |
| `frames_contributed` | INTEGER | Frames from this video |
| `annotations_contributed` | INTEGER | Annotations from this video |
| `included_at` | TIMESTAMPTZ | Inclusion timestamp |

---

## Views

#### `security_metrics`

Aggregated hourly security dashboard.

---

## RLS Policies

### Core Access Pattern

```sql
-- Users see only their tenant's data
CREATE POLICY "tenant_isolation" ON videos
  FOR ALL
  USING (tenant_id = current_user_tenant_id());

-- Platform admins see all data
CREATE POLICY "admin_access" ON videos
  FOR SELECT
  USING (is_platform_admin());

-- Demo videos visible to all authenticated users
CREATE POLICY "demo_videos" ON videos
  FOR SELECT
  USING (is_demo = true AND auth.uid() IS NOT NULL);
```

### Helper Functions

```sql
-- Check if current user is platform admin
is_platform_admin() RETURNS BOOLEAN

-- Check if user is tenant owner
is_tenant_owner(tenant_uuid UUID) RETURNS BOOLEAN

-- Get current user's tenant ID
current_user_tenant_id() RETURNS UUID

-- Check feature access
has_feature_access(feature_name TEXT) RETURNS BOOLEAN

-- Check upload quota
can_upload_video(p_tenant_id UUID, p_file_size BIGINT) RETURNS BOOLEAN

-- Get tenant usage stats
get_tenant_usage(p_tenant_id UUID) RETURNS TABLE(...)
```

---

## Client Implementations

### TypeScript (Browser)

Location: `apps/captionacc-web/app/services/supabase-client.ts`

```typescript
import { createClient } from "@supabase/supabase-js";
import type { Database } from "~/types/supabase";

const supabase = createClient<Database>(url, anonKey, {
  db: { schema: "captionacc_production" }
});

// Uses RLS - automatically filtered by user's tenant
const { data: videos } = await supabase
  .from("videos")
  .select("*")
  .is("deleted_at", null);
```

### TypeScript (Server/SSR)

Location: `apps/captionacc-web/app/services/supabase-server.ts`

```typescript
import { createServerClient } from "@supabase/ssr";

// Cookie-based session management for React Router
const supabase = createServerClient<Database>(url, anonKey, {
  cookies: { /* cookie handlers */ }
});
```

### Python (Orchestrator)

Location: `services/orchestrator/supabase_client.py`

```python
from supabase_client import get_supabase_client

# Uses service role key (bypasses RLS)
client = get_supabase_client(require_production=True)

# Repository pattern
from supabase_client import VideoRepository

video_repo = VideoRepository(client)
video = video_repo.create_video(tenant_id, display_path, size_bytes, ...)
# storage_key is computed as f"{tenant_id}/client/videos/{video_id}/video.mp4"
```

---

## Migrations

Location: `supabase/migrations/`

| File | Purpose |
|------|---------|
| `20260106162623_multi_schema_setup.sql` | Schema creation, permissions |
| `20260106170000_populate_production_schema.sql` | Core tables, RLS |
| `20260106180000_platform_admin_and_user_isolation.sql` | Admin access, roles |
| `20260106190000_invite_codes_and_quotas.sql` | Invite system, quotas |
| `20260107000000_access_tiers.sql` | Feature tiers |
| `20260107000000_caption_frame_extents_inference_tables.sql` | ML job tables |
| `20260107000001_caption_frame_extents_inference_rejections.sql` | Rejection tracking |
| `20260107010000_demo_videos.sql` | Demo video support |
| `20260107020000_security_audit_logging.sql` | Security audit |
| `20260107210000_allow_self_admin_check.sql` | Policy fixes |
| `20260107210100_fix_admin_policy_recursion.sql` | Recursion prevention |
| `20260107210200_remove_all_recursive_policies.sql` | Policy cleanup |
| `20260108000000_rename_filename_to_video_path.sql` | Column rename |

---

## Type Generation

TypeScript types auto-generated from schema:

```bash
npx supabase gen types typescript --local > app/types/supabase.ts
```

Location: `apps/captionacc-web/app/types/supabase.ts`
