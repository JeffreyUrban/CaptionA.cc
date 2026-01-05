#!/usr/bin/env python3
"""Test different montage layouts for cropped frames.

Compares vertical stacking vs grid layouts to see which is more robust for OCR.
"""

import argparse
import json
import sqlite3
from io import BytesIO
from pathlib import Path
from typing import List, Tuple

from PIL import Image

try:
    import time

    from google.cloud import vision

    GOOGLE_CLOUD_AVAILABLE = True
except ImportError:
    GOOGLE_CLOUD_AVAILABLE = False


def load_cropped_frames(db_path: Path, frame_indices: List[int]) -> List[Tuple[int, bytes, int, int]]:
    """Load specific cropped frames from database."""
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        placeholders = ",".join("?" * len(frame_indices))
        cursor.execute(
            f"""
            SELECT frame_index, image_data, width, height
            FROM cropped_frames
            WHERE frame_index IN ({placeholders})
            ORDER BY frame_index
        """,
            frame_indices,
        )
        return cursor.fetchall()
    finally:
        conn.close()


def create_vertical_stack(frames: List[Tuple], separator_px: int = 2) -> bytes:
    """Create vertical stack (1×N grid)."""
    if not frames:
        raise ValueError("frames list cannot be empty")

    width = frames[0][2]
    total_height = sum(f[3] for f in frames) + (len(frames) - 1) * separator_px

    montage = Image.new("RGB", (width, total_height), (220, 220, 220))

    y_offset = 0
    for frame_idx, image_data, w, h in frames:
        img = Image.open(BytesIO(image_data))
        montage.paste(img, (0, y_offset))
        y_offset += h + separator_px

    buffer = BytesIO()
    montage.save(buffer, format="JPEG", quality=95)
    return buffer.getvalue()


def create_grid(frames: List[Tuple], cols: int, separator_px: int = 2) -> bytes:
    """Create grid layout (MxN)."""
    if not frames:
        raise ValueError("frames list cannot be empty")

    rows = (len(frames) + cols - 1) // cols
    frame_w = frames[0][2]
    frame_h = frames[0][3]

    width = (frame_w * cols) + (separator_px * (cols - 1))
    height = (frame_h * rows) + (separator_px * (rows - 1))

    montage = Image.new("RGB", (width, height), (220, 220, 220))

    for i, (frame_idx, image_data, w, h) in enumerate(frames):
        row = i // cols
        col = i % cols

        x = col * (frame_w + separator_px)
        y = row * (frame_h + separator_px)

        img = Image.open(BytesIO(image_data))
        montage.paste(img, (x, y))

    buffer = BytesIO()
    montage.save(buffer, format="JPEG", quality=95)
    return buffer.getvalue()


def call_gcp_vision(image_bytes: bytes) -> dict:
    """Call Google Cloud Vision API."""
    if not GOOGLE_CLOUD_AVAILABLE:
        raise RuntimeError("google-cloud-vision not available")

    client = vision.ImageAnnotatorClient()
    image = vision.Image(content=image_bytes)

    start = time.time()
    response = client.document_text_detection(image=image, image_context={"language_hints": ["zh"]})
    elapsed_ms = (time.time() - start) * 1000

    symbols = []
    if response.full_text_annotation:
        for page in response.full_text_annotation.pages:
            for block in page.blocks:
                for paragraph in block.paragraphs:
                    for word in paragraph.words:
                        for symbol in word.symbols:
                            vertices = symbol.bounding_box.vertices
                            x = min(v.x for v in vertices)
                            y = min(v.y for v in vertices)
                            w = max(v.x for v in vertices) - x
                            h = max(v.y for v in vertices) - y
                            symbols.append({"text": symbol.text, "bbox": (x, y, w, h)})

    return {
        "processing_time_ms": elapsed_ms,
        "char_count": len(symbols),
        "text": "".join(s["text"] for s in symbols),
        "symbols": symbols,
    }


