# Supabase Vault Assessment

Technical evaluation of migrating from Fly.io Secrets to Supabase Vault for credential management.

## Executive Summary

**Recommendation**: **Defer Supabase Vault migration** - Current Fly.io Secrets approach is secure and operationally simple.

**Reasoning**:
- Fly.io Secrets provides adequate security for current needs
- Supabase Vault adds complexity without significant security improvement
- Cost/benefit ratio doesn't justify migration effort
- No active compliance requirements demanding centralized secret management

**Re-evaluate when**:
- SOC2/ISO27001 certification required
- Frequent credential rotation needed (quarterly → weekly)
- Multi-service credential sharing becomes complex
- Automated secret rotation workflows needed

---

## What is Supabase Vault?

Supabase Vault is a Postgres extension (`pgsodium` + `supabase_vault`) that provides:

1. **Encrypted secret storage** in Postgres
2. **Transparent Column Encryption** (TCE) for sensitive data
3. **Key management** with key rotation support
4. **Audit logging** of secret access
5. **RLS integration** for fine-grained access control

**Database-native secrets** - Secrets stored and managed directly in PostgreSQL.

---

## Current Approach: Fly.io Secrets

### How It Works

```bash
# Set secrets via Fly.io CLI
fly secrets set \
  WASABI_ACCESS_KEY_READONLY="SNAX2WPJAV4OGXCN4HEC" \
  WASABI_SECRET_KEY_READONLY="9K26uuzEoN3AQsjgGHZVerCuHmmf7BLwht5Mo0wF"
```

```typescript
// Application reads from environment variables
const wasabiClient = new S3Client({
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY_READONLY,
    secretAccessKey: process.env.WASABI_SECRET_KEY_READONLY,
  },
})
```

### Advantages

✅ **Simple** - Standard environment variable pattern
✅ **Encrypted at rest** - Fly.io encrypts secrets storage
✅ **Secure in transit** - Injected into app at runtime, not in process list
✅ **No code changes** - Works with existing libraries
✅ **Fast startup** - No database query needed to boot app
✅ **Zero dependencies** - App doesn't need database to start
✅ **CLI rotation** - Simple `fly secrets set` command

### Limitations

⚠️ **No audit logging** - Can't track who accessed which secret when
⚠️ **No versioning** - Can't rollback to previous secret value
⚠️ **Manual rotation** - Requires CLI command + redeploy
⚠️ **Per-app** - Secrets must be duplicated for web app + orchestrator service

---

## Proposed Approach: Supabase Vault

### How It Would Work

**Step 1: Enable Vault extension**

```sql
-- Enable pgsodium and vault (requires Supabase Pro plan)
CREATE EXTENSION IF NOT EXISTS pgsodium;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
```

**Step 2: Store secrets in Vault**

```sql
-- Insert secrets into vault
INSERT INTO vault.secrets (name, secret)
VALUES
  ('wasabi_access_key_readonly', 'SNAX2WPJAV4OGXCN4HEC'),
  ('wasabi_secret_key_readonly', '9K26uuzEoN3AQsjgGHZVerCuHmmf7BLwht5Mo0wF');
```

**Step 3: Create RLS policies for access control**

```sql
-- Only service role can read secrets
CREATE POLICY "Service role reads secrets"
  ON vault.secrets FOR SELECT
  USING (auth.role() = 'service_role');
```

**Step 4: Read secrets in application**

```typescript
// Application reads from Supabase Vault instead of environment
const supabase = createServerSupabaseClient()

const { data } = await supabase
  .from('vault.decrypted_secrets')
  .select('decrypted_secret')
  .eq('name', 'wasabi_access_key_readonly')
  .single()

const wasabiClient = new S3Client({
  credentials: {
    accessKeyId: data.decrypted_secret,
    secretAccessKey: await getVaultSecret('wasabi_secret_key_readonly'),
  },
})
```

**Step 5: Audit secret access**

