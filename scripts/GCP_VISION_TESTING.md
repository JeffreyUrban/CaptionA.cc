# Google Cloud Vision OCR Montage Testing

# TODO: The database details in this file are out of date. 

This directory contains scripts for testing Google Cloud Vision Document Text Detection API with different caption crop packing densities.

## Prerequisites

### 1. Install Google Cloud Vision SDK

```bash
uv pip install google-cloud-vision
```

### 2. Set up Google Cloud Credentials

You need to authenticate with Google Cloud to use the Vision API.

**Option A: Service Account (Recommended for testing)**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the Cloud Vision API
4. Create a service account and download the JSON key file
5. Set the environment variable:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"
```

**Option B: Application Default Credentials**

```bash
gcloud auth application-default login
```

### 3. Enable Billing

Google Cloud Vision requires billing to be enabled (though you get 1,000 free units/month).

- First 1,000 units/month: **Free**
- 1,001 - 5,000,000 units/month: **$1.50 per 1,000 units**
- 5,000,000+ units/month: **$0.60 per 1,000 units**

## Usage

### Test a Single Video

Test one video with specific packing densities:

```bash
python scripts/test-gcp-vision-montage.py \
    !__local/data/_has_been_deprecated__!/02/025780e3-f936-43c4-b988-134182783993 \
    --densities 10 25 50 \
    --max-frames 100 \
    --output-dir ./test-results
```

**Arguments:**
- `video_dir`: Path to video directory
- `--densities`: Number of crops per montage to test (default: 10 25 50)
- `--max-frames`: Limit number of frames to process (default: all)
- `--output-dir`: Where to save JSON results (default: no output)

### Test Multiple Videos

Run batch test on multiple videos:

```bash
./scripts/test-gcp-vision-batch.sh 100 ./ocr-test-results
```

**Arguments:**
- `MAX_FRAMES`: Maximum frames per video (default: 100)
- `OUTPUT_DIR`: Output directory (default: ./ocr-test-results)

The script will:
2. Test densities: 10, 25, 50, 75, 100 crops/montage
3. Save results to `OUTPUT_DIR/`

## What the Scripts Do

### 1. Create Montages

For each packing density (e.g., 25 crops/montage):
- Load cropped frames
- Stack them vertically with thin separator lines
- Create JPEG montages

Example: 25 crops/montage
```
┌─────────────────────┐
│ Crop 1 (frame 0000) │
├─────────────────────┤ ← 2px separator
│ Crop 2 (frame 0001) │
├─────────────────────┤
│ Crop 3 (frame 0002) │
├─────────────────────┤
│       ...           │
├─────────────────────┤
│ Crop 25 (frame 0024)│
└─────────────────────┘
```

### 2. Call Google Cloud Vision API

For each montage:
- Call `document_text_detection()` (gets character-level bounding boxes)
- Extract symbols (characters) with coordinates
- Map symbols back to original crop coordinates

### 3. Calculate Metrics

For each density, calculate:
- **API units used**: Number of montages
- **Total cost**: `(units / 1000) × $1.50`
- **Cost per frame**: Total cost / number of frames
- **Cost savings**: Percentage saved vs individual API calls
- **Processing time**: Average API response time
- **Symbols detected**: Total characters found

## Understanding Results

### Console Output

```
--- Testing density: 25 crops/montage ---

  Created 120 montages
  Average 25.0 crops/montage
  Calling Google Cloud Vision API...
    Processed 10/120 montages...
    ...

  Results:
    API units used: 120
    Total cost: $0.1800
    Cost per frame: $0.000060
    Cost savings: 96.0%
    Total symbols: 45,230
    Avg API time: 1,247.3ms
```

### JSON Output

Results are saved to `OUTPUT_DIR/{video_id}_montage_test.json`:

```json
{
  "video_dir": "!__local/data/_has_been_deprecated__!/02/025780e3-f936-43c4-b988-134182783993",
  "total_frames": 3000,
  "frame_width": 1920,
  "frame_height": 200,
  "densities": {
    "10": {
      "crops_per_montage": 10,
      "num_montages": 300,
      "api_units_used": 300,
      "total_cost_usd": 0.45,
      "cost_per_frame_usd": 0.00015,
      "cost_savings_vs_individual": 90.0,
      "total_symbols_detected": 48234,
      "avg_processing_time_ms": 856.2
    },
    "25": {
      ...
    }
  }
}
```

## Cost Analysis Example

**Scenario**: 3,000 caption crops

| Approach | API Units | Cost | Savings |
|----------|-----------|------|---------|
| Individual (1 crop/call) | 3,000 | $4.50 | 0% |
| Montage (10 crops/call) | 300 | $0.45 | 90% |
| Montage (25 crops/call) | 120 | $0.18 | 96% |
| Montage (50 crops/call) | 60 | $0.09 | 98% |
| Montage (100 crops/call) | 30 | $0.045 | 99% |

## Next Steps

After running the tests:

1. **Analyze cost vs accuracy trade-off**
   - Higher density = lower cost
   - But does OCR quality degrade?

2. **Compare with ocrmac baseline**
   - Check character accuracy
   - Verify bounding box precision

3. **Optimize packing density**
   - Find sweet spot for your use case
   - Balance cost, accuracy, and text size

4. **Production deployment**
   - Implement montage pipeline
   - Add error handling and retries
   - Set up async batch processing

## Troubleshooting

### "google-cloud-vision not installed"

```bash
uv pip install google-cloud-vision
```

### "Could not automatically determine credentials"

Set up authentication:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

Or:
```bash
gcloud auth application-default login
```

### "Permission denied" errors

Make scripts executable:
```bash
chmod +x scripts/test-gcp-vision-montage.py
chmod +x scripts/test-gcp-vision-batch.sh
```

## API Limits

Google Cloud Vision API quotas (default):
- **Requests per minute**: 1,800
- **Requests per day**: Unlimited (billed)

For batch processing many videos, consider:
- Adding delays between API calls
- Using async batch API (`async_batch_annotate_images`)
- Monitoring quota usage in Cloud Console

## Cost Estimation

To estimate costs for your full dataset:

```python
total_crops = 100_000  # Your total caption crops
density = 50  # Crops per montage

api_units = total_crops / density
cost_usd = (api_units / 1000) * 1.50

print(f"Estimated cost: ${cost_usd:.2f}")
# Output: Estimated cost: $3.00
```

Compare to individual API calls:
```python
individual_cost = (total_crops / 1000) * 1.50
print(f"Individual cost: ${individual_cost:.2f}")
# Output: Individual cost: $150.00

savings = 100 * (1 - (cost_usd / individual_cost))
print(f"Savings: {savings:.1f}%")
# Output: Savings: 98.0%
```
