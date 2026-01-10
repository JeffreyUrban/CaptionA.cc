# Wasabi IAM Policies for CaptionA.cc

This directory contains IAM policy templates for securing Wasabi S3 storage access.

## Policy Files

### CaptionAcc-ReadOnlyPolicy.json
**Purpose:** Read-only access for web application

**Used by:** `captionacc-app-readonly` IAM user

**Permissions:**
- ✅ ListBucket (caption-acc-prod only)
- ✅ GetObject (caption-acc-prod only)
- ❌ PutObject, DeleteObject (denied)
- ❌ Access to other buckets (explicitly denied)
- ❌ ListAllMyBuckets (explicitly denied)

**Use case:** Generating presigned URLs for video frame downloads

---

### CaptionAcc-RestrictedPolicy.json
**Purpose:** Read-write-delete access for video processing

**Used by:** `captionacc-orchestrator` IAM user

**Permissions:**
- ✅ ListBucket (caption-acc-prod only)
- ✅ GetObject, PutObject, DeleteObject (caption-acc-prod only)
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

All policies restrict access to `caption-acc-prod` only:
- Protects other buckets in same Wasabi account
- Limits blast radius if credentials compromised
- Enables safe multi-use of Wasabi account

---

## Applying Policies

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
- ✅ Can list caption-acc-prod
- ✅ Can read objects
- ❌ Cannot write objects
- ❌ Cannot delete objects
- ❌ Cannot list all buckets

**Read-write credentials:**
- ✅ Can list caption-acc-prod
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
sed -i 's/caption-acc-prod/your-bucket-name/g' *.json
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
"NotResource": ["arn:aws:s3:::caption-acc-prod", "..."]

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

- **Security Overview:** `/docs/wasabi/README.md`
- **Credential Rotation:** `/docs/wasabi/CREDENTIAL_ROTATION.md`
- **Repository Sanitization:** `/docs/REPO_SECURITY_SANITIZATION.md`
- **Test Scripts:** `/scripts/test-wasabi-access.sh`, `/scripts/test-both-credentials.sh`

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
