"""FontCLIP integration for font style embeddings.

Extracts 512-dimensional font style embeddings from reference frames using a pre-trained
FontCLIP model (frozen weights, no training). Embeddings are cached in the database to avoid
recomputation.

FontCLIP Architecture:
- Pre-trained vision encoder for font/typography recognition
- Outputs 512-dim embedding capturing font style characteristics
- Frozen model - we only use for feature extraction, no fine-tuning
"""

from pathlib import Path

import numpy as np
import torch
from frames_db import get_frame_from_db
from PIL import Image
from transformers import AutoModel, AutoProcessor

from caption_boundaries.data.reference_selection import ReferenceFrameCandidate, select_reference_frame
from caption_boundaries.database import FontEmbedding, VideoRegistry, get_dataset_db
from video_utils import get_video_metadata


def find_video_file(db_path: Path) -> Path | None:
    """Find video file in the same directory as database.

    Args:
        db_path: Path to annotations.db file

    Returns:
        Path to video file if found, None otherwise

    Strategy:
        1. Look for {directory_name}.{ext} (e.g., "1/1.mp4")
        2. Look for video.{ext}
        3. Look for any .mp4/.mkv/.avi/.mov file
    """
    directory = db_path.parent
    directory_name = directory.name

    # Common video extensions
    video_extensions = [".mp4", ".mkv", ".avi", ".mov"]

    # Strategy 1: Look for file named after directory
    for ext in video_extensions:
        video_path = directory / f"{directory_name}{ext}"
        if video_path.exists():
            return video_path

    # Strategy 2: Look for "video.{ext}"
    for ext in video_extensions:
        video_path = directory / f"video{ext}"
        if video_path.exists():
            return video_path

    # Strategy 3: Look for any video file
    for ext in video_extensions:
        matching_files = list(directory.glob(f"*{ext}"))
        if matching_files:
            return matching_files[0]  # Return first match

    return None


class FontCLIPModel:
    """Wrapper for pre-trained FontCLIP model.

    Loads model from HuggingFace and provides embedding extraction.
    Model weights are frozen - this is feature extraction only.
    """

    def __init__(self, model_name: str = "VecGlypher/fontclip_weight", device: str | None = None):
        """Initialize FontCLIP model.

        Args:
            model_name: HuggingFace model identifier
                       Default: VecGlypher/fontclip_weight (official FontCLIP weights)
                       Note: Requires HuggingFace authentication and accepting terms
                       Fallback: openai/clip-vit-base-patch32 (base CLIP model)
            device: Device to run on ('cuda', 'mps', 'cpu', or None for auto-detect)

        Note:
            To use VecGlypher/fontclip_weight, you must:
            1. Login to HuggingFace: huggingface-cli login
            2. Accept model terms at https://huggingface.co/VecGlypher/fontclip_weight

            If access is denied, automatically falls back to openai/clip-vit-base-patch32.

        TODO: Once access is granted to VecGlypher/fontclip_weight, verify loading works
              and swap in the real FontCLIP model for production use.
        """
        self.model_name = model_name

        # Auto-detect device if not specified
        if device is None:
            if torch.cuda.is_available():
                device = "cuda"
            elif torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"

        self.device = torch.device(device)

        # Track original model request and whether fallback occurred
        self.requested_model = model_name
        self.used_fallback = False

        # Load model and processor
        try:
            self.processor = AutoProcessor.from_pretrained(model_name)
            self.model = AutoModel.from_pretrained(model_name)
        except Exception as e:
            # If FontCLIP weights not accessible, fall back to base CLIP
            if "VecGlypher/fontclip_weight" in model_name:
                print(f"Warning: Could not load {model_name}: {e}")
                print("Falling back to base CLIP model: openai/clip-vit-base-patch32")
                fallback_model = "openai/clip-vit-base-patch32"

                # Update model_name to actual model used (ensures correct metadata tracking)
                self.model_name = fallback_model
                self.used_fallback = True

                self.processor = AutoProcessor.from_pretrained(fallback_model)
                self.model = AutoModel.from_pretrained(fallback_model)
            else:
                raise

        # Freeze all parameters (feature extraction only)
        for param in self.model.parameters():
            param.requires_grad = False

        # Move to device and set to eval mode
        self.model.to(self.device)
        self.model.eval()

    def extract_embedding(self, image: Image.Image) -> np.ndarray:
        """Extract 512-dim font embedding from image.

        Args:
            image: PIL Image containing text with font to analyze

        Returns:
            512-dimensional embedding as numpy array (float32)
        """
        # Process image
        inputs = self.processor(images=image, return_tensors="pt")
        inputs = {k: v.to(self.device) for k, v in inputs.items()}

        # Extract features (no grad needed)
        with torch.no_grad():
            # For CLIP models, use vision_model directly to avoid needing text inputs
            if hasattr(self.model, "vision_model"):
                # CLIP-based models: use vision encoder only
                vision_outputs = self.model.vision_model(**inputs)
                # Get pooled output (CLS token representation)
                embedding = vision_outputs.pooler_output
            else:
                # For other models (e.g., actual FontCLIP when available)
                outputs = self.model(**inputs)
                # Get pooled representation
                if hasattr(outputs, "pooler_output"):
                    embedding = outputs.pooler_output
                else:
                    # Fallback: mean pool last hidden state
                    embedding = outputs.last_hidden_state.mean(dim=1)

        # Convert to numpy and ensure 512-dim
        embedding_np = embedding.cpu().numpy().flatten().astype(np.float32)

        # Project to 512-dim if needed
        if embedding_np.shape[0] != 512:
            # Simple linear projection (for real use, this should be learned)
            # For now, truncate or pad
            if embedding_np.shape[0] > 512:
                embedding_np = embedding_np[:512]
            else:
                embedding_np = np.pad(embedding_np, (0, 512 - embedding_np.shape[0]))

        return embedding_np

    def get_model_version(self) -> str:
        """Get model version string for provenance tracking.

        Returns:
            Model identifier string including actual model used.
            Examples:
            - 'VecGlypher-fontclip_weight-v1.0' (if FontCLIP loaded successfully)
            - 'sentence-transformers-clip-ViT-B-32-v1.0-fallback' (if fallback used)
        """
        # Include actual model name for versioning (not requested model)
        # This ensures we track which model was actually used in production
        version = f"{self.model_name.replace('/', '-')}-v1.0"

        # Append fallback indicator for transparency
        if self.used_fallback:
            version += "-fallback"

        return version


