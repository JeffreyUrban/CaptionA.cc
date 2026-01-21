# Wasabi CORS Configuration

CORS configs for Wasabi S3 buckets to allow browser uploads/downloads.

## Apply Configuration

```bash
# Production bucket (captionacc-prod)
aws s3api put-bucket-cors \
  --bucket captionacc-prod \
  --cors-configuration file://wasabi-cors-config-prod.json \
  --endpoint-url https://s3.us-east-1.wasabisys.com

# Development bucket (captionacc-dev)
aws s3api put-bucket-cors \
  --bucket captionacc-dev \
  --cors-configuration file://wasabi-cors-config-dev.json \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```

## Verify Configuration

```bash
aws s3api get-bucket-cors \
  --bucket captionacc-prod \
  --endpoint-url https://s3.us-east-1.wasabisys.com
```

## Allowed Origins

**Production** (`wasabi-cors-config-prod.json`):
- `https://captionacc-web-prod.fly.dev`
- `https://captiona.cc`
- `http://localhost:5173-5175` (local dev)

**Development** (`wasabi-cors-config-dev.json`):
- `https://captionacc-web-dev.fly.dev`
- `http://localhost:5173-5175` (local dev)
