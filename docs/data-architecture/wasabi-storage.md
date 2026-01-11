# Wasabi Storage Configuration

Operational configuration for Wasabi S3. For storage structure and file formats, see [README.md](./README.md). For database schemas, see [sqlite-databases.md](./sqlite-databases.md).

## Bucket Configuration

| Property | Value |
|----------|-------|
| Bucket Name | `caption-acc-prod` |
| Region | `us-east-1` |
| Endpoint | `https://s3.us-east-1.wasabisys.com` |
| Versioning | Enabled (corruption recovery) |
| Public Access | Blocked |
| Access Logging | Enabled |

### Audit Logs Bucket

| Property | Value |
|----------|-------|
| Bucket Name | `audit-logs-caption-acc` |
| Log Prefix | `caption-acc-prod/` |
| Retention | 90 days (lifecycle policy) |

## IAM Users

| User | Purpose | Permissions |
|------|---------|-------------|
| `captionacc-app-readonly` | API server presigned URLs | ListBucket, GetObject |
| `captionacc-orchestrator` | Video processing pipelines | ListBucket, GetObject, PutObject, DeleteObject |

## Environment Variables

```bash
# Read-only credentials (API server)
WASABI_ACCESS_KEY_READONLY=<key>
WASABI_SECRET_KEY_READONLY=<secret>

# Read-write credentials (orchestrator)
WASABI_ACCESS_KEY_READWRITE=<key>
WASABI_SECRET_KEY_READWRITE=<secret>

# Bucket configuration
WASABI_BUCKET=caption-acc-prod
WASABI_REGION=us-east-1
```

## Security

- **Versioning**: Enabled for corruption recovery
- **Encryption**: Server-side (Wasabi default)
- **Public Access**: Blocked at bucket level
- **Access Logging**: 90-day retention
- **Credential Rotation**: Every 90 days

## Client Implementations

| Service | Location |
|---------|----------|
| Python (Orchestrator) | `services/orchestrator/wasabi_client.py` |
| TypeScript (API) | `apps/captionacc-web/app/services/wasabi-storage.server.ts` |

## Related Documentation

- [README.md](./README.md) - Storage paths and data flow
- [sqlite-databases.md](./sqlite-databases.md) - Database schemas
- [sync-protocol.md](./sync-protocol.md) - Wasabi upload triggers
- `/docs/wasabi/CREDENTIAL_ROTATION.md` - 90-day rotation process
- `/docs/wasabi/BUCKET_CONFIGURATION.md` - Logging and lifecycle setup