```sql
-- Track every secret access (requires custom trigger)
CREATE TABLE vault_audit_log (
  id BIGSERIAL PRIMARY KEY,
  secret_name TEXT NOT NULL,
  accessed_by TEXT,  -- auth.uid() or auth.role()
  accessed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION audit_secret_access()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO vault_audit_log (secret_name, accessed_by)
  VALUES (NEW.name, auth.uid()::TEXT);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER track_secret_reads
AFTER SELECT ON vault.decrypted_secrets
FOR EACH ROW
EXECUTE FUNCTION audit_secret_access();
```

### Advantages

✅ **Audit logging** - Track every secret access with user ID and timestamp
✅ **Versioning** - Keep history of secret changes
✅ **Fine-grained access** - RLS policies control who reads which secrets
✅ **Centralized** - Single source of truth for all services
✅ **Rotation without redeploy** - Update secret in database, no app restart needed
✅ **Encryption at rest** - Database-level encryption via pgsodium
✅ **Transparent Column Encryption** - Secrets decrypted only in authorized queries

### Disadvantages

⚠️ **Complexity** - Additional abstraction layer and code changes
⚠️ **Database dependency** - App can't start if database unavailable
⚠️ **Latency** - Every secret read requires database round-trip
⚠️ **Pro plan required** - Vault not available on Supabase Free tier
⚠️ **Migration effort** - Rewrite all credential loading code
⚠️ **Testing complexity** - Need to mock Vault in tests
⚠️ **Debugging harder** - Can't inspect secrets with simple env vars
⚠️ **Boot time** - App startup slower (waits for DB connection)

---

## Feature Comparison

| Feature | Fly.io Secrets | Supabase Vault | Winner |
|---------|----------------|----------------|--------|
| **Security** | | | |
| Encryption at rest | ✅ | ✅ | Tie |
| Encryption in transit | ✅ | ✅ | Tie |
| Secret rotation | Manual | Manual or automatic | Vault |
| Access control | App-level | Row-level (RLS) | Vault |
| Audit logging | ❌ | ✅ | Vault |
| **Operations** | | | |
| Simplicity | ✅ Simple | ⚠️ Complex | Fly.io |
| Boot time | ✅ Fast | ⚠️ Slower | Fly.io |
| Database dependency | ✅ None | ⚠️ Required | Fly.io |
| CLI management | ✅ `fly secrets` | ⚠️ SQL or API | Fly.io |
| Multi-service | ⚠️ Duplicate | ✅ Shared | Vault |
| **Cost** | | | |
| Supabase tier | Free tier OK | Pro tier required | Fly.io |
| Development effort | None | High | Fly.io |
| **Compliance** | | | |
| SOC2 audit trail | ❌ | ✅ | Vault |
| Secret versioning | ❌ | ✅ | Vault |
| Least privilege | App-level | Query-level | Vault |

---

## Cost Analysis

### Current Approach (Fly.io Secrets)

- **Supabase Plan**: Free or Pro ($25/month) - not affected by secrets
- **Fly.io**: Included in app hosting costs
- **Development Time**: 0 hours (already implemented)
- **Operational Overhead**: Low - standard pattern

**Total Cost**: $0 incremental

### Supabase Vault Approach

- **Supabase Plan**: Pro required ($25/month minimum) - Vault requires `pgsodium` extension
- **Development Time**: ~16-24 hours
  - 4 hours: Migration planning and testing
  - 8 hours: Code refactoring (all credential loading)
  - 4 hours: RLS policy setup and testing
  - 2 hours: Audit logging implementation
  - 2 hours: Documentation updates
  - 2-4 hours: Bug fixes and edge cases
- **Operational Overhead**: Higher - more complex debugging, testing

**One-time Cost**: $2,000 - $3,000 (at $120/hour developer rate)
**Ongoing Cost**: Potentially $25/month if not already on Pro plan

---

## Migration Path (If Proceeding)

### Phase 1: Preparation (Week 1)

1. **Verify Vault availability**

   ```sql
   -- Check if pgsodium is available
   SELECT * FROM pg_available_extensions WHERE name = 'pgsodium';

   -- Enable if available
   CREATE EXTENSION IF NOT EXISTS pgsodium;
   CREATE EXTENSION IF NOT EXISTS supabase_vault;
   ```