def extract_font_embedding(
    video_db_path: Path,
    frame_image: Image.Image,
    reference_frame: ReferenceFrameCandidate,
    model: FontCLIPModel | None = None,
) -> tuple[np.ndarray, str]:
    """Extract font embedding from reference frame.

    Args:
        video_db_path: Path to video's annotations.db (for video identification)
        frame_image: PIL Image of reference frame
        reference_frame: Reference frame metadata
        model: FontCLIPModel instance (creates new one if None)

    Returns:
        Tuple of (embedding array, model_version string)
    """
    # Create model if not provided
    if model is None:
        model = FontCLIPModel()

    # Extract embedding
    embedding = model.extract_embedding(frame_image)
    model_version = model.get_model_version()

    return embedding, model_version


def get_or_create_font_embedding(
    video_db_path: Path,
    training_db_path: Path | None = None,
    model: FontCLIPModel | None = None,
    force_recompute: bool = False,
) -> FontEmbedding:
    """Get cached font embedding or create new one.

    This is the main entry point for FontCLIP integration. It:
    1. Checks cache in training database
    2. If not cached, selects reference frame from video database
    3. Extracts embedding using FontCLIP
    4. Caches in training database
    5. Returns embedding record

    Args:
        video_db_path: Path to video's annotations.db
        training_db_path: Path to training database (uses default if None)
        model: FontCLIPModel instance (creates new one if None)
        force_recompute: Force recomputation even if cached

    Returns:
        FontEmbedding record with embedding data

    Raises:
        ValueError: If video has no suitable reference frames

    Example:
        >>> video_db = Path("path/to/video/annotations.db")
        >>> embedding_record = get_or_create_font_embedding(video_db)
        >>> embedding_array = np.frombuffer(embedding_record.embedding, dtype=np.float32)
        >>> print(f"Embedding shape: {embedding_array.shape}")
        Embedding shape: (512,)
    """
    # Find video file in database directory
    video_path = find_video_file(video_db_path)
    if video_path is None:
        raise FileNotFoundError(
            f"No video file found in {video_db_path.parent}. "
            f"Expected video file with extensions: .mp4, .mkv, .avi, .mov"
        )

    # Get video metadata for identification
    metadata = get_video_metadata(video_path)
    video_hash = metadata["video_hash"]

    # Create model if not provided
    if model is None:
        model = FontCLIPModel()

    model_version = model.get_model_version()

    # Check cache in dataset database
    with next(get_dataset_db(training_db_path)) as db:
        if not force_recompute:
            cached = (
                db.query(FontEmbedding)
                .filter(
                    FontEmbedding.video_hash == video_hash,
                    FontEmbedding.fontclip_model_version == model_version,
                )
                .first()
            )

            if cached:
                return cached

        # Select reference frame from video database
        reference_frame = select_reference_frame(video_db_path)

        if reference_frame is None:
            raise ValueError(f"No suitable reference frames found in {video_db_path}")

        # Load frame image from database
        frame_data = get_frame_from_db(
            db_path=video_db_path, frame_index=reference_frame.frame_index, table="full_frames"
        )

        if frame_data is None:
            raise ValueError(
                f"Frame {reference_frame.frame_index} not found in {video_db_path}. "
                f"Ensure full_frames pipeline has been run on this video."
            )

        # Convert to PIL Image for embedding extraction
        frame_image = frame_data.to_pil_image()

        # Extract embedding
        embedding, _ = extract_font_embedding(video_db_path, frame_image, reference_frame, model)

        # Create database record
        embedding_record = FontEmbedding(
            video_hash=video_hash,
            embedding=embedding.tobytes(),
            embedding_dim=512,
            reference_frame_index=reference_frame.frame_index,
            num_ocr_boxes=reference_frame.num_ocr_boxes,
            mean_ocr_confidence=reference_frame.mean_confidence,
            fontclip_model_version=model_version,
        )

        # Ensure video registry exists
        video_registry = db.query(VideoRegistry).filter(VideoRegistry.video_hash == video_hash).first()
        if not video_registry:
            video_registry = VideoRegistry(
                video_hash=video_hash,
                video_path=metadata["video_path"],
                file_size_bytes=metadata["file_size_bytes"],
            )
            db.add(video_registry)

        # Add embedding
        db.add(embedding_record)
        db.commit()
        db.refresh(embedding_record)

        return embedding_record


