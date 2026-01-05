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
Health check

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
    "by_file_size": 900
  },
  "limiting_factor": "height",
  "estimated_file_size_mb": 14.2
}
```

### `POST /ocr/batch`
Process batch of images

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

# Get capacity for 666×64 images
curl -X POST http://localhost:8000/capacity \
  -H "Content-Type: application/json" \
  -d '{"width": 666, "height": 64}'
```

## Architecture

1. Client calls `/capacity` to determine batch size
2. Client sends batch of images to `/ocr/batch`
3. Service creates vertical montage
4. Service calls Google Cloud Vision API
5. Service parses results and maps characters back to original images
6. Client receives structured results per image

## Notes

- All images in a batch must have identical dimensions
- Service is stateless - no data persistence
- Async processing for non-blocking API calls
- Character coordinates are relative to original image, not montage
