# Wasabi Storage Reference

Wasabi S3 provides cost-effective object storage for CaptionA.cc's large files including videos, SQLite databases, and cropped frame chunks.

## Bucket Configuration

| Property | Value |
|----------|-------|
| Bucket Name | `caption-acc-prod` |
| Region | `us-east-1` |
| Endpoint | `https://s3.us-east-1.wasabisys.com` |
| Versioning | Enabled |
| Public Access | Blocked |
| Access Logging | Enabled (→ `audit-logs-caption-acc`) |

### Audit Logs Bucket

| Property | Value |
|----------|-------|
| Bucket Name | `audit-logs-caption-acc` |
| Log Prefix | `caption-acc-prod/` |
| Retention | 90 days (lifecycle policy) |

## Storage Structure

```
caption-acc-prod/
└── {tenant_id}/{video_id}/
    ├── video.mp4                    # Original video
    ├── video.db                     # Full frames database
    ├── fullOCR.db                   # OCR results database
    ├── layout.db                    # Layout annotations database
    ├── captions.db                  # Captions database
    └── cropped_frames_v{version}/   # Versioned cropped frames
        ├── modulo_16/               # Every 16th frame (coarsest)
        │   ├── chunk_0000000000.webm
        │   └── ...
        ├── modulo_4/                # Every 4th frame (except modulo 16 frames)
        └── modulo_1/                # Every frame (except modulo 16 or 4 frames, finest)
```

## Artifacts

### Video Files

| Property | Value |
|----------|-------|
| Filename | `video.mp4` |
| Content Type | `video/mp4` |
| Update Pattern | Immutable (set once at upload) |
| Typical Size | 50 MB - 2 GB+ |

### SQLite Database Files

All databases stored with content type `application/x-sqlite3`.

| Database | Content | Update Pattern | Typical Size |
|----------|---------|----------------|--------------|
| `video.db` | Full frames at 0.1Hz as JPEG blobs | Immutable | 15-70 MB |
| `fullOCR.db` | OCR boxes, text, confidence scores | Occasional (re-run OCR) | 0.5-5 MB |
| `layout.db` | User annotations, crop bounds, trained model | Frequent (annotation sessions) | 0.05-20 MB |
| `captions.db` | Caption boundaries, text, metadata | Frequent (caption editing) | 0.1-2 MB |

### Cropped Frame Chunks

| Property | Value                                                 |
|----------|-------------------------------------------------------|
| Container Format | WebM                                                  |
| Codec | VP9 (hardware-accelerated)                            |
| Content Type | `video/webm`                                          |
| Frame Rate | 10Hz (1 frame per 100ms)                              |
| Frames per Chunk | 32                                                    |
| Naming | `chunk_0000000000.webm`, `chunk_0000000001.webm`, ... |
| Total Size | 50-200 MB per video                                   |

**Modulo Levels (Hierarchical Loading):**

| Level | Frames Included            | Purpose |
|-------|----------------------------|---------|
| `modulo_16` | Every 16th                 | |
| `modulo_4` | Every 4th (excluding 16s)  | |
| `modulo_1` | Every frame (excluding 4s) | Finest detail |

## IAM Configuration

### IAM Users

| User | Purpose | Permissions |
|------|---------|-------------|
| `captionacc-app-readonly` | Web app presigned URLs | ListBucket, GetObject |
| `captionacc-orchestrator` | Video processing | ListBucket, GetObject, PutObject, DeleteObject |

### Environment Variables

```bash
# Read-only credentials (web app)
WASABI_ACCESS_KEY_READONLY=<key>
WASABI_SECRET_KEY_READONLY=<secret>

# Read-write credentials (orchestrator)
WASABI_ACCESS_KEY_READWRITE=<key>
WASABI_SECRET_KEY_READWRITE=<secret>

# Bucket configuration
WASABI_BUCKET=caption-acc-prod
WASABI_REGION=us-east-1
```

## Client Implementations

### Python (Orchestrator)

Location: `services/orchestrator/wasabi_client.py`

```python
from wasabi_client import WasabiClient

client = WasabiClient()

# Upload/download files
client.upload_file(local_path, storage_key, content_type)
client.download_file(storage_key, local_path)

# File operations
client.file_exists(storage_key)
client.delete_file(storage_key)
client.delete_prefix(prefix)  # Delete folder
client.list_files(prefix)
client.get_file_size(storage_key)

# Presigned URLs
url = client.generate_presigned_url(storage_key, expiration=900)

# Path helpers
key = WasabiClient.build_storage_key(tenant_id, video_id, filename)
key = WasabiClient.build_chunk_storage_key(tenant_id, video_id, chunk_type, chunk_index, version, modulo)
prefix = WasabiClient.build_chunk_prefix(tenant_id, video_id, chunk_type, version)
```

### TypeScript (Web App)

Location: `apps/captionacc-web/app/services/wasabi-storage.server.ts`

- AWS SDK v3 S3Client
- Presigned URL generation for browser downloads
- Batch URL generation for efficient frame loading

## Presigned URLs

- **Expiry**: 1 hour (900 seconds default)
- **Permissions**: GetObject only (read-only)
- **Use case**: Browser downloads frames directly from Wasabi

**URL Generation Endpoints:**
- Single URL: `/api/frames/{videoId}/{frameIndex}.jpg`
- Batch URLs: `/api/frames/{videoId}/batch-signed-urls?indices=0,32,64,...`

## Security

- **Versioning**: Enabled for recovery from accidental deletes
- **Encryption**: Server-side (Wasabi default)
- **Public Access**: Blocked at bucket level
- **Access Logging**: 90-day retention
- **Credential Rotation**: Every 90 days (documented in `/docs/wasabi/CREDENTIAL_ROTATION.md`)

## Related Documentation

- `/docs/wasabi/README.md` - Security architecture overview
- `/docs/wasabi/BUCKET_CONFIGURATION.md` - Logging and lifecycle setup
- `/docs/wasabi/CREDENTIAL_ROTATION.md` - 90-day rotation process
- `/services/orchestrator/WASABI_ARCHITECTURE.md` - Storage structure overview
