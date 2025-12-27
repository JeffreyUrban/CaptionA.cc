"""Unit tests for FontCLIP integration."""

import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
import pytest
from PIL import Image

from caption_boundaries.data.font_embeddings import FontCLIPModel, extract_font_embedding
from caption_boundaries.data.reference_selection import ReferenceFrameCandidate
from caption_boundaries.database import FontEmbedding, VideoRegistry, create_session, init_training_db


@pytest.fixture
def mock_fontclip_model():
    """Create a mock FontCLIP model for testing."""
    model = Mock(spec=FontCLIPModel)
    model.model_name = "test-model"
    model.device = "cpu"

    # Mock embedding extraction to return deterministic 512-dim array
    def mock_extract(image):
        return np.random.RandomState(42).randn(512).astype(np.float32)

    model.extract_embedding = Mock(side_effect=mock_extract)
    model.get_model_version = Mock(return_value="test-model-v1.0")

    return model


@pytest.fixture
def sample_image():
    """Create a sample image for testing."""
    # Create 100x100 RGB image with text-like pattern
    img = Image.new("RGB", (100, 100), color="white")
    return img


@pytest.fixture
def sample_reference_frame():
    """Create sample reference frame candidate."""
    return ReferenceFrameCandidate(
        frame_index=50,
        num_ocr_boxes=25,
        mean_confidence=0.92,
        ocr_boxes=[
            {"text": "Hello", "confidence": 0.95, "x": 10, "y": 20, "width": 50, "height": 30},
            {"text": "World", "confidence": 0.89, "x": 70, "y": 20, "width": 50, "height": 30},
        ],
    )


