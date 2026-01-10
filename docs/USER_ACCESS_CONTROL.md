# User Access Control & Authorization

## Overview

CaptionA.cc uses a tiered access control system that separates feature access from billing/payment concerns. This allows flexible business models (subscription, credits, one-time purchase) while maintaining consistent authorization enforcement.

**Architecture:**
- **Access Tiers** - Control what features users can access (demo/trial/active)
- **RLS (Row Level Security)** - Database-level tenant isolation
- **API Middleware** - Application-level permission enforcement
- **Demo Videos** - Shared read-only content accessible to all users

**Storage Model:**
- Video files, frames, and annotations → Wasabi S3
- Video catalog and metadata → Supabase PostgreSQL
- User profiles and access tiers → Supabase PostgreSQL

**B2C Tenant Model:**
- Each user has their own tenant (workspace)
- Users are "owners" of their tenant by default
- Future: Can invite additional users to tenant as "members"

## Access Tier System

### Design Rationale

The access tier system provides three levels of access:

1. **Demo Tier** - Prospective users can explore demo videos before signing up
2. **Trial Tier** - Users can upload and annotate up to 3 videos to evaluate the product
3. **Active Tier** - Full access for paying/approved users

**Why limit trial annotation to first 3 uploads?** The trial tier must allow users to genuinely try the product (upload + annotate), but prevent abuse where users upload many videos on an active tier, then downgrade to trial while retaining edit access to a large library. The "first 3 uploaded videos" rule (ordered by timestamp, non-renewable) strikes this balance.

**Why soft-delete only?** To enforce non-renewable annotation slots, deleted videos remain in the database with `deleted_at` timestamps. This prevents "slot recycling" where users delete video #1 to unlock annotation on video #4.

### Database Schema

**File:** `/supabase/migrations/20260107000000_access_tiers.sql` (NEW)

```sql
-- Access tiers table
-- Defines what features each tier can access
-- Billing/payment is managed separately
CREATE TABLE access_tiers (
  id TEXT PRIMARY KEY,  -- 'demo', 'approved', 'full'
  name TEXT NOT NULL,
  description TEXT,
  features JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add access tier fields to user_profiles
ALTER TABLE user_profiles
  ADD COLUMN access_tier_id TEXT DEFAULT 'demo' REFERENCES access_tiers(id),
  ADD COLUMN access_notes TEXT;  -- Admin notes about why tier was changed

INSERT INTO access_tiers (id, name, description, features) VALUES
  ('demo', 'Demo Access', 'Read-only access to demo videos only', '{
    "max_videos": 0,
    "max_storage_gb": 0,
    "annotation": false,
    "export": false,
    "upload": false,
    "demo_access": true
  }'),
  ('trial', 'Trial Access', 'Upload up to 3 videos with annotation access on first 3 uploaded', '{
    "max_videos": 3,
    "max_storage_gb": 1,
    "annotation": true,
    "annotation_video_limit": 3,
    "export": true,
    "upload": true,
    "demo_access": true
  }'),
  ('active', 'Active Access', 'Full access to all features', '{
    "max_videos": 1000,
    "max_storage_gb": 100,
    "annotation": true,
    "export": true,
    "upload": true,
    "demo_access": true
  }');

-- Function to check feature access
CREATE OR REPLACE FUNCTION has_feature_access(
  p_user_id UUID,
  p_feature TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_tier_id TEXT;
  v_features JSONB;
BEGIN
  SELECT access_tier_id INTO v_tier_id
  FROM user_profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT features INTO v_features
  FROM access_tiers
  WHERE id = v_tier_id;

  RETURN COALESCE((v_features->p_feature)::BOOLEAN, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON TABLE access_tiers IS 'Defines feature access levels. Billing/payment managed separately.';
COMMENT ON COLUMN user_profiles.access_tier_id IS 'User access level - controls feature access independent of billing';
COMMENT ON FUNCTION has_feature_access IS 'Check if user has access to a specific feature based on their tier';
```

### Tier Capabilities

| Tier | Upload | Annotate | Export | View Demo |
|------|--------|----------|--------|-----------|
| **demo** | ❌ | ❌ | ❌ | ✅ |
| **trial** | ✅ (3 max) | ✅ (first 3 only) | ✅ | ✅ |
| **active** | ✅ (unlimited) | ✅ (unlimited) | ✅ | ✅ |

