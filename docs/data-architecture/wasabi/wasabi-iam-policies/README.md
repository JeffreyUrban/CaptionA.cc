# Wasabi IAM Policies for CaptionA.cc

This directory contains IAM policy templates for securing Wasabi S3 storage access.

## Policy Files

### STS Client Credentials (Browser Direct Access)

These policies enable browsers to access Wasabi S3 directly using temporary STS credentials, without API round-trips for each media request.

#### CaptionAcc-ClientReadRole-TrustPolicy.json
**Purpose:** Trust policy for the `captionacc-client-read` IAM role

**Allows:** Only the `captionacc-sts-assumer` user can assume this role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::WASABI_ACCOUNT_ID:user/captionacc-sts-assumer"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

#### CaptionAcc-ClientReadRole-PermissionsPolicy.json
**Purpose:** Permissions policy attached to the `captionacc-client-read` role

**Grants:** Read access to all tenants' `client/` paths (further scoped by session policy)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowClientPathRead",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::captionacc-prod/*/client/*"
    }
  ]
}
```

#### CaptionAcc-STSAssumer-Policy.json
**Purpose:** Policy for the `captionacc-sts-assumer` IAM user

**Grants:** Permission to assume the client-read role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAssumeClientReadRole",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::WASABI_ACCOUNT_ID:role/captionacc-client-read"
    }
  ]
}
```

#### CaptionAcc-STSSessionPolicy.json
**Purpose:** Session policy passed at AssumeRole time (template)

