"""
In-memory job storage with TTL and deduplication.
"""

import hashlib
import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from enum import Enum
from threading import Lock
from typing import Dict, List, Optional


class JobStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Job:
    """Job metadata and results."""

    job_id: str
    status: JobStatus
    created_at: float
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    processing_time_ms: Optional[float] = None
    result: Optional[dict] = None
    error: Optional[str] = None
    images_count: int = 0

    def to_dict(self) -> dict:
        """Convert to dictionary for API response."""
        data = asdict(self)
        data["status"] = self.status.value
        data["created_at"] = datetime.fromtimestamp(self.created_at).isoformat()
        if self.started_at:
            data["started_at"] = datetime.fromtimestamp(self.started_at).isoformat()
        if self.completed_at:
            data["completed_at"] = datetime.fromtimestamp(self.completed_at).isoformat()
        return data


class JobStore:
    """In-memory job storage with TTL."""

    def __init__(self, ttl_seconds: int = 3600):
        self.ttl_seconds = ttl_seconds
        self._lock = Lock()
        self._jobs: Dict[str, Job] = {}
        self._content_hashes: Dict[str, str] = {}  # content_hash -> job_id for dedup

    def generate_job_id(self, images: List[dict]) -> str:
        """
        Generate deterministic job ID based on content for deduplication.

        Same images = same job_id = can return cached result
        """
        # Create hash of image IDs
        content = json.dumps([img["id"] for img in images], sort_keys=True)
        content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]

        # Check if we've seen this before (deduplication)
        with self._lock:
            if content_hash in self._content_hashes:
                existing_job_id = self._content_hashes[content_hash]
                existing_job = self._jobs.get(existing_job_id)

                # If completed recently, reuse it
                if existing_job and existing_job.status == JobStatus.COMPLETED:
                    age = time.time() - existing_job.completed_at
                    if age < self.ttl_seconds:
                        return existing_job_id  # Reuse existing result

        # New job
        timestamp = int(time.time() * 1000)
        job_id = f"{content_hash}_{timestamp}"

        with self._lock:
            self._content_hashes[content_hash] = job_id

        return job_id

    def create_job(self, job_id: str, images_count: int) -> Job:
        """Create new job."""
        job = Job(job_id=job_id, status=JobStatus.PENDING, created_at=time.time(), images_count=images_count)

        with self._lock:
            self._jobs[job_id] = job

        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        """Get job by ID."""
        with self._lock:
            return self._jobs.get(job_id)

    def update_status(self, job_id: str, status: JobStatus, **kwargs):
        """Update job status and metadata."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.status = status
                for key, value in kwargs.items():
                    setattr(job, key, value)

    def cleanup_old_jobs(self):
        """Remove jobs older than TTL."""
        cutoff = time.time() - self.ttl_seconds

        with self._lock:
            expired = [job_id for job_id, job in self._jobs.items() if job.created_at < cutoff]

            for job_id in expired:
                del self._jobs[job_id]

            # Also cleanup content hashes
            self._content_hashes = {h: jid for h, jid in self._content_hashes.items() if jid in self._jobs}

    def get_stats(self) -> dict:
        """Get storage statistics."""
        with self._lock:
            statuses = {}
            for job in self._jobs.values():
                status = job.status.value
                statuses[status] = statuses.get(status, 0) + 1

            return {"total_jobs": len(self._jobs), "by_status": statuses, "ttl_seconds": self.ttl_seconds}


# Singleton instance
job_store = JobStore()