def main():
    parser = argparse.ArgumentParser(description="Test cropped frame montage layouts")
    parser.add_argument("--selection-json", type=Path, default=Path("selected-cropped-frames.json"))
    parser.add_argument(
        "--layouts",
        nargs="+",
        default=["1x50", "2x25", "5x10", "10x5", "25x2", "50x1"],
        help="Layouts to test in format: COLSxROWS (default: 1x50 2x25 5x10 10x5 25x2 50x1)",
    )
    parser.add_argument("--montage-dir", type=Path, default=Path("./cropped-layouts"))
    parser.add_argument("--call-api", action="store_true")
    parser.add_argument("--output-file", type=Path, default=Path("./cropped-layouts-results.json"))

    args = parser.parse_args()

    # Load frame selection
    with open(args.selection_json) as f:
        selection = json.load(f)

    video_id = selection["video_id"]
    cropping_db = Path(selection["cropping_db"])
    frame_indices = selection["frame_indices"]

    print("Testing cropped frame layouts")
    print("=" * 80)
    print(f"Video: {video_id}")
    print(f"Frame count: {len(frame_indices)}")
    print(f"Frame range: {min(frame_indices)} to {max(frame_indices)}")
    print()

    # Load frames
    print("Loading cropped frames from confirmed text captions...")
    frames = load_cropped_frames(cropping_db, frame_indices)
    print(f"  Loaded {len(frames)} frames")
    if frames:
        print(f"  Frame size: {frames[0][2]}×{frames[0][3]}px")
    print()

    args.montage_dir.mkdir(parents=True, exist_ok=True)

    results = {}

    for layout_str in args.layouts:
        cols, rows = map(int, layout_str.split("x"))
        frames_needed = cols * rows

        if frames_needed > len(frames):
            print(f"⚠️  Skipping {layout_str} (need {frames_needed} frames, have {len(frames)})")
            continue

        layout_type = "vertical" if cols == 1 else ("horizontal" if rows == 1 else "grid")

        print(f"Testing {layout_str} layout ({layout_type})")
        print("-" * 80)

        # Create montage
        frames_subset = frames[:frames_needed]

        if cols == 1:
            # Vertical stack
            montage_bytes = create_vertical_stack(frames_subset)
        elif rows == 1:
            # Horizontal stack (treat as grid with 1 row)
            montage_bytes = create_grid(frames_subset, cols=cols)
        else:
            # Grid
            montage_bytes = create_grid(frames_subset, cols=cols)

        # Save montage
        montage_path = args.montage_dir / f"layout_{layout_str}.jpg"
        with open(montage_path, "wb") as f:
            f.write(montage_bytes)

        print(f"  Saved: {montage_path}")
        print(f"  Size: {len(montage_bytes):,} bytes ({len(montage_bytes) / 1024 / 1024:.2f}MB)")

        result = {
            "layout": layout_str,
            "layout_type": layout_type,
            "cols": cols,
            "rows": rows,
            "frames_used": frames_needed,
            "montage_path": str(montage_path),
            "montage_size_bytes": len(montage_bytes),
        }

        # Call API if requested
        if args.call_api:
            if not GOOGLE_CLOUD_AVAILABLE:
                print("  ⚠️  Skipping API call (google-cloud-vision not available)")
            else:
                print("  Calling Google Cloud Vision API...")
                try:
                    gcp_result = call_gcp_vision(montage_bytes)
                    result["gcp"] = gcp_result

                    print(f"  Characters detected: {gcp_result['char_count']}")
                    print(f"  Processing time: {gcp_result['processing_time_ms']:.0f}ms")
                    print(f"  Chars/frame: {gcp_result['char_count'] / frames_needed:.1f}")
                except Exception as e:
                    print(f"  ERROR: {e}")
                    result["error"] = str(e)

        results[layout_str] = result
        print()

    # Save results
    with open(args.output_file, "w") as f:
        json.dump(results, f, indent=2)

    print("=" * 80)
    print(f"Results saved to: {args.output_file}")

    if args.call_api and GOOGLE_CLOUD_AVAILABLE:
        print()
        print("COMPARISON:")
        print(f"{'Layout':<10} | {'Type':<12} | {'Chars':<8} | {'Chars/Frame':<12} | {'Time (ms)':<10}")
        print("-" * 70)

        for layout_str, result in sorted(results.items()):
            if "gcp" in result:
                gcp = result["gcp"]
                chars_per_frame = gcp["char_count"] / result["frames_used"]
                print(
                    f"{layout_str:<10} | {result['layout_type']:<12} | {gcp['char_count']:<8} | "
                    f"{chars_per_frame:<12.1f} | {gcp['processing_time_ms']:<10.0f}"
                )

        # Find best vertical vs best grid
        vertical_results = {k: v for k, v in results.items() if v["layout_type"] == "vertical" and "gcp" in v}
        grid_results = {k: v for k, v in results.items() if v["layout_type"] == "grid" and "gcp" in v}
        horizontal_results = {k: v for k, v in results.items() if v["layout_type"] == "horizontal" and "gcp" in v}

        print()
        print("CONCLUSION:")
        if vertical_results:
            best_vert = max(vertical_results.items(), key=lambda x: x[1]["gcp"]["char_count"])
            print(f"  Best vertical: {best_vert[0]} ({best_vert[1]['gcp']['char_count']} chars)")

        if horizontal_results:
            best_horz = max(horizontal_results.items(), key=lambda x: x[1]["gcp"]["char_count"])
            print(f"  Best horizontal: {best_horz[0]} ({best_horz[1]['gcp']['char_count']} chars)")

        if grid_results:
            best_grid = max(grid_results.items(), key=lambda x: x[1]["gcp"]["char_count"])
            print(f"  Best grid: {best_grid[0]} ({best_grid[1]['gcp']['char_count']} chars)")

    return 0


if __name__ == "__main__":
    exit(main())