def batch_extract_embeddings(
    video_db_paths: list[Path],
    training_db_path: Path | None = None,
    force_recompute: bool = False,
) -> dict[str, FontEmbedding]:
    """Batch extract font embeddings for multiple videos.

    More efficient than individual extraction because model is loaded once.

    Args:
        video_db_paths: List of paths to video annotations.db files
        training_db_path: Path to training database (uses default if None)
        force_recompute: Force recomputation even if cached

    Returns:
        Dict mapping video_hash to FontEmbedding records

    Example:
        >>> video_dbs = [Path("video1/annotations.db"), Path("video2/annotations.db")]
        >>> embeddings = batch_extract_embeddings(video_dbs)
        >>> print(f"Extracted {len(embeddings)} embeddings")
    """
    model = FontCLIPModel()
    results = {}

    for video_db_path in video_db_paths:
        try:
            embedding = get_or_create_font_embedding(
                video_db_path,
                training_db_path=training_db_path,
                model=model,
                force_recompute=force_recompute,
            )

            # Get video hash from embedding (it's already stored there)
            results[embedding.video_hash] = embedding

        except Exception as e:
            print(f"Failed to extract embedding for {video_db_path}: {e}")
            continue

    return results


def get_font_embedding(
    video_db_path: Path,
    training_db_path: Path | None = None,
) -> FontEmbedding | None:
    """Get cached font embedding for a video (read-only, no creation).

    For inference use - retrieves existing embedding without creating new ones.

    Args:
        video_db_path: Path to video's annotations.db
        training_db_path: Path to training database (uses default if None)

    Returns:
        FontEmbedding if found in cache, None otherwise
    """
    from caption_boundaries.database import get_dataset_db
    from caption_boundaries.data.dataset_builder import compute_video_hash

    # Compute video hash
    video_file = find_video_file(video_db_path)
    if not video_file:
        return None

    video_hash = compute_video_hash(video_file)

    # Check cache
    with next(get_dataset_db(training_db_path)) as db:
        from caption_boundaries.database import FontEmbedding

        embedding = db.query(FontEmbedding).filter(FontEmbedding.video_hash == video_hash).first()

        return embedding