@pytest.fixture
def test_training_db():
    """Create a temporary training database."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "training.db"
        init_training_db(db_path)
        db = create_session(db_path)
        try:
            yield db, db_path
        finally:
            db.close()


@pytest.mark.unit
def test_fontclip_model_initialization():
    """Test FontCLIPModel initialization with different devices."""
    # Test auto-detection (should not crash)
    with patch("torch.cuda.is_available", return_value=False):
        with patch("torch.backends.mps.is_available", return_value=False):
            # Mock AutoProcessor and AutoModel to avoid actual downloads
            with patch("caption_boundaries.data.font_embeddings.AutoProcessor"):
                with patch("caption_boundaries.data.font_embeddings.AutoModel"):
                    model = FontCLIPModel()
                    assert model.device.type == "cpu"


@pytest.mark.unit
def test_fontclip_model_version():
    """Test model version string generation."""
    with patch("torch.cuda.is_available", return_value=False):
        with patch("torch.backends.mps.is_available", return_value=False):
            # Mock AutoProcessor and AutoModel to avoid actual downloads
            with patch("caption_boundaries.data.font_embeddings.AutoProcessor"):
                with patch("caption_boundaries.data.font_embeddings.AutoModel"):
                    model = FontCLIPModel()
                    version = model.get_model_version()

                    # Should include model name and version
                    # Default is VecGlypher/fontclip_weight or fallback to sentence-transformers/clip
                    assert "v1.0" in version
                    assert ("-" in version)  # Should have model name with dashes


@pytest.mark.unit
def test_fontclip_fallback_tracking():
    """Test that fallback model is properly tracked in metadata."""
    with patch("torch.cuda.is_available", return_value=False):
        with patch("torch.backends.mps.is_available", return_value=False):
            # Create mock models
            mock_model = Mock()
            mock_model.parameters.return_value = []  # Empty list for freezing params
            mock_model.to.return_value = mock_model
            mock_model.eval.return_value = None

            mock_processor = Mock()

            # Mock AutoProcessor and AutoModel to simulate access denied then fallback success
            with patch(
                "caption_boundaries.data.font_embeddings.AutoProcessor.from_pretrained",
                side_effect=[
                    Exception("Access denied"),  # First call (VecGlypher) fails
                    mock_processor,  # Second call (fallback) succeeds
                ],
            ):
                with patch(
                    "caption_boundaries.data.font_embeddings.AutoModel.from_pretrained",
                    return_value=mock_model,  # Model loading succeeds on fallback
                ):
                    model = FontCLIPModel()

                    # Verify fallback was used
                    assert model.used_fallback is True
                    assert model.requested_model == "VecGlypher/fontclip_weight"
                    assert model.model_name == "sentence-transformers/clip-ViT-B-32"

                    # Verify version string indicates fallback
                    version = model.get_model_version()
                    assert "sentence-transformers-clip-ViT-B-32" in version
                    assert "-fallback" in version
                    assert "VecGlypher" not in version  # Should use actual model, not requested


@pytest.mark.unit
def test_extract_embedding_shape(mock_fontclip_model, sample_image, sample_reference_frame):
    """Test that embedding extraction returns correct shape."""
    video_db_path = Path("/tmp/test/annotations.db")

    embedding, model_version = extract_font_embedding(
        video_db_path, sample_image, sample_reference_frame, model=mock_fontclip_model
    )

    # Verify shape
    assert embedding.shape == (512,)
    assert embedding.dtype == np.float32

    # Verify model was called
    mock_fontclip_model.extract_embedding.assert_called_once_with(sample_image)
    mock_fontclip_model.get_model_version.assert_called_once()


@pytest.mark.unit
def test_extract_embedding_deterministic(mock_fontclip_model, sample_image, sample_reference_frame):
    """Test that same input produces same embedding."""
    video_db_path = Path("/tmp/test/annotations.db")

    embedding1, _ = extract_font_embedding(
        video_db_path, sample_image, sample_reference_frame, model=mock_fontclip_model
    )
    embedding2, _ = extract_font_embedding(
        video_db_path, sample_image, sample_reference_frame, model=mock_fontclip_model
    )

    # Should produce same embedding (deterministic mock)
    np.testing.assert_array_equal(embedding1, embedding2)


@pytest.mark.unit
def test_fontclip_embedding_normalization(mock_fontclip_model):
    """Test that embeddings are properly normalized."""
    # Create model that returns non-512-dim output
    def mock_extract_wrong_size(image):
        return np.random.randn(768).astype(np.float32)  # Wrong size

    mock_fontclip_model.extract_embedding = Mock(side_effect=mock_extract_wrong_size)

    # Should handle gracefully (current implementation truncates/pads)
    # This test documents current behavior - in production, would use learned projection
    # TODO: Implement test once normalization is exposed as separate method
    pass


@pytest.mark.unit
def test_get_or_create_font_embedding_not_implemented(mock_fontclip_model):
    """Test that get_or_create raises NotImplementedError (frame loading not done)."""
    from caption_boundaries.data.font_embeddings import get_or_create_font_embedding

    with tempfile.TemporaryDirectory() as tmpdir:
        video_db_path = Path(tmpdir) / "annotations.db"
        training_db_path = Path(tmpdir) / "training.db"

        # Initialize training database
        init_training_db(training_db_path)

        # Mock get_video_metadata to avoid file access
        mock_metadata = {"video_hash": "a" * 64, "video_path": "/test/video.mp4", "file_size_bytes": 1000000}

        # Mock select_reference_frame to return a valid candidate
        mock_reference = ReferenceFrameCandidate(
            frame_index=50, num_ocr_boxes=25, mean_confidence=0.92, ocr_boxes=[]
        )

        with patch("caption_boundaries.data.font_embeddings.get_video_metadata", return_value=mock_metadata):
            with patch("caption_boundaries.data.font_embeddings.select_reference_frame", return_value=mock_reference):
                with patch(
                    "caption_boundaries.data.font_embeddings.FontCLIPModel", return_value=mock_fontclip_model
                ):
                    # Should raise NotImplementedError because frame loading not implemented
                    with pytest.raises(NotImplementedError, match="Frame loading"):
                        get_or_create_font_embedding(video_db_path, training_db_path)


@pytest.mark.unit
def test_font_embedding_database_schema(test_training_db):
    """Test that FontEmbedding can be stored and retrieved from database."""
    db, db_path = test_training_db

    # Create video registry first
    video = VideoRegistry(
        video_hash="a" * 64,
        video_path="/path/to/video.mp4",
        file_size_bytes=1024 * 1024 * 500,
    )
    db.add(video)
    db.commit()

    # Create font embedding
    embedding_array = np.random.randn(512).astype(np.float32)
    embedding = FontEmbedding(
        video_hash="a" * 64,
        embedding=embedding_array.tobytes(),
        embedding_dim=512,
        reference_frame_index=50,
        num_ocr_boxes=25,
        mean_ocr_confidence=0.92,
        fontclip_model_version="test-model-v1.0",
    )

    db.add(embedding)
    db.commit()

    # Retrieve and verify
    retrieved = db.query(FontEmbedding).filter(FontEmbedding.video_hash == "a" * 64).first()
    assert retrieved is not None
    assert retrieved.embedding_dim == 512
    assert retrieved.fontclip_model_version == "test-model-v1.0"

    # Verify embedding data
    retrieved_array = np.frombuffer(retrieved.embedding, dtype=np.float32)
    assert retrieved_array.shape == (512,)
    np.testing.assert_array_equal(retrieved_array, embedding_array)


@pytest.mark.unit
def test_font_embedding_unique_constraint(test_training_db):
    """Test that unique constraint prevents duplicate embeddings."""
    db, db_path = test_training_db

    # Create video registry
    video = VideoRegistry(
        video_hash="a" * 64,
        video_path="/path/to/video.mp4",
        file_size_bytes=1024 * 1024 * 500,
    )
    db.add(video)
    db.commit()

    # Create first embedding
    embedding1 = FontEmbedding(
        video_hash="a" * 64,
        embedding=np.random.randn(512).astype(np.float32).tobytes(),
        embedding_dim=512,
        reference_frame_index=50,
        num_ocr_boxes=25,
        mean_ocr_confidence=0.92,
        fontclip_model_version="test-model-v1.0",
    )
    db.add(embedding1)
    db.commit()

    # Try to create duplicate (same video_hash + model_version)
    embedding2 = FontEmbedding(
        video_hash="a" * 64,
        embedding=np.random.randn(512).astype(np.float32).tobytes(),
        embedding_dim=512,
        reference_frame_index=60,  # Different frame
        num_ocr_boxes=30,
        mean_ocr_confidence=0.95,
        fontclip_model_version="test-model-v1.0",  # Same model version!
    )
    db.add(embedding2)

    # Should fail due to unique constraint
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        db.commit()


@pytest.mark.unit
def test_font_embedding_different_model_versions(test_training_db):
    """Test that same video can have embeddings from different model versions."""
    db, db_path = test_training_db

    # Create video registry
    video = VideoRegistry(
        video_hash="a" * 64,
        video_path="/path/to/video.mp4",
        file_size_bytes=1024 * 1024 * 500,
    )
    db.add(video)
    db.commit()

    # Create embedding with model v1.0
    embedding1 = FontEmbedding(
        video_hash="a" * 64,
        embedding=np.random.randn(512).astype(np.float32).tobytes(),
        embedding_dim=512,
        reference_frame_index=50,
        num_ocr_boxes=25,
        mean_ocr_confidence=0.92,
        fontclip_model_version="test-model-v1.0",
    )
    db.add(embedding1)
    db.commit()

    # Create embedding with model v2.0 (should succeed)
    embedding2 = FontEmbedding(
        video_hash="a" * 64,
        embedding=np.random.randn(512).astype(np.float32).tobytes(),
        embedding_dim=512,
        reference_frame_index=50,
        num_ocr_boxes=25,
        mean_ocr_confidence=0.92,
        fontclip_model_version="test-model-v2.0",  # Different version
    )
    db.add(embedding2)
    db.commit()

    # Verify both exist
    embeddings = db.query(FontEmbedding).filter(FontEmbedding.video_hash == "a" * 64).all()
    assert len(embeddings) == 2
    assert {e.fontclip_model_version for e in embeddings} == {"test-model-v1.0", "test-model-v2.0"}