**Trial Tier Details:**
- Can upload up to 3 videos
- Can annotate ONLY the first 3 videos uploaded (by `uploaded_at` timestamp)
- Annotation slots are non-renewable (deleting video #1 doesn't unlock annotation on video #4)
- Can view and export ALL videos, regardless of count

**Common Scenarios:**
- New trial user: Upload 3 videos → annotate all 3
- Lapsed payment (had 50 videos): View/export all 50 → annotate only videos #1-3 by upload order
- User deletes video #2: Can still annotate videos #1 and #3, cannot annotate video #4

### Implementation Notes

**Tier Assignment:**
- New signups default to `demo` tier
- Migrate existing preview users to `active` tier
- Platform admins can change tiers via SQL or admin UI
- Downgrading preserves all user data

**Feature Flags:**
- `annotation_video_limit`: Enforced at permission check time (not via `has_feature_access`)
- Features stored as JSONB for flexibility
- Access management is decoupled from billing systems

### Feature Access Utilities

**File:** `/apps/captionacc-web/app/utils/feature-auth.ts` (NEW)

```typescript
import { createServerSupabaseClient } from '~/services/supabase-client'
import { redirect } from 'react-router'

export type Feature = 'annotation' | 'export' | 'upload'

/**
 * Check if user has access to a feature
 */
export async function requireFeature(
  userId: string,
  feature: Feature
): Promise<boolean> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase
    .rpc('has_feature_access', {
      p_user_id: userId,
      p_feature: feature
    })

  if (error) {
    console.error('Feature check error:', error)
    return false
  }

  return data as boolean
}

/**
 * Middleware: require feature access or throw 402
 */
export async function requireFeatureMiddleware(
  request: Request,
  feature: Feature
): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (!user) {
    throw redirect('/auth/login')
  }

  const hasAccess = await requireFeature(user.id, feature)

  if (!hasAccess) {
    throw new Response('Access Upgrade Required', {
      status: 402,
      headers: { 'X-Required-Feature': feature }
    })
  }

  return user.id
}
```

### Client-Side Feature Access

**File:** `/apps/captionacc-web/app/hooks/useFeatureAccess.ts` (NEW)

```typescript
import { useEffect, useState } from 'react'
import { useAuth } from '~/components/auth/AuthProvider'

export function useFeatureAccess(feature: string) {
  const { user } = useAuth()
  const [hasAccess, setHasAccess] = useState<boolean>(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setHasAccess(false)
      setLoading(false)
      return
    }

    fetch(`/api/auth/feature-access?feature=${feature}`)
      .then(res => res.json())
      .then(data => setHasAccess(data.hasAccess))
      .finally(() => setLoading(false))
  }, [user, feature])

  return { hasAccess, loading }
}
```

**File:** `/apps/captionacc-web/app/routes/api.auth.feature-access.tsx` (NEW)

```typescript
import { json, type LoaderFunctionArgs } from 'react-router'
import { requireFeature } from '~/utils/feature-auth'
import { createServerSupabaseClient } from '~/services/supabase-client'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const feature = url.searchParams.get('feature')

  if (!feature) {
    return json({ error: 'Missing feature parameter' }, { status: 400 })
  }

  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return json({ hasAccess: false })
  }

  const hasAccess = await requireFeature(user.id, feature as any)
  return json({ hasAccess })
}
```

## API Authentication & Authorization

### Design: Defense in Depth

The system enforces permissions at three layers:

1. **RLS (Database)** - PostgreSQL policies prevent unauthorized data access even if application logic is bypassed
2. **API Middleware** - Application-level checks provide clear error messages and prevent unnecessary queries
3. **Client UI** - Interface elements hide features based on permissions (UX only, not security)

This defense-in-depth approach ensures that even if middleware is bypassed, RLS policies prevent data breaches.

### Authentication Middleware

**File:** `/apps/captionacc-web/app/utils/api-auth.ts` (NEW)

```typescript
import type { User } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '~/services/supabase-client'
import { isPlatformAdmin } from '~/services/platform-admin'

export interface AuthContext {
  user: User
  userId: string
  tenantId: string
  role: 'owner' | 'member'
  isPlatformAdmin: boolean
}

/**
 * Authenticate request and return user context
 * Use this in ALL API route loaders/actions
 */
export async function requireAuth(request: Request): Promise<AuthContext> {
  const supabase = createServerSupabaseClient()

  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    throw new Response('Unauthorized', { status: 401 })
  }

  // Get user profile (includes tenant_id, role, approval_status)
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('tenant_id, role, approval_status')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    throw new Response('User profile not found', { status: 404 })
  }

  // Check approval status
  if (profile.approval_status !== 'approved') {
    throw new Response('Account pending approval', { status: 403 })
  }

  // Check if platform admin
  const isAdmin = await isPlatformAdmin(user.id)

  return {
    user,
    userId: user.id,
    tenantId: profile.tenant_id,
    role: profile.role,
    isPlatformAdmin: isAdmin
  }
}

/**
 * Require video ownership for modification
 * Platform admins and tenant owners bypass this check
 */
export async function requireVideoOwnership(
  authContext: AuthContext,
  videoId: string
): Promise<void> {
  // Platform admins bypass ownership checks
  if (authContext.isPlatformAdmin) {
    return
  }

  const supabase = createServerSupabaseClient()

  const { data: video, error } = await supabase
    .from('videos')
    .select('uploaded_by_user_id, tenant_id')
    .eq('id', videoId)
    .single()

  if (error || !video) {
    throw new Response('Video not found', { status: 404 })
  }

  // Check ownership: either uploaded by user OR user is tenant owner
  const isOwner = video.uploaded_by_user_id === authContext.userId
  const isTenantOwner = authContext.role === 'owner' && video.tenant_id === authContext.tenantId

  if (!isOwner && !isTenantOwner) {
    throw new Response('Forbidden: Not your video', { status: 403 })
  }
}
```

### Applying Authentication to Routes

All API routes that modify video data must authenticate the user and verify ownership:

**Example: Delete Video Route**

**File:** `/apps/captionacc-web/app/routes/api.videos.$videoId.delete.tsx`

```typescript
import { requireAuth, requireVideoOwnership } from '~/utils/api-auth'

export async function action({ params, request }: ActionFunctionArgs) {
  // Authenticate user and get context
  const authContext = await requireAuth(request)

  const { videoId: encodedVideoId } = params
  const videoId = decodeURIComponent(encodedVideoId)

  // Verify user owns this video (or is platform admin)
  await requireVideoOwnership(authContext, videoId)

  // Soft-delete the video (set deleted_at timestamp)
  // Note: Hard deletes are not allowed - see "Soft Delete Requirement" below
  // ... existing soft-delete implementation ...
}
```

**Soft Delete Requirement:** Video deletion uses soft-delete (`deleted_at` timestamp) rather than removing records. This is essential for trial tier annotation limits - deleted videos must remain in the ordering to prevent users from "recycling" annotation slots by deleting videos.

### Routes Requiring Auth

Update these files to add `requireAuth()` and ownership checks:

- `/app/routes/api.videos.rename.tsx` - Add auth + ownership
- `/app/routes/api.videos.move.tsx` - Add auth + ownership
- `/app/routes/api.annotations.$videoId.*.tsx` - Add auth + ownership
- `/app/routes/upload.tsx` - Add `requireFeatureMiddleware(request, 'upload')`
- `/app/routes/annotate.*.tsx` - Add `requireFeatureMiddleware(request, 'annotation')`

Pattern for all routes:
```typescript
export async function loader/action({ request, params }: LoaderFunctionArgs) {
  const authContext = await requireAuth(request)
  // For video operations:
  await requireVideoOwnership(authContext, videoId)
  // For feature-gated operations:
  await requireFeatureMiddleware(request, 'annotation')

  // ... existing logic ...
}
```

## Video Catalog with RLS

### Design: Supabase as Source of Truth

Video listing queries Supabase rather than scanning the filesystem. This ensures RLS policies automatically enforce tenant isolation - users only see their own videos without manual filtering.

**Benefits:**
- RLS policies enforce tenant isolation automatically
- No manual permission checks needed in application code
- Database is authoritative source for video catalog
- Supports future features like video sharing

### Video List API

**File:** `/apps/captionacc-web/app/routes/api.videos.list.tsx` (NEW)

```typescript
import { json, type LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { createServerSupabaseClient } from '~/services/supabase-client'

export async function loader({ request }: LoaderFunctionArgs) {
  const supabase = createServerSupabaseClient()

  // Get authenticated user
  const { data: { user }, error } = await supabase.auth.getUser()

  if (!user) {
    throw redirect('/auth/login')
  }

  // Query videos table - RLS automatically filters by tenant/user
  const { data: videos, error: videosError } = await supabase
    .from('videos')
    .select('id, filename, display_path, status, uploaded_at, is_demo')
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false })

  if (videosError) {
    console.error('Failed to fetch videos:', videosError)
    return json({ videos: [] })
  }

  // Transform to VideoInfo format expected by tree builder
  const videoList = (videos || []).map(v => ({
    videoId: v.id,
    displayPath: v.display_path || v.filename || v.id,
    isDemo: v.is_demo || false
  }))

  return json({ videos: videoList })
}
```

**Note:** Requires `display_path` and `is_demo` columns (added in demo videos migration below).

### Videos Page Loader

**File:** `/apps/captionacc-web/app/routes/videos.tsx`

```typescript
export async function loader() {
  const dataDir = resolve(process.cwd(), '..', '..', 'local', 'data')

  // Fetch video catalog from Supabase (RLS-filtered)
  const response = await fetch('/api/videos/list')
  const { videos } = await response.json()

  // Convert to VideoInfo format
  const videoList: VideoInfo[] = videos.map((v: any) => ({
    videoId: v.videoId,
    displayPath: v.displayPath,
    isDemo: v.isDemo
  }))

  // Build tree structure (same as before)
  let tree = buildVideoTree(videoList)

  // Get empty folders and insert
  const emptyFolders = readEmptyFolders(dataDir)
  tree = insertEmptyFolders(tree, emptyFolders)

  // Calculate counts and sort
  tree.forEach(node => {
    if (node.type === 'folder') {
      calculateVideoCounts(node)
    }
  })

  return { tree: sortTreeNodes(tree) }
}
```

## Demo Videos

### Design: Shared Read-Only Content

Demo videos are accessible to all users (including demo-tier users who cannot upload their own content). This allows prospective users to explore the application before committing to a trial.

**Access Rules:**
- Visible to all authenticated users
- Read-only (cannot annotate or delete)
- Platform admins can create/modify demo videos
- Marked with `is_demo` flag in database

### Database Schema

**File:** `/supabase/migrations/20260107010000_demo_videos.sql` (NEW)

```sql
-- Add demo fields to videos table
ALTER TABLE videos
  ADD COLUMN is_demo BOOLEAN DEFAULT FALSE,
  ADD COLUMN display_path TEXT;

-- Update display_path from existing data
-- For videos already in Supabase, use filename as display_path
UPDATE videos SET display_path = filename WHERE display_path IS NULL;

-- RLS Policy: Demo videos visible to all
CREATE POLICY "Anyone can view demo videos"
  ON videos FOR SELECT
  USING (
    is_demo = TRUE
    AND deleted_at IS NULL
  );

-- Prevent editing demo videos (only platform admins can)
CREATE POLICY "Only admins can modify demo videos"
  ON videos FOR UPDATE
  USING (
    is_demo = TRUE
    AND is_platform_admin()
  );

CREATE POLICY "Only admins can delete demo videos"
  ON videos FOR DELETE
  USING (
    is_demo = TRUE
    AND is_platform_admin()
  );

COMMENT ON COLUMN videos.is_demo IS 'True if video is a demo/sample video accessible to all users (read-only)';
COMMENT ON COLUMN videos.display_path IS 'Display path for organizing videos in folders (e.g., "level1/video_name")';

COMMENT ON COLUMN videos.uploaded_at IS 'Upload timestamp - determines annotation access order for trial tier (first 3 uploaded)';
COMMENT ON COLUMN videos.deleted_at IS 'Soft delete timestamp - deleted videos count toward trial tier annotation limits';
```

### Video Permissions

**File:** `/apps/captionacc-web/app/utils/video-permissions.ts` (NEW)

```typescript
import { createServerSupabaseClient } from '~/services/supabase-client'
import { isPlatformAdmin } from '~/services/platform-admin'
import { redirect } from 'react-router'

export interface VideoPermissions {
  canView: boolean
  canAnnotate: boolean
  canDelete: boolean
  canExport: boolean
  isDemo: boolean
  reason?: string
}

export async function getVideoPermissions(
  userId: string,
  videoId: string
): Promise<VideoPermissions> {
  const supabase = createServerSupabaseClient()

  // Get video details
  const { data: video, error } = await supabase
    .from('videos')
    .select('is_demo, uploaded_by_user_id, tenant_id')
    .eq('id', videoId)
    .single()

  if (!video) {
    return {
      canView: false,
      canAnnotate: false,
      canDelete: false,
      canExport: false,
      isDemo: false,
      reason: 'Video not found'
    }
  }

  // Demo videos: read-only for everyone
  if (video.is_demo) {
    return {
      canView: true,
      canAnnotate: false,
      canDelete: false,
      canExport: false,
      isDemo: true,
      reason: 'Demo videos are read-only'
    }
  }

  // Check ownership (owner, tenant owner, or platform admin)
  const isOwner = video.uploaded_by_user_id === userId
  const isAdmin = await isPlatformAdmin(userId)
  // Note: Tenant owner check can be added here when multi-user tenants are enabled

  const canView = isOwner || isAdmin
  const canExport = isOwner || isAdmin
  const canDelete = isOwner || isAdmin

  // Annotation permission depends on access tier
  let canAnnotate = false
  if (isOwner) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('access_tier_id')
      .eq('id', userId)
      .single()

    if (profile?.access_tier_id === 'trial') {
      // Trial tier: only first 3 uploaded videos (including deleted in count)
      const { data: allUserVideos } = await supabase
        .from('videos')
        .select('id, deleted_at')
        .eq('uploaded_by_user_id', userId)
        .order('uploaded_at', { ascending: true })
        .limit(3)

      const isInFirstThree = allUserVideos?.some(v => v.id === videoId)
      const { data: currentVideo } = await supabase
        .from('videos')
        .select('deleted_at')
        .eq('id', videoId)
        .single()

      canAnnotate = isInFirstThree && !currentVideo?.deleted_at
    } else if (profile?.access_tier_id === 'active') {
      canAnnotate = true
    }
  } else if (isAdmin) {
    canAnnotate = true
  }

  return {
    canView,
    canAnnotate,
    canDelete,
    canExport,
    isDemo: false,
    reason: !canAnnotate && canView ? 'Annotation limited to first 3 uploaded videos on trial tier' : undefined
  }
}

/**
 * Middleware: require annotation permission
 */
export async function requireAnnotatePermission(
  request: Request,
  videoId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw redirect('/auth/login')
  }

  const permissions = await getVideoPermissions(user.id, videoId)

  if (!permissions.canAnnotate) {
    throw new Response('Forbidden: Cannot annotate this video', {
      status: 403,
      headers: { 'X-Reason': permissions.reason || 'Read-only' }
    })
  }
}
```

### Protecting Annotation Routes

**File:** `/apps/captionacc-web/app/routes/annotate.text.tsx` (MODIFY)

```typescript
import { requireAnnotatePermission, getVideoPermissions } from '~/utils/video-permissions'
import { requireFeatureMiddleware } from '~/utils/feature-auth'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const videoId = url.searchParams.get('videoId')

  if (!videoId) {
    throw new Response('Missing videoId', { status: 400 })
  }

  // Check feature access
  await requireFeatureMiddleware(request, 'annotation')

  // Check video permissions
  await requireAnnotatePermission(request, videoId)

  // ... rest of loader ...
}
```

### UI Indicators

**File:** `/apps/captionacc-web/app/components/videos/VideoTable.tsx` (MODIFY)

Add demo badge:

```typescript
{node.type === 'video' && (
  <>
    <Link to={`/annotate/text?videoId=${node.videoId}`}>
      {node.name}
    </Link>
    {node.isDemo && (
      <span className="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
        Demo
      </span>
    )}
  </>
)}
```

Disable edit actions for demos:

```typescript
{!node.isDemo && (
  <button onClick={() => onRenameVideo(node.videoId, node.name)}>
    Rename
  </button>
)}
```

## Implementation & Testing

### Catalog Synchronization

If videos exist on Wasabi but aren't cataloged in Supabase, sync them:

**Storage Architecture Reference:**
- Video files (MP4/WebM) → Wasabi S3
- Frames (cropped caption regions) → Wasabi S3 (VP9 chunks)
- Annotations & OCR data → Wasabi S3 (per-video SQLite databases)
- Video catalog/metadata → Supabase PostgreSQL

**Sync Script:**

**File:** `/scripts/sync-video-catalog.ts`

```typescript
import { getAllVideos } from '~/utils/video-paths'
import { createServerSupabaseClient } from '~/services/supabase-client'

async function syncVideoCatalog() {
  const supabase = createServerSupabaseClient()
  const videos = getAllVideos() // Scan Wasabi via SQLite databases

  for (const video of videos) {
    const { data: existing } = await supabase
      .from('videos')
      .select('id')
      .eq('id', video.videoId)
      .single()

    if (!existing) {
      console.log(`Missing from catalog: ${video.videoId}`)
      // Create record or log for manual review
    }
  }
}
```

### Testing Checklist

- [ ] User logs in, sees only their own videos
- [ ] Tenant owner sees all tenant videos (if multi-user)
- [ ] Platform admin sees all videos
- [ ] Demo videos visible to all users (read-only)
- [ ] Cannot annotate demo videos (403 error)
- [ ] Demo-tier user blocked from uploading personal videos
- [ ] Trial-tier user can upload up to 3 videos
- [ ] Trial-tier user can annotate ONLY their first 3 uploaded videos
- [ ] Trial-tier user blocked from annotating video #4+ (403 error with reason)
- [ ] Trial-tier user can view/export all their videos
- [ ] Active-tier user can upload and annotate unlimited videos
- [ ] Cannot delete another user's video (403 error)
- [ ] RLS blocks unauthorized queries even if middleware bypassed
- [ ] User can be downgraded from 'active' to 'trial' tier (payment lapse)
- [ ] Lapsed user (trial tier) can still view/export all existing videos (even >3)
- [ ] Lapsed user with 50 videos can only annotate videos #1-3 (by upload timestamp)
- [ ] Deleting video #1 doesn't allow annotation access to video #4 (soft-delete maintains order)
- [ ] Deleted videos still count toward "first 3" calculation
- [ ] Cannot annotate a deleted video (even if it's in first 3)
- [ ] Lapsed user cannot upload new videos beyond trial limit

## File Reference

### Database Migrations
- `/supabase/migrations/20260107000000_access_tiers.sql` - Access tier system
- `/supabase/migrations/20260107010000_demo_videos.sql` - Demo video support

### New Utilities
- `/apps/captionacc-web/app/utils/api-auth.ts` - Authentication middleware
- `/apps/captionacc-web/app/utils/feature-auth.ts` - Feature flag checks
- `/apps/captionacc-web/app/utils/video-permissions.ts` - Video-level permissions
- `/apps/captionacc-web/app/hooks/useFeatureAccess.ts` - Client-side feature checks

### New API Routes
- `/apps/captionacc-web/app/routes/api.videos.list.tsx` - RLS-filtered video catalog
- `/apps/captionacc-web/app/routes/api.auth.feature-access.tsx` - Feature access API

### Modified Files
- `/apps/captionacc-web/app/routes/videos.tsx` - Supabase-based video listing
- `/apps/captionacc-web/app/routes/api.videos.$videoId.delete.tsx` - Auth middleware
- `/apps/captionacc-web/app/routes/api.videos.rename.tsx` - Auth middleware
- `/apps/captionacc-web/app/routes/api.videos.move.tsx` - Auth middleware
- `/apps/captionacc-web/app/routes/annotate.text.tsx` - Permission checks
- `/apps/captionacc-web/app/components/videos/VideoTable.tsx` - Demo badges
- `/apps/captionacc-web/app/utils/video-paths.ts` - Deprecation marker

## Security Architecture

### Three-Layer Defense

1. **RLS (Database)** - PostgreSQL policies enforce tenant isolation regardless of application logic
2. **API Middleware** - Application-level checks (`requireAuth`, `requireVideoOwnership`) provide clear error messages and prevent unnecessary queries
3. **Client UI** - Interface elements hide unavailable features for better UX (not security)

**Important:** Client-side checks are for user experience only. Security is enforced at the database and API layers.

## Administrative Operations

### Managing Access Tiers

Platform admins change user tiers via SQL or admin UI (future). Tier changes preserve all user data but restrict operations:

**Downgrade Example (active → trial):**
- User retains all existing videos
- View and export access maintained
- Annotation restricted to first 3 uploaded videos (by upload timestamp)
- No new uploads beyond 3-video limit

**Soft Delete Enforcement:**

Video deletion uses soft-delete (`deleted_at` timestamp) exclusively. Hard deletes are not permitted because:
- Trial tier annotation limits count deleted videos in the upload order
- Prevents "slot recycling" where users delete video #1 to unlock annotation on video #4
- Maintains referential integrity for audit trails

### System Components

**Separation of Concerns:**
- **Access Tiers** - Feature access control (demo/trial/active)
- **Approval Status** - Account activation state (pending/approved/rejected)
- **Billing** - Payment processing (separate system integration)

## Future Enhancements (Not Yet on Roadmap)

### Admin UI for Access Management
- View all users and their access tiers
- Change user access tier with audit log
- View usage statistics per user/tenant

### Usage Tracking & Quotas
- Track storage used, videos uploaded, processing minutes
- Enforce soft/hard limits based on access tier
- Alert users approaching limits

### Audit Logging
- Log all access tier changes
- Track who viewed/modified which videos
- Export audit logs for compliance