**Scopes:** Credentials to a specific tenant's `client/` path only

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::captionacc-prod/{tenant_id}/client/*"
    }
  ]
}
```

**Note:** `{tenant_id}` is replaced at runtime by the Edge Function based on the authenticated user's tenant.

---

### Server-Side Policies

### CaptionAcc-ReadOnlyPolicy.json
**Purpose:** Read-only access for web application

**Used by:** `captionacc-app-readonly` IAM user

**Permissions:**
- ✅ ListBucket (captionacc-prod only)
- ✅ GetObject (captionacc-prod only)
- ❌ PutObject, DeleteObject (denied)
- ❌ Access to other buckets (explicitly denied)
- ❌ ListAllMyBuckets (explicitly denied)

**Use case:** Generating presigned URLs for video frame downloads

---

### CaptionAcc-RestrictedPolicy.json
**Purpose:** Read-write-delete access for video processing

**Used by:** `captionacc-orchestrator` IAM user

**Permissions:**
- ✅ ListBucket (captionacc-prod only)
- ✅ GetObject, PutObject, DeleteObject (captionacc-prod only)
- ❌ Access to other buckets (explicitly denied)
- ❌ ListAllMyBuckets (explicitly denied)

**Use case:** Video uploads, database uploads, cleanup operations

---

## Security Design

### Principle: Least Privilege

Each IAM user has minimum permissions needed for its function:
- Web app: Read-only (cannot upload or delete)
- Orchestrator: Read-write-delete (but only for app bucket)

### Defense in Depth

Policies use **explicit DENY** statements:
- Prevents access to non-app buckets
- Blocks bucket enumeration
- Overrides any accidental ALLOW rules

### Bucket Isolation

All policies restrict access to `captionacc-prod` only:
- Protects other buckets in same Wasabi account
- Limits blast radius if credentials compromised
- Enables safe multi-use of Wasabi account

---

## Setting Up STS Client Credentials

This section covers setting up the IAM resources for browser-based direct S3 access via STS temporary credentials.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STS Credentials Flow                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Browser              Edge Function              Wasabi STS                 │
│   ───────              ─────────────              ──────────                 │
│                                                                              │
│   1. GET /s3-credentials ──────►                                            │
│      (with JWT)                                                              │
│                                                                              │
│                        2. Extract tenant_id                                  │
│                           from JWT                                           │
│                                                                              │
│                        3. AssumeRole ─────────────────────►                  │
│                           + session policy                                   │
│                           (scoped to tenant)                                 │
│                                                                              │
│                        4. ◄───────────────────────────────── temp creds      │
│                                                                              │
│   5. ◄────────────────── return credentials                                 │
│                                                                              │
│   6. Direct S3 access ─────────────────────────────────────► Wasabi S3      │
│      (signed with temp creds)                  {tenant}/client/*            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Step 1: Create the IAM User

**In Wasabi Console → IAM → Users → Create User:**

| Setting | Value |
|---------|-------|
| User name | `captionacc-sts-assumer` |
| Programmatic access | ✅ Yes |
| Console access | ❌ No |

Do not attach any policies yet.

### Step 2: Create the IAM Role

**In Wasabi Console → IAM → Roles → Create Role:**

| Setting | Value |
|---------|-------|
| Role name | `captionacc-client-read` |
| Trust policy | Copy from `CaptionAcc-ClientReadRole-TrustPolicy.json` |

### Step 3: Attach Permissions Policy to Role

**In Wasabi Console → IAM → Roles → `captionacc-client-read` → Permissions:**

1. Create inline policy or attach managed policy
2. Copy JSON from `CaptionAcc-ClientReadRole-PermissionsPolicy.json`
3. Name it `CaptionAccClientReadPermissions`

### Step 4: Attach Policy to User

**In Wasabi Console → IAM → Users → `captionacc-sts-assumer` → Permissions:**

1. Create inline policy
2. Copy JSON from `CaptionAcc-STSAssumer-Policy.json`
3. Name it `CaptionAccAssumeRole`

### Step 5: Generate Access Keys

**In Wasabi Console → IAM → Users → `captionacc-sts-assumer` → Security Credentials:**

1. Create Access Key
2. Save both Access Key ID and Secret Access Key securely
3. These become `WASABI_STS_ACCESS_KEY` and `WASABI_STS_SECRET_KEY`

### Step 6: Configure Edge Function Secrets

```bash
cd supabase

# STS credentials
supabase secrets set WASABI_STS_ACCESS_KEY=<access_key_from_step_5>
supabase secrets set WASABI_STS_SECRET_KEY=<secret_key_from_step_5>
supabase secrets set WASABI_STS_ROLE_ARN=arn:aws:iam::WASABI_ACCOUNT_ID:role/captionacc-client-read
supabase secrets set WASABI_STS_DURATION_SECONDS=3600
```

### Step 7: Deploy Edge Function

```bash
supabase functions deploy captionacc-s3-credentials
```

### Step 8: Test

```bash
# Get a valid JWT token from your app, then:
curl -H "Authorization: Bearer <jwt>" \
  https://<project>.supabase.co/functions/v1/captionacc-s3-credentials

# Expected response:
# {
#   "credentials": { "accessKeyId": "...", "secretAccessKey": "...", "sessionToken": "..." },
#   "expiration": "2026-01-11T23:00:00Z",
#   "bucket": "captionacc-prod",
#   "region": "us-east-1",
#   "endpoint": "https://s3.us-east-1.wasabisys.com",
#   "prefix": "{tenant_id}/client/*"
# }
```

---

## Applying Server-Side Policies

### 1. Create IAM Users

**In Wasabi Console:**
1. Navigate to Users → Create User
2. Create `captionacc-app-readonly`
   - Programmatic access: ✅
   - Console access: ❌
3. Create `captionacc-orchestrator`
   - Programmatic access: ✅
   - Console access: ❌

### 2. Create Custom Policies

**In Wasabi Console:**
1. Navigate to Policies → Create Policy
2. Name: `CaptionAccReadOnlyAccess`
3. Copy JSON from `CaptionAcc-ReadOnlyPolicy.json`
4. Save policy
5. Repeat for `CaptionAccRestrictedAccess` using `CaptionAcc-RestrictedPolicy.json`

### 3. Attach Policies to Users

**In Wasabi Console:**
1. Users → `captionacc-app-readonly` → Permissions
2. Attach Policy → Select `CaptionAccReadOnlyAccess`
3. Users → `captionacc-orchestrator` → Permissions
4. Attach Policy → Select `CaptionAccRestrictedAccess`

### 4. Generate Access Keys

**For each user:**
1. User page → Security Credentials
2. Create Access Key
3. Save credentials securely (can't retrieve secret later)
4. Store in password manager

### 5. Update Application Environment

**Web app `.env`:**
```bash
WASABI_ACCESS_KEY_READONLY=<captionacc-app-readonly key>
WASABI_SECRET_KEY_READONLY=<captionacc-app-readonly secret>
```

**Orchestrator `.env`:**
```bash
WASABI_ACCESS_KEY_READWRITE=<captionacc-orchestrator key>
WASABI_SECRET_KEY_READWRITE=<captionacc-orchestrator secret>
```

---

## Testing Restrictions

**Verify policies work correctly:**

```bash
# Test from project root
./scripts/test-both-credentials.sh
```

**Expected results:**

**Read-only credentials:**
- ✅ Can list captionacc-prod
- ✅ Can read objects
- ❌ Cannot write objects
- ❌ Cannot delete objects
- ❌ Cannot list all buckets

**Read-write credentials:**
- ✅ Can list captionacc-prod
- ✅ Can read objects
- ✅ Can write objects
- ✅ Can delete objects
- ❌ Cannot list all buckets

---

## Customization

### Different Bucket Name

If using a different bucket name, update in policies:

```bash
# Find and replace in both JSON files
sed -i 's/captionacc-prod/your-bucket-name/g' *.json
```

### Different Region

Policies are region-agnostic. Update application `.env` instead:
```bash
WASABI_REGION=us-west-1  # or your region
```

### Additional Buckets

To grant access to multiple buckets:

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject"],
  "Resource": [
    "arn:aws:s3:::bucket-one/*",
    "arn:aws:s3:::bucket-two/*"
  ]
}
```

Update the DENY statement accordingly.

---

## Policy Explanation

### Why Explicit DENY?

**DENY always overrides ALLOW** in IAM evaluation:
1. User might inherit broader permissions from group
2. Bucket policy might grant access
3. Explicit DENY ensures restriction regardless

### Why Block ListAllMyBuckets?

**Information disclosure prevention:**
- Attacker cannot discover other buckets
- Reduces reconnaissance surface
- Enforces need-to-know principle

### Why Use NotResource Instead of Resource?

**Simpler DENY logic:**

```json
// This approach
"Effect": "Deny",
"NotResource": ["arn:aws:s3:::captionacc-prod", "..."]

// Is clearer than
"Effect": "Deny",
"Resource": ["arn:aws:s3:::*"],
"Condition": { "StringNotEquals": { ... } }
```

---

## Security Benefits

### Credential Compromise Scenarios

| Scenario | With Policies | Without Policies |
|----------|--------------|------------------|
| Web app credentials leak | ✅ Read-only access to app bucket | ❌ Full access to all buckets |
| Orchestrator credentials leak | ✅ Read-write to app bucket only | ❌ Full access to all buckets |
| Attacker enumerates buckets | ✅ Blocked by policy | ❌ Sees all buckets |
| Lateral movement | ✅ Cannot access other buckets | ❌ Can access all data |

---

## Related Documentation

- **Data Architecture:** `../../README.md`
- **Wasabi Storage:** `../README.md`
- **Edge Functions README:** `../../../../supabase/functions/README.md`
- **Test Scripts:** `/scripts/test-wasabi-access.sh`, `/scripts/test-both-credentials.sh`

### Policy Files in This Directory

| File | Purpose |
|------|---------|
| `CaptionAcc-ClientReadRole-TrustPolicy.json` | Trust policy for STS role |
| `CaptionAcc-ClientReadRole-PermissionsPolicy.json` | Permissions for STS role |
| `CaptionAcc-STSAssumer-Policy.json` | Policy for STS assumer user |
| `CaptionAcc-STSSessionPolicy.json` | Session policy template (runtime) |
| `CaptionAcc-ReadOnlyPolicy.json` | Server-side read-only policy |
| `CaptionAcc-RestrictedPolicy.json` | Server-side read-write policy |

---

## Maintenance

### Policy Updates

**When to update:**
- Adding new S3 operations to application
- Changing bucket names
- Adding additional buckets
- Compliance requirements change

**Process:**
1. Update JSON files in this directory
2. Update policies in Wasabi Console (Policies → Edit)
3. Test with `./scripts/test-both-credentials.sh`
4. Document changes in Git commit

### Credential Rotation

**Frequency:** Every 90 days

**See:** `/docs/CREDENTIAL_ROTATION.md` for full rotation procedure

### Policy Review

**Frequency:** Annually or when architecture changes

**Checklist:**
- [ ] Policies still align with application needs
- [ ] No overly permissive rules
- [ ] Explicit DENY statements still effective
- [ ] Test coverage validates restrictions
