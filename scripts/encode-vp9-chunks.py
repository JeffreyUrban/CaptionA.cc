#!/usr/bin/env python3
"""
Encode video frames into VP9 chunks for Wasabi storage testing.

This script:
1. Reads cropped frames from SQLite database
2. Organizes frames by modulo level [16, 4, 1]
3. Encodes frames into WebM VP9 chunks (32 frames per chunk)
4. Uploads chunks to Wasabi
5. Generates HTML test page for browser performance validation

Modulo structure (hybrid duplication):
- modulo_16: frames where index % 16 == 0
- modulo_4: frames where index % 4 == 0 AND index % 16 != 0
- modulo_1: ALL frames (32 frames per chunk)

Usage:
    python scripts/encode-vp9-chunks.py --video-id <video_id> [--upload]
"""

import argparse
import json
import os
import sqlite3
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Tuple

import boto3
from dotenv import load_dotenv

load_dotenv()


def get_frames_from_db(db_path: Path) -> List[Tuple[int, bytes, int, int]]:
    """Extract all cropped frames from database.

    Returns:
        List of (frame_index, image_data, width, height) tuples
    """
    print(f"📖 Reading frames from {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT frame_index, image_data, width, height
        FROM cropped_frames
        ORDER BY frame_index
    """)

    frames = cursor.fetchall()
    conn.close()

    print(f"   Found {len(frames)} frames")
    return frames


def organize_frames_by_modulo(
    frames: List[Tuple[int, bytes, int, int]],
) -> Dict[int, List[Tuple[int, bytes, int, int]]]:
    """Organize frames into modulo levels [16, 4, 1].

    Hybrid duplication strategy:
    - modulo_16: frames where index % 16 == 0
    - modulo_4: frames where index % 4 == 0 AND index % 16 != 0
    - modulo_1: ALL frames

    Returns:
        Dict mapping modulo level to list of frames
    """
    organized = {16: [], 4: [], 1: []}

    for frame in frames:
        frame_index = frame[0]

        # modulo_1 gets ALL frames
        organized[1].append(frame)

        # modulo_4 gets frames divisible by 4 (but not by 16)
        if frame_index % 4 == 0 and frame_index % 16 != 0:
            organized[4].append(frame)

        # modulo_16 gets frames divisible by 16
        if frame_index % 16 == 0:
            organized[16].append(frame)

    print("\n📊 Frame distribution:")
    print(f"   modulo_16: {len(organized[16])} frames")
    print(f"   modulo_4:  {len(organized[4])} frames")
    print(f"   modulo_1:  {len(organized[1])} frames")

    return organized


def write_frames_to_temp_dir(frames: List[Tuple[int, bytes, int, int]], temp_dir: Path) -> Tuple[int, int]:
    """Write frames as JPEG files to temporary directory.

    Returns:
        (width, height) of first frame

    Raises:
        ValueError: If frames list is empty
    """
    if not frames:
        raise ValueError("Cannot write frames: frames list is empty")

    width, height = None, None

    for i, (frame_index, image_data, w, h) in enumerate(frames):
        if width is None:
            width, height = w, h

        frame_path = temp_dir / f"frame_{i:06d}.jpg"
        frame_path.write_bytes(image_data)

    assert width is not None and height is not None  # For type checker
    return width, height


def encode_chunk(input_dir: Path, output_path: Path, width: int, height: int) -> None:
    """Encode frames into VP9 WebM chunk using ffmpeg.

    Args:
        input_dir: Directory containing frame_*.jpg files
        output_path: Output .webm file path
        width: Frame width
        height: Frame height
    """
    # VP9 encoding parameters:
    # -c:v libvpx-vp9: VP9 codec
    # -crf 30: Constant quality (0-63, lower = better quality)
    # -b:v 0: Use constant quality mode
    # -row-mt 1: Enable row-based multithreading
    # -g 32: Keyframe interval (match chunk size)
    # -pix_fmt yuv420p: Pixel format for compatibility

    cmd = [
        "ffmpeg",
        "-framerate",
        "10",  # 10 fps (100ms per frame)
        "-pattern_type",
        "glob",
        "-i",
        str(input_dir / "frame_*.jpg"),
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "30",
        "-b:v",
        "0",
        "-row-mt",
        "1",
        "-g",
        "32",
        "-pix_fmt",
        "yuv420p",
        "-y",  # Overwrite output file
        str(output_path),
    ]

    subprocess.run(cmd, check=True, capture_output=True)


def encode_modulo_chunks(
    modulo: int,
    frames: List[Tuple[int, bytes, int, int]],
    output_dir: Path,
    chunk_size: int = 32,
) -> List[Path]:
    """Encode all chunks for a modulo level.

    Args:
        modulo: Modulo level (16, 4, or 1)
        frames: List of frames for this modulo
        output_dir: Directory to write chunks
        chunk_size: Frames per chunk

    Returns:
        List of encoded chunk file paths
    """
    print(f"\n🎬 Encoding modulo_{modulo} chunks ({len(frames)} frames, {chunk_size} frames/chunk)")

    output_dir.mkdir(parents=True, exist_ok=True)
    chunk_paths = []

    # Split frames into chunks
    num_chunks = (len(frames) + chunk_size - 1) // chunk_size

    for chunk_idx in range(num_chunks):
        start_idx = chunk_idx * chunk_size
        end_idx = min(start_idx + chunk_size, len(frames))
        chunk_frames = frames[start_idx:end_idx]

        # Get start frame index for chunk filename
        start_frame_index = chunk_frames[0][0]

        chunk_filename = f"chunk_{start_frame_index:010d}.webm"
        chunk_path = output_dir / chunk_filename

        # Write frames to temp directory
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            width, height = write_frames_to_temp_dir(chunk_frames, temp_path)

            # Encode chunk
            encode_chunk(temp_path, chunk_path, width, height)

        chunk_paths.append(chunk_path)

        file_size_kb = chunk_path.stat().st_size / 1024
        print(f"   ✅ {chunk_filename} ({len(chunk_frames)} frames, {file_size_kb:.1f} KB)")

    return chunk_paths


def upload_to_wasabi(local_path: Path, s3_key: str) -> str:
    """Upload file to Wasabi and return public URL.

    Args:
        local_path: Local file path
        s3_key: S3 object key (path within bucket)

    Returns:
        Public URL to uploaded file
    """
    s3_client = boto3.client(
        "s3",
        endpoint_url=f"https://s3.{os.getenv('WASABI_REGION')}.wasabisys.com",
        aws_access_key_id=os.getenv("WASABI_ACCESS_KEY"),
        aws_secret_access_key=os.getenv("WASABI_SECRET_KEY"),
        region_name=os.getenv("WASABI_REGION"),
    )

    bucket = os.getenv("WASABI_BUCKET")

    s3_client.upload_file(str(local_path), bucket, s3_key, ExtraArgs={"ContentType": "video/webm"})

    # Generate public URL (will use signed URLs in production)
    url = f"https://s3.{os.getenv('WASABI_REGION')}.wasabisys.com/{bucket}/{s3_key}"
    return url


def generate_test_page(video_id: str, modulo_chunks: Dict[int, List[str]], output_path: Path) -> None:
    """Generate HTML test page for browser performance validation.

    Args:
        video_id: Video ID
        modulo_chunks: Dict mapping modulo level to list of Wasabi URLs
        output_path: Path to write HTML file
    """
    # Convert modulo_chunks to JSON string
    chunks_json = json.dumps(modulo_chunks, indent=8)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VP9 Chunk Loading Test - {video_id}</title>
    <style>
        body {{
            font-family: monospace;
            max-width: 1200px;
            margin: 20px auto;
            padding: 20px;
        }}
        .controls {{
            margin-bottom: 20px;
            padding: 15px;
            background: #f0f0f0;
            border-radius: 5px;
        }}
        select, button {{
            margin: 5px;
            padding: 5px 10px;
            font-size: 14px;
        }}
        #canvas {{
            border: 1px solid #ccc;
            max-width: 100%;
        }}
        .metrics {{
            margin-top: 20px;
            padding: 15px;
            background: #e8f5e9;
            border-radius: 5px;
        }}
        .metric {{
            margin: 5px 0;
        }}
        .log {{
            margin-top: 20px;
            padding: 15px;
            background: #f5f5f5;
            border-radius: 5px;
            max-height: 300px;
            overflow-y: auto;
            font-size: 12px;
        }}
    </style>
</head>
<body>
    <h1>VP9 Chunk Loading Test</h1>
    <p>Video ID: <code>{video_id}</code></p>

    <div class="controls">
        <label>Modulo Level:</label>
        <select id="modulo-select">
            <option value="16">modulo_16</option>
            <option value="4">modulo_4</option>
            <option value="1" selected>modulo_1</option>
        </select>

        <label>Chunk:</label>
        <select id="chunk-select"></select>

        <button id="load-btn">Load Chunk</button>
        <button id="play-btn">Play</button>
        <button id="pause-btn">Pause</button>
    </div>

    <canvas id="canvas"></canvas>

    <div class="metrics">
        <div class="metric">Decode Time: <span id="decode-time">-</span></div>
        <div class="metric">Frames Decoded: <span id="frames-decoded">-</span></div>
        <div class="metric">FPS: <span id="fps">-</span></div>
        <div class="metric">Cache Hits: <span id="cache-hits">-</span></div>
    </div>

    <div class="log" id="log"></div>

    <script>
        const CHUNKS = {chunks_json};

        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        const moduloSelect = document.getElementById('modulo-select');
        const chunkSelect = document.getElementById('chunk-select');
        const loadBtn = document.getElementById('load-btn');
        const playBtn = document.getElementById('play-btn');
        const pauseBtn = document.getElementById('pause-btn');

        let decoder = null;
        let frames = [];
        let currentFrameIndex = 0;
        let isPlaying = false;
        let playInterval = null;
        let frameCache = new Map();
        let cacheHits = 0;

        function log(message) {{
            const logDiv = document.getElementById('log');
            const timestamp = new Date().toLocaleTimeString();
            logDiv.innerHTML += `<div>[${{timestamp}}] ${{message}}</div>`;
            logDiv.scrollTop = logDiv.scrollHeight;
        }}

        function updateChunkSelect() {{
            const modulo = moduloSelect.value;
            chunkSelect.innerHTML = '';

            CHUNKS[modulo].forEach((url, idx) => {{
                const option = document.createElement('option');
                option.value = url;
                option.textContent = `Chunk ${{idx}} (${{url.split('/').pop()}})`;
                chunkSelect.appendChild(option);
            }});
        }}

        async function loadChunk() {{
            const url = chunkSelect.value;
            log(`Loading chunk: ${{url.split('/').pop()}}`);

            const startTime = performance.now();

            try {{
                const response = await fetch(url);
                const buffer = await response.arrayBuffer();

                log(`Downloaded ${{(buffer.byteLength / 1024).toFixed(1)}} KB`);

                await decodeChunk(buffer);

                const duration = performance.now() - startTime;
                document.getElementById('decode-time').textContent = `${{duration.toFixed(1)}} ms`;

            }} catch (error) {{
                log(`ERROR: ${{error.message}}`);
            }}
        }}

        async function decodeChunk(buffer) {{
            frames = [];

            if (decoder) {{
                decoder.close();
            }}

            decoder = new VideoDecoder({{
                output: (frame) => {{
                    // Check cache first
                    const cacheKey = `${{moduloSelect.value}}_${{frames.length}}`;
                    if (frameCache.has(cacheKey)) {{
                        cacheHits++;
                        document.getElementById('cache-hits').textContent = cacheHits;
                        frame.close();
                        return;
                    }}

                    frames.push(frame);
                    frameCache.set(cacheKey, frame);

                    if (frames.length === 1) {{
                        canvas.width = frame.displayWidth;
                        canvas.height = frame.displayHeight;
                        renderFrame(frame);
                    }}
                }},
                error: (error) => {{
                    log(`Decode error: ${{error.message}}`);
                }}
            }});

            decoder.configure({{
                codec: 'vp09.00.10.08',
                codedWidth: 1920,
                codedHeight: 1080
            }});

            // Create EncodedVideoChunk
            const chunk = new EncodedVideoChunk({{
                type: 'key',
                timestamp: 0,
                data: buffer
            }});

            decoder.decode(chunk);
            await decoder.flush();

            document.getElementById('frames-decoded').textContent = frames.length;
            log(`Decoded ${{frames.length}} frames`);
        }}

        function renderFrame(frame) {{
            ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        }}

        function play() {{
            if (frames.length === 0) return;

            isPlaying = true;
            currentFrameIndex = 0;

            const startTime = performance.now();
            let frameCount = 0;

            playInterval = setInterval(() => {{
                if (currentFrameIndex >= frames.length) {{
                    currentFrameIndex = 0;
                }}

                renderFrame(frames[currentFrameIndex]);
                currentFrameIndex++;
                frameCount++;

                const elapsed = (performance.now() - startTime) / 1000;
                const fps = frameCount / elapsed;
                document.getElementById('fps').textContent = fps.toFixed(1);

            }}, 100); // 10 FPS
        }}

        function pause() {{
            isPlaying = false;
            if (playInterval) {{
                clearInterval(playInterval);
                playInterval = null;
            }}
        }}

        moduloSelect.addEventListener('change', updateChunkSelect);
        loadBtn.addEventListener('click', loadChunk);
        playBtn.addEventListener('click', play);
        pauseBtn.addEventListener('click', pause);

        updateChunkSelect();
        log('Ready');
    </script>
</body>
</html>"""

    output_path.write_text(html)
    print(f"\n📄 Generated test page: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Encode video frames into VP9 chunks for Wasabi")
    parser.add_argument("--video-id", required=True, help="Video UUID")
    parser.add_argument("--upload", action="store_true", help="Upload chunks to Wasabi")
    parser.add_argument("--output-dir", default="./output/vp9-chunks", help="Output directory for chunks")
    args = parser.parse_args()

    video_id = args.video_id

    # Find database path
    video_id_prefix = video_id[:2]
    db_path = Path(f"/Users/jurban/PycharmProjects/CaptionA.cc/local/data/{video_id_prefix}/{video_id}/cropping.db")

    if not db_path.exists():
        print(f"❌ Database not found: {db_path}")
        return 1

    # Get frames from database
    frames = get_frames_from_db(db_path)
    if not frames:
        print("❌ No frames found in database")
        return 1

    # Organize by modulo
    modulo_frames = organize_frames_by_modulo(frames)

    # Set up output directories
    output_base = Path(args.output_dir) / video_id
    output_base.mkdir(parents=True, exist_ok=True)

    # Encode chunks for each modulo level
    modulo_chunks = {}

    for modulo in [16, 4, 1]:
        modulo_output_dir = output_base / f"modulo_{modulo}"
        chunk_paths = encode_modulo_chunks(modulo, modulo_frames[modulo], modulo_output_dir)

        if args.upload:
            print(f"\n☁️  Uploading modulo_{modulo} chunks to Wasabi...")
            urls = []
            for chunk_path in chunk_paths:
                s3_key = f"dev/users/default_user/videos/{video_id}/cropped_frames/modulo_{modulo}/{chunk_path.name}"
                url = upload_to_wasabi(chunk_path, s3_key)
                urls.append(url)
                print(f"   ✅ {s3_key}")

            modulo_chunks[modulo] = urls
        else:
            modulo_chunks[modulo] = [str(p.relative_to(output_base.parent)) for p in chunk_paths]

    # Calculate total size
    total_size_mb = sum(sum(p.stat().st_size for p in output_base.glob(f"modulo_{m}/*.webm")) for m in [16, 4, 1]) / (
        1024 * 1024
    )

    print("\n📊 Summary:")
    print(f"   Total size: {total_size_mb:.1f} MB")
    print(f"   Duplication ratio: {total_size_mb / (sum(len(f[1]) for f in frames) / 1024 / 1024):.2f}x")

    # Generate test page
    test_page_path = output_base / "test.html"
    generate_test_page(video_id, modulo_chunks, test_page_path)

    print(f"\n🎉 Done! Open {test_page_path} in a browser to test performance.")

    return 0


if __name__ == "__main__":
    exit(main())
