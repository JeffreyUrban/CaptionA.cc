# GPU Video Utils

GPU-accelerated video processing utilities using PyNvVideoCodec.

## Features

- **GPUVideoDecoder**: Wrapper around PyNvVideoCodec for efficient GPU video decoding
- **Frame Extraction**: Extract frames at arbitrary frame rates with precise timing
- **Montage Capacity**: Calculate optimal batch sizes for montage assembly

## Requirements

- NVIDIA GPU with CUDA support
- PyTorch with CUDA
- PyNvVideoCodec

## Usage

```python
from gpu_video_utils import GPUVideoDecoder, extract_frames_gpu

# Extract frames from video on GPU
frames = extract_frames_gpu(
    video_path="video.mp4",
    frame_rate_hz=10.0,
    output_format="jpeg_bytes"
)
```

## Shared Utilities

This package contains shared GPU video processing code used by:
- `inference_pipelined` (caption frame extents inference)
- `full_frames` (full frame OCR processing)
