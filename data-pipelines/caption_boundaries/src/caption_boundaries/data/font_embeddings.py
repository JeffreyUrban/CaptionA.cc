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
from PIL import Image
from transformers import AutoModel, AutoProcessor

from caption_boundaries.data.reference_selection import ReferenceFrameCandidate, select_reference_frame
from caption_boundaries.database import FontEmbedding, get_training_db
from caption_boundaries.database.video_hash import get_video_metadata


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
                       Alternative: sentence-transformers/clip-ViT-B-32 (base CLIP model)
            device: Device to run on ('cuda', 'mps', 'cpu', or None for auto-detect)

        Note:
            To use VecGlypher/fontclip_weight, you must:
            1. Login to HuggingFace: huggingface-cli login
            2. Accept model terms at https://huggingface.co/VecGlypher/fontclip_weight

        TODO: Once access is granted to VecGlypher/fontclip_weight, verify loading works
              and swap in the real FontCLIP model for production use. Currently falls back
              to base CLIP model if access is denied.
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
                print("Falling back to base CLIP model: sentence-transformers/clip-ViT-B-32")
                fallback_model = "sentence-transformers/clip-ViT-B-32"

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
            outputs = self.model(**inputs)

            # Get pooled representation
            # For LayoutLM, use pooler_output; for actual FontCLIP, adjust as needed
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
    # Get video metadata for identification
    metadata = get_video_metadata(video_db_path.parent / "video.mp4")  # TODO: Better video path detection
    video_hash = metadata["video_hash"]

    # Create model if not provided
    if model is None:
        model = FontCLIPModel()

    model_version = model.get_model_version()

    # Check cache in training database
    with next(get_training_db(training_db_path)) as db:
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

        # Load frame image (TODO: Implement frame loading from database)
        # For now, raise NotImplementedError - this needs frames_db integration
        raise NotImplementedError(
            "Frame loading from database not yet implemented. "
            "Need to integrate with frames_db package to load frame images."
        )

        # Extract embedding
        # frame_image = load_frame_image(video_db_path, reference_frame.frame_index)
        # embedding, _ = extract_font_embedding(video_db_path, frame_image, reference_frame, model)

        # # Create database record
        # embedding_record = FontEmbedding(
        #     video_hash=video_hash,
        #     embedding=embedding.tobytes(),
        #     embedding_dim=512,
        #     reference_frame_index=reference_frame.frame_index,
        #     num_ocr_boxes=reference_frame.num_ocr_boxes,
        #     mean_ocr_confidence=reference_frame.mean_confidence,
        #     fontclip_model_version=model_version,
        # )

        # # Ensure video registry exists
        # video_registry = db.query(VideoRegistry).filter(VideoRegistry.video_hash == video_hash).first()
        # if not video_registry:
        #     video_registry = VideoRegistry(
        #         video_hash=video_hash,
        #         video_path=metadata["video_path"],
        #         file_size_bytes=metadata["file_size_bytes"],
        #     )
        #     db.add(video_registry)

        # # Add embedding
        # db.add(embedding_record)
        # db.commit()
        # db.refresh(embedding_record)

        # return embedding_record


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


            # Get video hash for result dict
            metadata = get_video_metadata(video_db_path.parent / "video.mp4")
            results[metadata["video_hash"]] = embedding

        except Exception as e:
            print(f"Failed to extract embedding for {video_db_path}: {e}")
            continue

    return results