2. **Create secrets table structure**

   ```sql
   -- Vault creates these tables automatically:
   -- vault.secrets (encrypted storage)
   -- vault.decrypted_secrets (view with decrypted data)
   ```

3. **Set up RLS policies**

   ```sql
   -- Only service role can read secrets
   CREATE POLICY "Service role reads secrets"
     ON vault.secrets FOR SELECT
     USING (auth.role() = 'service_role');
   ```

### Phase 2: Migration (Week 2)

1. **Migrate one secret at a time**

   Start with non-critical secret (e.g., Deepgram API key):

   ```sql
   INSERT INTO vault.secrets (name, secret)
   VALUES ('deepgram_api_key', 'current_value_from_fly_secrets');
   ```

2. **Update application code**

   Create helper function:

   ```typescript
   // apps/captionacc-web/app/services/vault.server.ts
   const secretCache = new Map<string, { value: string; expiry: number }>()

   export async function getVaultSecret(name: string): Promise<string> {
     // Check cache (5-minute TTL to avoid DB hits)
     const cached = secretCache.get(name)
     if (cached && cached.expiry > Date.now()) {
       return cached.value
     }

     // Query Vault
     const supabase = createServerSupabaseClient()
     const { data, error } = await supabase
       .from('vault.decrypted_secrets')
       .select('decrypted_secret')
       .eq('name', name)
       .single()

     if (error || !data) {
       throw new Error(`Failed to read secret: ${name}`)
     }

     // Cache for 5 minutes
     secretCache.set(name, {
       value: data.decrypted_secret,
       expiry: Date.now() + 5 * 60 * 1000,
     })

     return data.decrypted_secret
   }
   ```

3. **Replace environment variable reads**

   ```typescript
   // Before
   const deepgramApiKey = process.env.DEEPGRAM_API_KEY

   // After
   const deepgramApiKey = await getVaultSecret('deepgram_api_key')
   ```

4. **Test thoroughly in staging**

   - Verify secret reads work
   - Test with expired cache
   - Verify RLS blocks unauthorized access
   - Test database connection failure handling

5. **Deploy to production**

   - Deploy new code
   - Verify secret reads from Vault
   - Keep Fly.io secret as fallback for 1 week
   - Monitor error logs

6. **Remove Fly.io secret**

   After 1 week of successful operation:

   ```bash
   fly secrets unset DEEPGRAM_API_KEY
   ```

### Phase 3: Full Migration (Week 3-4)

Repeat Phase 2 for remaining secrets:
- Wasabi READ-ONLY keys
- Wasabi READ-WRITE keys
- Prefect API key
- Google Cloud credentials (if applicable)

### Phase 4: Operations

1. **Document rotation procedure**

   ```sql
   -- Rotate secret (keeps version history)
   UPDATE vault.secrets
   SET secret = 'new_secret_value',
       updated_at = NOW()
   WHERE name = 'wasabi_access_key_readonly';

   -- No application restart needed! Cache expires in 5 minutes.
   ```

2. **Set up audit log monitoring**

   ```sql
   -- Weekly audit: Who accessed which secrets?
   SELECT
     secret_name,
     COUNT(*) as access_count,
     COUNT(DISTINCT accessed_by) as unique_accessors
   FROM vault_audit_log
   WHERE accessed_at > NOW() - INTERVAL '7 days'
   GROUP BY secret_name
   ORDER BY access_count DESC;
   ```

---

## Security Considerations

### Vault Security Model

**Encryption layers**:
1. **Secrets table**: Encrypted at rest with pgsodium
2. **Database**: Encrypted at rest (Supabase default)
3. **Transit**: TLS for all connections

**Access control**:
- **RLS policies**: Enforce who can read which secrets
- **Service role only**: Application uses service role key
- **Audit logging**: Track all secret access

**Threat**: Database compromise
- **Mitigation**: Secrets encrypted with separate key (pgsodium key derivation)
- **Residual risk**: If database AND encryption key compromised, secrets exposed

**Threat**: SQL injection
- **Mitigation**: Parameterized queries prevent injection
- **Residual risk**: RLS bugs could leak secrets

