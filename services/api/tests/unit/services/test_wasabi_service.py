"""
Unit tests for Wasabi Service.
Tests the WasabiServiceImpl class with mocked boto3 S3 client.
"""
import io
import pytest
from pathlib import Path
from unittest.mock import Mock, patch
from botocore.exceptions import ClientError

from app.services.wasabi_service import WasabiServiceImpl


@pytest.fixture
def mock_s3_client():
    """Mock boto3 S3 client."""
    return Mock()


@pytest.fixture
def wasabi_service(mock_s3_client):
    """Create service with mocked S3 client."""
    with patch('app.services.wasabi_service.boto3.client') as mock_boto:
        mock_boto.return_value = mock_s3_client
        service = WasabiServiceImpl(
            access_key="test-access",
            secret_key="test-secret",   # pragma: allowlist secret
            bucket="test-bucket",
            region="us-east-1"
        )
        service.s3_client = mock_s3_client
        return service


class TestUploadFile:
    """Test file upload operations."""

    def test_upload_bytes(self, wasabi_service, mock_s3_client):
        """Upload bytes data."""
        data = b"test data"
        key = wasabi_service.upload_file(
            key="test/file.txt",
            data=data,
            content_type="text/plain"
        )

        assert key == "test/file.txt"
        assert mock_s3_client.upload_fileobj.called

        call_args = mock_s3_client.upload_fileobj.call_args
        # Check positional arguments
        assert call_args[0][1] == "test-bucket"  # bucket
        assert call_args[0][2] == "test/file.txt"  # key
        # Check ExtraArgs keyword argument
        assert call_args[1]["ExtraArgs"]["ContentType"] == "text/plain"

    def test_upload_file_object(self, wasabi_service, mock_s3_client):
        """Upload file-like object."""
        file_obj = io.BytesIO(b"test data")

        key = wasabi_service.upload_file(
            key="test/file.txt",
            data=file_obj
        )

        assert key == "test/file.txt"
        assert mock_s3_client.upload_fileobj.called

    def test_upload_from_path(self, wasabi_service, mock_s3_client, tmp_path):
        """Upload file from local filesystem."""
        # Create a test file
        local_file = tmp_path / "test.txt"
        local_file.write_text("test content")

        key = wasabi_service.upload_from_path(
            key="test/uploaded.txt",
            local_path=local_file,
            content_type="text/plain"
        )

        assert key == "test/uploaded.txt"
        assert mock_s3_client.upload_file.called

        call_args = mock_s3_client.upload_file.call_args
        assert call_args[0][1] == "test-bucket"
        assert call_args[0][2] == "test/uploaded.txt"
        assert call_args[1]["ExtraArgs"]["ContentType"] == "text/plain"

    def test_upload_from_path_auto_content_type(
        self, wasabi_service, mock_s3_client, tmp_path
    ):
        """Upload file with auto-detected content type."""
        # Create a test file with specific extension
        local_file = tmp_path / "test.mp4"
        local_file.write_bytes(b"fake video data")

        key = wasabi_service.upload_from_path(
            key="test/video.mp4",
            local_path=local_file
        )

        assert key == "test/video.mp4"
        assert mock_s3_client.upload_file.called

        call_args = mock_s3_client.upload_file.call_args
        # Should have auto-detected video/mp4
        assert call_args[1]["ExtraArgs"]["ContentType"] == "video/mp4"

    def test_upload_from_path_file_not_found(self, wasabi_service):
        """Upload from non-existent path raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            wasabi_service.upload_from_path(
                key="test/file.txt",
                local_path="/nonexistent/file.txt"
            )


class TestDownloadFile:
    """Test file download operations."""

    def test_download_to_path(self, wasabi_service, mock_s3_client, tmp_path):
        """Download file to local path."""
        local_path = tmp_path / "downloaded.txt"

        wasabi_service.download_file(
            key="test/file.txt",
            local_path=str(local_path)
        )

        assert mock_s3_client.download_file.called
        call_args = mock_s3_client.download_file.call_args
        assert call_args[0][0] == "test-bucket"
        assert call_args[0][1] == "test/file.txt"

    def test_download_creates_parent_dirs(
        self, wasabi_service, tmp_path
    ):
        """Download creates parent directories."""
        local_path = tmp_path / "nested" / "dir" / "file.txt"

        wasabi_service.download_file(
            key="test/file.txt",
            local_path=str(local_path)
        )

        assert local_path.parent.exists()

    def test_download_to_bytes(self, wasabi_service, mock_s3_client):
        """Download file to memory as bytes."""
        # Mock the download_fileobj to write data to buffer
        def mock_download(_bucket, _key, buffer):
            buffer.write(b"test file content")

        mock_s3_client.download_fileobj.side_effect = mock_download

        data = wasabi_service.download_to_bytes("test/file.txt")

        assert data == b"test file content"
        assert mock_s3_client.download_fileobj.called

        call_args = mock_s3_client.download_fileobj.call_args
        assert call_args[0][0] == "test-bucket"
        assert call_args[0][1] == "test/file.txt"


class TestDeleteOperations:
    """Test delete operations."""

    def test_delete_file(self, wasabi_service, mock_s3_client):
        """Delete single file from S3."""
        wasabi_service.delete_file("test/file.txt")

        assert mock_s3_client.delete_object.called

        call_args = mock_s3_client.delete_object.call_args
        assert call_args[1]["Bucket"] == "test-bucket"
        assert call_args[1]["Key"] == "test/file.txt"

    def test_delete_prefix_single_page(self, wasabi_service, mock_s3_client):
        """Delete all files with prefix (single page)."""
        # Mock paginator
        paginator = Mock()
        mock_s3_client.get_paginator.return_value = paginator

        pages = [
            {"Contents": [
                {"Key": "tenant/video/file1.jpg"},
                {"Key": "tenant/video/file2.jpg"}
            ]}
        ]
        paginator.paginate.return_value = pages

        count = wasabi_service.delete_prefix("tenant/video/")

        assert count == 2
        assert mock_s3_client.delete_objects.called

        call_args = mock_s3_client.delete_objects.call_args
        deleted_objects = call_args[1]["Delete"]["Objects"]
        assert len(deleted_objects) == 2

    def test_delete_prefix_no_files(self, wasabi_service, mock_s3_client):
        """Delete with no matching files."""
        paginator = Mock()
        mock_s3_client.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{}]  # No Contents key

        count = wasabi_service.delete_prefix("tenant/video/")

        assert count == 0
        assert not mock_s3_client.delete_objects.called


class TestFileExists:
    """Test file existence checks."""

    def test_file_exists_true(self, wasabi_service, mock_s3_client):
        """File exists returns True."""
        mock_s3_client.head_object.return_value = {"ContentLength": 100}

        exists = wasabi_service.file_exists("test/file.txt")

        assert exists is True

    def test_file_exists_false(self, wasabi_service, mock_s3_client):
        """File not found returns False."""
        mock_s3_client.head_object.side_effect = ClientError(
            {"Error": {"Code": "404"}}, "HeadObject"
        )

        exists = wasabi_service.file_exists("test/missing.txt")

        assert exists is False


class TestListFiles:
    """Test file listing operations."""

    def test_list_files_basic(self, wasabi_service, mock_s3_client):
        """List files with prefix."""
        paginator = Mock()
        mock_s3_client.get_paginator.return_value = paginator

        pages = [
            {"Contents": [
                {"Key": "tenant/video/file1.jpg"},
                {"Key": "tenant/video/file2.jpg"},
                {"Key": "tenant/video/file3.jpg"}
            ]}
        ]
        paginator.paginate.return_value = pages

        files = wasabi_service.list_files("tenant/video/")

        assert len(files) == 3
        assert files == [
            "tenant/video/file1.jpg",
            "tenant/video/file2.jpg",
            "tenant/video/file3.jpg"
        ]

    def test_list_files_with_max_keys(self, wasabi_service, mock_s3_client):
        """List files with max_keys limit."""
        paginator = Mock()
        mock_s3_client.get_paginator.return_value = paginator

        pages = [
            {"Contents": [
                {"Key": "tenant/video/file1.jpg"},
                {"Key": "tenant/video/file2.jpg"},
                {"Key": "tenant/video/file3.jpg"}
            ]}
        ]
        paginator.paginate.return_value = pages

        files = wasabi_service.list_files("tenant/video/", max_keys=2)

        # Should respect max_keys limit
        assert len(files) == 2

    def test_list_files_empty(self, wasabi_service, mock_s3_client):
        """List files with no matching results."""
        paginator = Mock()
        mock_s3_client.get_paginator.return_value = paginator
        paginator.paginate.return_value = [{}]  # No Contents key

        files = wasabi_service.list_files("nonexistent/")

        assert files == []


class TestPresignedUrl:
    """Test presigned URL generation."""

    def test_generate_presigned_url(self, wasabi_service, mock_s3_client):
        """Generate presigned URL for file access."""
        mock_s3_client.generate_presigned_url.return_value = (
            "https://s3.us-east-1.wasabisys.com/test-bucket/test/file.txt?signature=abc"
        )

        url = wasabi_service.generate_presigned_url(
            key="test/file.txt",
            expiration_seconds=1800
        )

        assert url.startswith("https://s3.us-east-1.wasabisys.com")
        assert mock_s3_client.generate_presigned_url.called

        call_args = mock_s3_client.generate_presigned_url.call_args
        assert call_args[0][0] == "get_object"
        assert call_args[1]["Params"]["Bucket"] == "test-bucket"
        assert call_args[1]["Params"]["Key"] == "test/file.txt"
        assert call_args[1]["ExpiresIn"] == 1800


class TestContentTypeGuessing:
    """Test content type auto-detection."""

    def test_guess_content_type_standard(self):
        """Guess content type for standard file extensions."""
        # Test standard mimetypes
        assert WasabiServiceImpl._guess_content_type(Path("file.txt")) == "text/plain"
        assert WasabiServiceImpl._guess_content_type(Path("file.html")) == "text/html"
        assert WasabiServiceImpl._guess_content_type(Path("file.json")) == "application/json"

    def test_guess_content_type_video(self):
        """Guess content type for video files."""
        assert WasabiServiceImpl._guess_content_type(Path("video.mp4")) == "video/mp4"
        assert WasabiServiceImpl._guess_content_type(Path("video.mov")) == "video/quicktime"
        assert WasabiServiceImpl._guess_content_type(Path("video.webm")) == "video/webm"

    def test_guess_content_type_image(self):
        """Guess content type for image files."""
        assert WasabiServiceImpl._guess_content_type(Path("image.png")) == "image/png"
        assert WasabiServiceImpl._guess_content_type(Path("image.jpg")) == "image/jpeg"
        assert WasabiServiceImpl._guess_content_type(Path("image.jpeg")) == "image/jpeg"

    def test_guess_content_type_compressed(self):
        """Guess content type for compressed files."""
        assert WasabiServiceImpl._guess_content_type(Path("archive.gz")) == "application/gzip"
        assert WasabiServiceImpl._guess_content_type(Path("archive.tar")) == "application/x-tar"

    def test_guess_content_type_unknown(self):
        """Guess content type for unknown extension returns None."""
        result = WasabiServiceImpl._guess_content_type(Path("file.unknown_ext"))
        assert result is None
