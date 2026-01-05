# OCR Batch Processing Service

Independent microservice for batch OCR processing using vertical montage stacking.

> **Part of CaptionA.cc monorepo** - See [MONOREPO.md](docs/MONOREPO.md) for deployment workflow

## Overview

This service provides character-level OCR for batches of identically-dimensioned images. It automatically optimizes batching using vertical stacking and returns structured results mapped back to individual images.

**Deployment**: Fly.io with automatic scale-to-zero
**Cost**: ~$0-5/month (only when processing)
**Auto-deploy**: When files in `services/ocr-service/` change

## Key Features

- **Dimension-agnostic**: Works with any image dimensions (cropped captions, full frames, etc.)
- **Automatic optimization**: Calculates safe batch sizes based on image dimensions
- **Efficient batching**: Uses vertical montage stacking for cost optimization (99%+ savings)
- **Character-level results**: Returns bounding boxes for each character
- **Simple API**: Clean REST interface, no video-specific logic

## API Endpoints

### `GET /`
Basic health check

**Response:**
```json
{
  "service": "OCR Batch Processing Service",
  "version": "2.0.0",
  "status": "healthy",
  "google_cloud_available": true
}
```

### `GET /health`
Detailed health check with system status

**Response includes:**
- Circuit breaker state
- Job storage statistics
- Rate limit usage
- Current configuration

### `GET /usage`
Get rate limit usage statistics

**Response:**
```json
{
  "usage": {
    "jobs_last_minute": 3,
    "jobs_last_hour": 45,
    "jobs_today": 127
  },
  "limits": {
    "per_minute": 10,
    "per_hour": 100,
    "per_day": 1000
  }
}
```

### `POST /capacity`
Calculate maximum batch size for given dimensions

**Request:**
```json
{
  "width": 666,
  "height": 64
}
```

**Response:**
```json
{
  "max_images": 757,
  "limits": {
    "by_height": 757,
    "by_pixels": 1171,
    "by_file_size": 900,
    "by_config": 950
  },
  "limiting_factor": "height",
  "estimated_file_size_mb": 14.2
}
```

### `POST /ocr/jobs`
Submit OCR job for async processing

**Request:**
```json
{
  "images": [
    {
      "id": "frame_255",
      "data": "<base64 encoded image bytes>"
    },
    {
      "id": "frame_1204",
      "data": "<base64 encoded image bytes>"
    }
  ]
}
```

**Response:**
```json
{
  "job_id": "a1b2c3d4_1234567890",
  "status": "pending",
  "message": "Job submitted. Poll GET /ocr/jobs/{id} for results."
}
```

**Rate Limiting:**
- Returns `429 Too Many Requests` if rate limits exceeded
- Response includes current usage stats and error message

### `GET /ocr/jobs/{job_id}`
Get job status and results

**Response (pending/processing):**
```json
{
  "job_id": "a1b2c3d4_1234567890",
  "status": "processing",
  "created_at": "2024-01-05T10:30:00",
  "started_at": "2024-01-05T10:30:01",
  "images_count": 50
}
```

**Response (completed):**
```json
{
  "job_id": "a1b2c3d4_1234567890",
  "status": "completed",
  "created_at": "2024-01-05T10:30:00",
  "started_at": "2024-01-05T10:30:01",
  "completed_at": "2024-01-05T10:30:03",
  "processing_time_ms": 1520.5,
  "images_count": 50,
  "result": {
    "results": [
      {
        "id": "frame_255",
        "characters": [
          {
            "text": "欢",
            "bbox": {"x": 10, "y": 5, "width": 20, "height": 25}
          }
        ],
        "text": "欢迎收看江苏卫视",
        "char_count": 8
      }
    ],
    "processing_time_ms": 1520.5,
    "total_characters": 450,
    "images_processed": 50
  }
}
```

**Response (failed):**
```json
{
  "job_id": "a1b2c3d4_1234567890",
  "status": "failed",
  "created_at": "2024-01-05T10:30:00",
  "completed_at": "2024-01-05T10:30:02",
  "images_count": 50,
  "error": "Circuit breaker open: Too many failures"
}
```

## Conservative Limits

The service enforces conservative limits to ensure reliability:

- **Height**: 50,000 pixels (76% of JPEG 65,500px limit)
- **File size**: 15 MB (below GCP's 20MB limit)
- **Total pixels**: 50,000,000

## Installation

```bash
cd services/ocr-service
pip install -r requirements.txt
```

## Running

```bash
# Set Google Cloud credentials
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json

# Run service
python app.py

# Or with uvicorn directly
uvicorn app:app --host 0.0.0.0 --port 8000
```

## Testing

```bash
# Check health
curl http://localhost:8000/

# Check detailed health and configuration
curl http://localhost:8000/health

# Check usage
curl http://localhost:8000/usage

# Get capacity for 666×64 images
curl -X POST http://localhost:8000/capacity \
  -H "Content-Type: application/json" \
  -d '{"width": 666, "height": 64}'

# Run test suite
python test_service.py
```

## Architecture

### Async Job Flow

1. Client calls `/capacity` to determine optimal batch size
2. Client submits job to `/ocr/jobs` → receives `job_id` immediately
3. Service processes job in background:
   - Checks rate limits (rejects if exceeded)
   - Checks circuit breaker (rejects if open)
   - Creates job with deduplication check
   - Builds vertical montage
   - Calls Google Cloud Vision API (wrapped in circuit breaker)
   - Parses results and maps characters back to original images
   - Stores result with TTL (1 hour default)
4. Client polls `/ocr/jobs/{job_id}` until status is `completed`
5. Client retrieves structured results per image

### Cost Protection Layers

1. **Rate Limiting**: 10/min, 100/hour, 1000/day (configurable)
2. **Circuit Breaker**: Stops processing after 5 consecutive failures
3. **Job Deduplication**: Identical image sets return cached results
4. **Request Validation**: Enforces size/dimension limits
5. **TTL Cleanup**: Old jobs auto-expire after 1 hour

## Notes

- All images in a batch must have identical dimensions
- Service is stateless - no data persistence
- Async processing for non-blocking API calls
- Character coordinates are relative to original image, not montage