### Fly.io Secrets Security Model

**Encryption layers**:
1. **Secrets storage**: Encrypted at rest by Fly.io
2. **Environment injection**: Secrets loaded into app memory at boot
3. **Transit**: TLS for Fly.io API

**Access control**:
- **Fly.io API**: Org-level permissions
- **No audit log**: Can't track who read which secret

**Threat**: Process memory dump
- **Mitigation**: Secrets only in app memory, not logged
- **Residual risk**: Root access to container exposes all environment variables

**Threat**: Fly.io compromise
- **Mitigation**: Trust Fly.io's security practices
- **Residual risk**: Fly.io data breach exposes secrets

### Risk Comparison

Both approaches have similar security profiles. The main differences:

| Risk | Fly.io Secrets | Supabase Vault |
|------|----------------|----------------|
| Credential exposure | App compromise | App compromise |
| Audit trail | None | Full logging |
| Blast radius | All env vars | Only queried secrets |
| Rotation complexity | Redeploy required | No redeploy |

**Verdict**: Vault provides marginal security improvement through audit logging and reduced blast radius, but both are secure for current threat model.

---

## Recommendation

### **Current State: Stick with Fly.io Secrets**

**Reasoning**:
1. ✅ **Adequate security** - Fly.io Secrets meets current security requirements
2. ✅ **Operational simplicity** - Well-understood, minimal dependencies
3. ✅ **Cost-effective** - No migration effort, no ongoing complexity
4. ✅ **Fast boot time** - No database dependency during startup

### **Future State: Consider Vault When...**

Revisit this decision if any of these occur:

**Compliance Requirements**:
- SOC2 Type II certification needed (audit logging required)
- ISO27001 compliance (secret versioning required)
- Customer contracts demand secret access logs

**Operational Complexity**:
- Managing 10+ services with shared secrets
- Frequent credential rotation (weekly+ instead of quarterly)
- Need for automated rotation workflows

**Security Incidents**:
- Breach requires forensic audit of secret access
- Need to prove which systems accessed which credentials when

### **Hybrid Approach** (Recommended for Future)

If you do migrate, consider **selective migration**:

**Keep in Fly.io Secrets**:
- Database connection strings (needed at boot)
- Supabase service role key (needed to access Vault!)
- Critical bootstrap credentials

**Move to Vault**:
- Third-party API keys (Deepgram, Wasabi)
- Non-critical service credentials
- Frequently rotated secrets

This reduces blast radius while maintaining operational simplicity.

---

## Testing Checklist (If Migrating)

### Pre-Migration Testing

- [ ] Verify Supabase plan supports Vault (Pro or higher)
- [ ] Test Vault extension installation in staging
- [ ] Create test secrets and verify encryption
- [ ] Test RLS policies block unauthorized access
- [ ] Benchmark secret read latency (<50ms acceptable)

### Code Migration Testing

- [ ] Unit tests pass with Vault secrets
- [ ] Integration tests with real Vault
- [ ] Load testing (1000 req/s with secret reads)
- [ ] Failure modes: database down, cache expired, invalid secret

### Security Testing

- [ ] Verify secrets encrypted at rest (inspect database)
- [ ] Test RLS prevents cross-tenant secret access
- [ ] Verify audit log captures all reads
- [ ] Test secret rotation doesn't break active sessions

### Production Readiness

- [ ] Runbook for Vault outage (fallback to Fly.io?)
- [ ] Monitoring for secret read failures
- [ ] Alerting for audit log anomalies
- [ ] Documentation for future developers

---

## Conclusion

**Stick with Fly.io Secrets** for now. The security, operational, and cost benefits of Supabase Vault don't justify the migration effort given:

1. Current architecture is secure with multi-layer defense
2. No active compliance requirements demanding audit logs
3. Manual quarterly rotation is acceptable overhead
4. Operational simplicity is valuable for small team

**Re-evaluate in Q3 2026** or when compliance/operational needs change.

---

**Last Updated**: 2026-01-07
**Author**: Platform Admin Team
**Next Review**: 2026-07-01
