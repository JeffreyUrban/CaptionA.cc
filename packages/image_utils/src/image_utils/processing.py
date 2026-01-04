"""Image processing utilities using Pillow."""

from collections.abc import Callable
from pathlib import Path
from typing import Literal

from PIL import Image


def resize_image(
    image_path: Path,
    output_path: Path,
    target_size: tuple[int, int],
    resample: int = Image.Resampling.LANCZOS,
    preserve_aspect: bool = False,
    pad_mode: Literal["center", "top-left"] = "center",
    background_color: tuple[int, int, int] = (0, 0, 0),
) -> Path:
    """Resize an image to target dimensions.

    Args:
        image_path: Path to input image file
        output_path: Path to save resized image
        target_size: Target size as (width, height) in pixels
        resample: Resampling filter (default: LANCZOS for high quality)
        preserve_aspect: If True, maintain aspect ratio with padding. If False, stretch to fill.
        pad_mode: How to position the image when padding ("center" or "top-left")
        background_color: RGB color for padding areas (default: black)

    Returns:
        Path to the resized image file

    Raises:
        FileNotFoundError: If input image doesn't exist
        ValueError: If target_size is invalid
    """
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    target_width, target_height = target_size
    if target_width <= 0 or target_height <= 0:
        raise ValueError(f"Invalid target size: {target_size}")

    # Create output directory if needed
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Open and process image
    with Image.open(image_path) as img:
        if preserve_aspect:
            # Calculate scaling to fit within target while preserving aspect ratio
            img_width, img_height = img.size
            scale = min(target_width / img_width, target_height / img_height)
            new_width = int(img_width * scale)
            new_height = int(img_height * scale)

            # Resize image
            resized = img.resize((new_width, new_height), resample=resample)

            # Create background canvas
            canvas = Image.new("RGB", target_size, background_color)

            # Paste resized image onto canvas
            if pad_mode == "center":
                paste_x = (target_width - new_width) // 2
                paste_y = (target_height - new_height) // 2
            else:  # top-left
                paste_x = 0
                paste_y = 0

            canvas.paste(resized, (paste_x, paste_y))
            canvas.save(output_path, quality=85, optimize=True)
        else:
            # Stretch to fill target dimensions
            resized = img.resize(target_size, resample=resample)
            resized.save(output_path, quality=85, optimize=True)

    return output_path


def resize_directory(
    input_dir: Path,
    output_dir: Path,
    target_size: tuple[int, int],
    pattern: str = "*.jpg",
    preserve_aspect: bool = False,
    progress_callback: Callable[[int, int], None] | None = None,
) -> list[Path]:
    """Resize all images in a directory.

    Args:
        input_dir: Directory containing input images
        output_dir: Directory to save resized images
        target_size: Target size as (width, height) in pixels
        pattern: Glob pattern for input files (default: "*.jpg")
        preserve_aspect: If True, maintain aspect ratio with padding
        progress_callback: Optional callback function (current, total) -> None

    Returns:
        List of paths to resized image files

    Raises:
        FileNotFoundError: If input directory doesn't exist
    """
    if not input_dir.exists():
        raise FileNotFoundError(f"Input directory not found: {input_dir}")

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Find all matching images
    image_files = sorted(input_dir.glob(pattern))
    total = len(image_files)

    if total == 0:
        return []

    resized_files = []
    for i, image_path in enumerate(image_files, start=1):
        output_path = output_dir / image_path.name
        resize_image(
            image_path,
            output_path,
            target_size,
            preserve_aspect=preserve_aspect,
        )
        resized_files.append(output_path)

        if progress_callback:
            progress_callback(i, total)

    return resized_files
