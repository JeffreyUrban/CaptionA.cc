"""Database initialization and session management for training databases.

Each training dataset is stored in its own database file:
- local/models/caption_boundaries/datasets/{dataset_name}.db

Each dataset database is fully self-contained with all necessary data:
- TrainingDataset metadata
- TrainingSample records
- TrainingFrame BLOBs
- TrainingOCRVisualization BLOBs
- VideoRegistry (videos used in this dataset)
- Experiment records (training runs on this dataset)
"""

import subprocess
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from caption_boundaries.database.schema import Base


def get_git_root() -> Path:
    """Get the git repository root directory."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
        return Path(result.stdout.strip())
    except subprocess.CalledProcessError as e:
        raise RuntimeError("Not in a git repository") from e


# Default database directory (relative to git root)
DEFAULT_DATASET_DIR = get_git_root() / "local" / "models" / "caption_boundaries" / "datasets"


def get_dataset_db_path(dataset_name: str) -> Path:
    """Get path to dataset database file.

    Args:
        dataset_name: Name of the dataset

    Returns:
        Path to dataset database file

    Example:
        >>> get_dataset_db_path("production_v1")
        Path("local/models/caption_boundaries/datasets/production_v1.db")
    """
    return DEFAULT_DATASET_DIR / f"{dataset_name}.db"


def get_db_url(db_path: Path) -> str:
    """Get SQLAlchemy database URL.

    Args:
        db_path: Path to database file

    Returns:
        SQLAlchemy database URL
    """
    return f"sqlite:///{db_path.absolute()}"


def init_dataset_db(db_path: Path, force: bool = False) -> None:
    """Initialize a dataset database with all required tables.

    Creates a fully self-contained database for a training dataset.

    Args:
        db_path: Path to dataset database file
        force: If True, drop existing tables and recreate (WARNING: deletes data)

    Example:
        >>> db_path = get_dataset_db_path("production_v1")
        >>> init_dataset_db(db_path)
    """
    # Ensure parent directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # Create engine
    engine = create_engine(get_db_url(db_path))

    if force:
        # Drop all existing tables and recreate
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
    else:
        # Create missing tables only (safe for existing databases)
        # This allows adding new tables without dropping existing data
        Base.metadata.create_all(engine, checkfirst=True)


def get_dataset_db(db_path: Path) -> Generator[Session]:
    """Get database session for a dataset database.

    This is a generator function compatible with FastAPI's Depends() pattern
    and also usable in standalone scripts.

    Args:
        db_path: Path to dataset database file

    Yields:
        SQLAlchemy Session

    Example:
        >>> # Get dataset database path
        >>> db_path = get_dataset_db_path("production_v1")
        >>>
        >>> # Use in context
        >>> with next(get_dataset_db(db_path)) as db:
        >>>     dataset = db.query(TrainingDataset).first()
    """
    # Create engine (pool_size=5 is reasonable for training scripts)
    engine = create_engine(
        get_db_url(db_path),
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,  # Verify connections before using
    )

    # Create session factory
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    # Yield session
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_dataset_session(db_path: Path) -> Session:
    """Create a new database session (non-generator version).

    Use this when you need a session outside of a generator context.
    Remember to close the session when done!

    Args:
        db_path: Path to dataset database file

    Returns:
        SQLAlchemy Session (remember to close it!)

    Example:
        >>> db_path = get_dataset_db_path("production_v1")
        >>> db = create_dataset_session(db_path)
        >>> try:
        >>>     dataset = db.query(TrainingDataset).first()
        >>> finally:
        >>>     db.close()
    """
    engine = create_engine(
        get_db_url(db_path),
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
    )

    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return SessionLocal()
