"""Database initialization and session management for training database.

The central training database is stored at: local/caption_boundaries_training.db
"""

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from caption_boundaries.database.schema import Base

# Default database location (can be overridden)
DEFAULT_DB_PATH = Path("local/caption_boundaries_training.db")


def get_db_url(db_path: Path | None = None) -> str:
    """Get SQLAlchemy database URL.

    Args:
        db_path: Path to database file (default: local/caption_boundaries_training.db)

    Returns:
        SQLAlchemy database URL
    """
    if db_path is None:
        db_path = DEFAULT_DB_PATH

    return f"sqlite:///{db_path.absolute()}"


def init_training_db(db_path: Path | None = None, force: bool = False) -> None:
    """Initialize the central training database.

    Creates the database file and all tables. If the database already exists
    and force=False, does nothing.

    Args:
        db_path: Path to database file (default: local/caption_boundaries_training.db)
        force: If True, drop existing tables and recreate (WARNING: deletes data)

    Example:
        >>> init_training_db()  # Create default database
        >>> init_training_db(Path("custom/path.db"))  # Custom location
        >>> init_training_db(force=True)  # Recreate tables (DANGER!)
    """
    if db_path is None:
        db_path = DEFAULT_DB_PATH

    # Ensure parent directory exists
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # Check if database exists
    if db_path.exists() and not force:
        # Database already initialized
        return

    # Create engine and tables
    engine = create_engine(get_db_url(db_path))

    if force:
        # Drop all existing tables
        Base.metadata.drop_all(engine)

    # Create all tables
    Base.metadata.create_all(engine)


def get_training_db(db_path: Path | None = None) -> Generator[Session]:
    """Get database session for training database.

    This is a generator function compatible with FastAPI's Depends() pattern
    and also usable in standalone scripts.

    Args:
        db_path: Path to database file (default: local/caption_boundaries_training.db)

    Yields:
        SQLAlchemy Session

    Example:
        >>> # In scripts
        >>> for db in get_training_db():
        >>>     videos = db.query(VideoRegistry).all()
        >>>
        >>> # Or with context manager
        >>> db = next(get_training_db())
        >>> try:
        >>>     videos = db.query(VideoRegistry).all()
        >>> finally:
        >>>     db.close()
    """
    if db_path is None:
        db_path = DEFAULT_DB_PATH

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


def create_session(db_path: Path | None = None) -> Session:
    """Create a new database session (non-generator version).

    Use this when you need a session outside of a generator context.
    Remember to close the session when done!

    Args:
        db_path: Path to database file (default: local/caption_boundaries_training.db)

    Returns:
        SQLAlchemy Session (remember to close it!)

    Example:
        >>> db = create_session()
        >>> try:
        >>>     videos = db.query(VideoRegistry).all()
        >>> finally:
        >>>     db.close()
    """
    if db_path is None:
        db_path = DEFAULT_DB_PATH

    engine = create_engine(
        get_db_url(db_path),
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
    )

    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return SessionLocal()
