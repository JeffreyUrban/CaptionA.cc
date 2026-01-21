"""Database operations for OCR box model.

Handles model loading/saving, schema migrations, and coordinate conversions.
"""

import json
import logging
import sqlite3

from ocr_box_model.types import (
    BoxBounds,
    FeatureImportanceMetrics,
    GaussianParams,
    ModelParams,
    VideoLayoutConfig,
)

logger = logging.getLogger(__name__)


def is_readonly_error(error: Exception) -> bool:
    """Check if error is a SQLite readonly error."""
    return "SQLITE_READONLY" in str(error) or "readonly" in str(error).lower()


# =============================================================================
# Schema Migrations
# =============================================================================


def migrate_model_schema(conn: sqlite3.Connection) -> None:
    """Migrate box_classification_model schema to 26-feature model if needed.

    Adds all required columns if they don't exist.
    """
    cursor = conn.cursor()

    # TODO: Remove this migration block once all layout-server.db files in Wasabi
    # have been recreated with the full schema from database_manager.py.
    # This is a temporary fix for databases created before Jan 2026 that are
    # missing base columns and spatial feature columns.
    base_columns = [
        ("n_training_samples", "INTEGER"),
        ("prior_in", "REAL"),
        ("prior_out", "REAL"),
    ]
    for col_name, col_type in base_columns:
        try:
            cursor.execute(f"SELECT {col_name} FROM box_classification_model WHERE id = 1")
        except sqlite3.OperationalError:
            try:
                cursor.execute(f"ALTER TABLE box_classification_model ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError:
                pass  # Column might already exist

    spatial_features = [
        "vertical_alignment",
        "height_similarity",
        "anchor_distance",
        "crop_overlap",
        "aspect_ratio",
        "normalized_y",
        "normalized_area",
    ]
    for feature in spatial_features:
        for prefix in ["in_", "out_"]:
            for suffix in ["_mean", "_std"]:
                col = f"{prefix}{feature}{suffix}"
                try:
                    cursor.execute(f"ALTER TABLE box_classification_model ADD COLUMN {col} REAL")
                except sqlite3.OperationalError:
                    pass  # Column already exists

    conn.commit()
    # END TODO

    # Check if 26-feature schema exists (edge positions)
    try:
        cursor.execute("SELECT in_normalized_left_mean FROM box_classification_model WHERE id = 1")
        return  # Schema already migrated
    except sqlite3.OperationalError:
        pass  # Need to migrate

    logger.info("Migrating to 26-feature schema")

    try:
        # Check if user annotation columns exist (features 8-9)
        try:
            cursor.execute("SELECT in_user_annotated_in_mean FROM box_classification_model WHERE id = 1")
        except sqlite3.OperationalError:
            # Add user annotation columns
            user_annotation_columns = [
                "in_user_annotated_in_mean",
                "in_user_annotated_in_std",
                "in_user_annotated_out_mean",
                "in_user_annotated_out_std",
                "out_user_annotated_in_mean",
                "out_user_annotated_in_std",
                "out_user_annotated_out_mean",
                "out_user_annotated_out_std",
            ]
            for col in user_annotation_columns:
                cursor.execute(f"ALTER TABLE box_classification_model ADD COLUMN {col} REAL")

        # Add edge position columns (features 10-13)
        edge_features = [
            "normalized_left",
            "normalized_top",
            "normalized_right",
            "normalized_bottom",
        ]
        for feature in edge_features:
            for prefix in ["in_", "out_"]:
                for suffix in ["_mean", "_std"]:
                    col = f"{prefix}{feature}{suffix}"
                    try:
                        cursor.execute(f"ALTER TABLE box_classification_model ADD COLUMN {col} REAL")
                    except sqlite3.OperationalError:
                        pass  # Column already exists

        # Add character set columns (features 14-24)
        charset_features = [
            "is_roman",
            "is_hanzi",
            "is_arabic",
            "is_korean",
            "is_hiragana",
            "is_katakana",
            "is_cyrillic",
            "is_devanagari",
            "is_thai",
            "is_digits",
            "is_punctuation",
        ]
        for feature in charset_features:
            for prefix in ["in_", "out_"]:
                for suffix in ["_mean", "_std"]:
                    col = f"{prefix}{feature}{suffix}"
                    try:
                        cursor.execute(f"ALTER TABLE box_classification_model ADD COLUMN {col} REAL")
                    except sqlite3.OperationalError:
                        pass

        # Add temporal columns (features 25-26)
        temporal_features = ["time_from_start", "time_from_end"]
        for feature in temporal_features:
            for prefix in ["in_", "out_"]:
                for suffix in ["_mean", "_std"]:
                    col = f"{prefix}{feature}{suffix}"
                    try:
                        cursor.execute(f"ALTER TABLE box_classification_model ADD COLUMN {col} REAL")
                    except sqlite3.OperationalError:
                        pass

        conn.commit()
        logger.info("Successfully migrated to 26-feature schema")

    except Exception as e:
        if is_readonly_error(e):
            return
        logger.error(f"Migration failed: {e}")
        raise


def migrate_streaming_prediction_schema(conn: sqlite3.Connection) -> None:
    """Add streaming prediction columns (feature_importance, covariance)."""
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT feature_importance FROM box_classification_model WHERE id = 1")
        return  # Already migrated
    except sqlite3.OperationalError:
        pass

    logger.info("Adding streaming prediction columns")

    try:
        cursor.execute("ALTER TABLE box_classification_model ADD COLUMN feature_importance TEXT")
        cursor.execute("ALTER TABLE box_classification_model ADD COLUMN covariance_matrix TEXT")
        cursor.execute("ALTER TABLE box_classification_model ADD COLUMN covariance_inverse TEXT")
        conn.commit()
    except Exception as e:
        if is_readonly_error(e):
            return
        logger.error(f"Streaming prediction migration failed: {e}")
        raise


def migrate_video_preferences_schema(conn: sqlite3.Connection) -> None:
    """Add index_framerate_hz to video_preferences if needed."""
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT index_framerate_hz FROM video_preferences WHERE id = 1")
        return
    except sqlite3.OperationalError:
        pass

    logger.info("Adding index_framerate_hz to video_preferences")

    try:
        cursor.execute("ALTER TABLE video_preferences ADD COLUMN index_framerate_hz REAL DEFAULT 10.0")
        cursor.execute("UPDATE video_preferences SET index_framerate_hz = 10.0 WHERE id = 1")
        conn.commit()
    except Exception as e:
        if is_readonly_error(e):
            return
        logger.error(f"Video preferences migration failed: {e}")
        raise


def migrate_full_frame_ocr_schema(conn: sqlite3.Connection) -> None:
    """Add timestamp_seconds to full_frame_ocr if needed."""
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT timestamp_seconds FROM full_frame_ocr LIMIT 1")
        # Check if we need to populate
        result = cursor.execute("SELECT COUNT(*) FROM full_frame_ocr WHERE timestamp_seconds IS NULL").fetchone()
        if result and result[0] == 0:
            return
    except sqlite3.OperationalError:
        # Column doesn't exist
        try:
            cursor.execute("ALTER TABLE full_frame_ocr ADD COLUMN timestamp_seconds REAL")
        except Exception as e:
            if is_readonly_error(e):
                return
            raise

    logger.info("Populating timestamp_seconds in full_frame_ocr")

    try:
        # Get index framerate
        result = cursor.execute("SELECT index_framerate_hz FROM video_preferences WHERE id = 1").fetchone()
        index_framerate = result[0] if result else 10.0

        # Populate timestamps
        cursor.execute(
            """
            UPDATE full_frame_ocr
            SET timestamp_seconds = frame_index / ?
            WHERE timestamp_seconds IS NULL
            """,
            (index_framerate,),
        )
        conn.commit()
    except Exception as e:
        if is_readonly_error(e):
            return
        logger.error(f"Full frame OCR migration failed: {e}")
        raise


def run_model_migrations(conn: sqlite3.Connection) -> None:
    """Run schema migrations for layout-server.db (model database)."""
    migrate_model_schema(conn)
    migrate_streaming_prediction_schema(conn)


def run_layout_migrations(conn: sqlite3.Connection) -> None:
    """Run schema migrations for layout.db (client-facing database)."""
    migrate_video_preferences_schema(conn)
    migrate_full_frame_ocr_schema(conn)


def run_all_migrations(conn: sqlite3.Connection) -> None:
    """Run all schema migrations. DEPRECATED: Use run_model_migrations or run_layout_migrations."""
    migrate_model_schema(conn)
    migrate_streaming_prediction_schema(conn)
    migrate_video_preferences_schema(conn)
    migrate_full_frame_ocr_schema(conn)


# =============================================================================
# Model Loading
# =============================================================================


def load_model(conn: sqlite3.Connection) -> ModelParams | None:
    """Load model parameters from database.

    Accepts both seed model (n_training_samples=0) and trained models (>=10).

    Args:
        conn: SQLite database connection (layout-server.db)

    Returns:
        ModelParams or None if no valid model exists
    """
    run_model_migrations(conn)

    cursor = conn.cursor()
    row = cursor.execute("SELECT * FROM box_classification_model WHERE id = 1").fetchone()

    if not row:
        return None

    # Get column names
    columns = [desc[0] for desc in cursor.description]
    row_dict = dict(zip(columns, row))

    n_samples = row_dict.get("n_training_samples", 0)

    # Reject models with 1-9 samples (insufficient)
    if n_samples > 0 and n_samples < 10:
        logger.warning(f"Model has insufficient samples ({n_samples})")
        return None

    # Parse feature parameters
    in_features = _parse_feature_params(row_dict, "in_")
    out_features = _parse_feature_params(row_dict, "out_")

    # Parse JSON columns
    feature_importance = None
    if row_dict.get("feature_importance"):
        try:
            data = json.loads(row_dict["feature_importance"])
            feature_importance = [
                FeatureImportanceMetrics(
                    feature_index=f["featureIndex"],
                    feature_name=f["featureName"],
                    fisher_score=f["fisherScore"],
                    importance_weight=f["importanceWeight"],
                    mean_difference=f["meanDifference"],
                )
                for f in data
            ]
        except Exception as e:
            logger.warning(f"Failed to parse feature_importance: {e}")

    covariance_matrix = None
    if row_dict.get("covariance_matrix"):
        try:
            covariance_matrix = json.loads(row_dict["covariance_matrix"])
        except Exception as e:
            logger.warning(f"Failed to parse covariance_matrix: {e}")

    covariance_inverse = None
    if row_dict.get("covariance_inverse"):
        try:
            covariance_inverse = json.loads(row_dict["covariance_inverse"])
        except Exception as e:
            logger.warning(f"Failed to parse covariance_inverse: {e}")

    return ModelParams(
        model_version=row_dict.get("model_version", "unknown"),
        n_training_samples=n_samples,
        prior_in=row_dict.get("prior_in", 0.5),
        prior_out=row_dict.get("prior_out", 0.5),
        in_features=in_features,
        out_features=out_features,
        feature_importance=feature_importance,
        covariance_matrix=covariance_matrix,
        covariance_inverse=covariance_inverse,
    )


def _parse_feature_params(row_dict: dict, prefix: str) -> list[GaussianParams]:
    """Parse feature parameters from database row."""
    # Feature column name patterns
    feature_columns = [
        # Spatial features (1-7)
        ("vertical_alignment", "vertical_alignment"),
        ("height_similarity", "height_similarity"),
        ("anchor_distance", "anchor_distance"),
        ("crop_overlap", "crop_overlap"),
        ("aspect_ratio", "aspect_ratio"),
        ("normalized_y", "normalized_y"),
        ("normalized_area", "normalized_area"),
        # User annotations (8-9)
        ("user_annotated_in", "user_annotated_in"),
        ("user_annotated_out", "user_annotated_out"),
        # Edge positions (10-13)
        ("normalized_left", "normalized_left"),
        ("normalized_top", "normalized_top"),
        ("normalized_right", "normalized_right"),
        ("normalized_bottom", "normalized_bottom"),
        # Character sets (14-24)
        ("is_roman", "is_roman"),
        ("is_hanzi", "is_hanzi"),
        ("is_arabic", "is_arabic"),
        ("is_korean", "is_korean"),
        ("is_hiragana", "is_hiragana"),
        ("is_katakana", "is_katakana"),
        ("is_cyrillic", "is_cyrillic"),
        ("is_devanagari", "is_devanagari"),
        ("is_thai", "is_thai"),
        ("is_digits", "is_digits"),
        ("is_punctuation", "is_punctuation"),
        # Temporal (25-26)
        ("time_from_start", "time_from_start"),
        ("time_from_end", "time_from_end"),
    ]

    params = []
    for col_name, _ in feature_columns:
        mean_key = f"{prefix}{col_name}_mean"
        std_key = f"{prefix}{col_name}_std"
        mean = row_dict.get(mean_key, 0.0) or 0.0
        std = row_dict.get(std_key, 1.0) or 1.0
        params.append(GaussianParams(mean=mean, std=std))

    return params


# =============================================================================
# Model Saving
# =============================================================================


def save_model(conn: sqlite3.Connection, model: ModelParams) -> None:
    """Save model parameters to database.

    Args:
        conn: SQLite database connection (layout-server.db)
        model: Model parameters to save
    """
    run_model_migrations(conn)

    # Build the INSERT/REPLACE statement
    in_flat = []
    out_flat = []
    for p in model.in_features:
        in_flat.extend([p.mean, p.std])
    for p in model.out_features:
        out_flat.extend([p.mean, p.std])

    # Convert feature importance to JSON
    fi_json = None
    if model.feature_importance:
        fi_json = json.dumps(
            [
                {
                    "featureIndex": f.feature_index,
                    "featureName": f.feature_name,
                    "fisherScore": f.fisher_score,
                    "importanceWeight": f.importance_weight,
                    "meanDifference": f.mean_difference,
                }
                for f in model.feature_importance
            ]
        )

    cov_json = json.dumps(model.covariance_matrix) if model.covariance_matrix else None
    inv_json = json.dumps(model.covariance_inverse) if model.covariance_inverse else None

    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT OR REPLACE INTO box_classification_model (
            id,
            model_version,
            trained_at,
            n_training_samples,
            prior_in,
            prior_out,
            in_vertical_alignment_mean, in_vertical_alignment_std,
            in_height_similarity_mean, in_height_similarity_std,
            in_anchor_distance_mean, in_anchor_distance_std,
            in_crop_overlap_mean, in_crop_overlap_std,
            in_aspect_ratio_mean, in_aspect_ratio_std,
            in_normalized_y_mean, in_normalized_y_std,
            in_normalized_area_mean, in_normalized_area_std,
            in_user_annotated_in_mean, in_user_annotated_in_std,
            in_user_annotated_out_mean, in_user_annotated_out_std,
            in_normalized_left_mean, in_normalized_left_std,
            in_normalized_top_mean, in_normalized_top_std,
            in_normalized_right_mean, in_normalized_right_std,
            in_normalized_bottom_mean, in_normalized_bottom_std,
            in_is_roman_mean, in_is_roman_std,
            in_is_hanzi_mean, in_is_hanzi_std,
            in_is_arabic_mean, in_is_arabic_std,
            in_is_korean_mean, in_is_korean_std,
            in_is_hiragana_mean, in_is_hiragana_std,
            in_is_katakana_mean, in_is_katakana_std,
            in_is_cyrillic_mean, in_is_cyrillic_std,
            in_is_devanagari_mean, in_is_devanagari_std,
            in_is_thai_mean, in_is_thai_std,
            in_is_digits_mean, in_is_digits_std,
            in_is_punctuation_mean, in_is_punctuation_std,
            in_time_from_start_mean, in_time_from_start_std,
            in_time_from_end_mean, in_time_from_end_std,
            out_vertical_alignment_mean, out_vertical_alignment_std,
            out_height_similarity_mean, out_height_similarity_std,
            out_anchor_distance_mean, out_anchor_distance_std,
            out_crop_overlap_mean, out_crop_overlap_std,
            out_aspect_ratio_mean, out_aspect_ratio_std,
            out_normalized_y_mean, out_normalized_y_std,
            out_normalized_area_mean, out_normalized_area_std,
            out_user_annotated_in_mean, out_user_annotated_in_std,
            out_user_annotated_out_mean, out_user_annotated_out_std,
            out_normalized_left_mean, out_normalized_left_std,
            out_normalized_top_mean, out_normalized_top_std,
            out_normalized_right_mean, out_normalized_right_std,
            out_normalized_bottom_mean, out_normalized_bottom_std,
            out_is_roman_mean, out_is_roman_std,
            out_is_hanzi_mean, out_is_hanzi_std,
            out_is_arabic_mean, out_is_arabic_std,
            out_is_korean_mean, out_is_korean_std,
            out_is_hiragana_mean, out_is_hiragana_std,
            out_is_katakana_mean, out_is_katakana_std,
            out_is_cyrillic_mean, out_is_cyrillic_std,
            out_is_devanagari_mean, out_is_devanagari_std,
            out_is_thai_mean, out_is_thai_std,
            out_is_digits_mean, out_is_digits_std,
            out_is_punctuation_mean, out_is_punctuation_std,
            out_time_from_start_mean, out_time_from_start_std,
            out_time_from_end_mean, out_time_from_end_std,
            feature_importance,
            covariance_matrix,
            covariance_inverse
        ) VALUES (
            1,
            ?,
            datetime('now'),
            ?,
            ?, ?,
            """
        + ", ".join(["?"] * 104)
        + """,
            ?, ?, ?
        )
        """,
        (
            model.model_version,
            model.n_training_samples,
            model.prior_in,
            model.prior_out,
            *in_flat,
            *out_flat,
            fi_json,
            cov_json,
            inv_json,
        ),
    )
    conn.commit()


# =============================================================================
# Layout Loading
# =============================================================================


def load_layout_config(conn: sqlite3.Connection) -> VideoLayoutConfig | None:
    """Load video layout configuration from database.

    Args:
        conn: SQLite database connection

    Returns:
        VideoLayoutConfig or None if not found
    """
    cursor = conn.cursor()
    row = cursor.execute(
        """
        SELECT
            frame_width, frame_height,
            crop_left, crop_top, crop_right, crop_bottom,
            vertical_center, anchor_type, anchor_position
        FROM layout_config
        WHERE id = 1
        """
    ).fetchone()

    if not row:
        return None

    return VideoLayoutConfig(
        frame_width=row[0],
        frame_height=row[1],
        crop_left=row[2] or 0,
        crop_top=row[3] or 0,
        crop_right=row[4] or row[0],
        crop_bottom=row[5] or row[1],
        vertical_position=row[6],
        anchor_type=row[7],
        anchor_position=row[8],
    )


def get_video_duration(conn: sqlite3.Connection) -> float:
    """Get video duration in seconds.

    Args:
        conn: SQLite database connection

    Returns:
        Duration in seconds (default 600.0)
    """
    cursor = conn.cursor()
    result = cursor.execute("SELECT duration_seconds FROM video_metadata WHERE id = 1").fetchone()
    return result[0] if result else 600.0


# =============================================================================
# Box Loading with Coordinate Conversion
# =============================================================================


def load_all_boxes(conn: sqlite3.Connection, frame_height: int) -> list[BoxBounds]:
    """Load all OCR boxes from database and convert to top-referenced coordinates.

    Database uses bottom-referenced coordinates (y=0 at bottom).
    Internal uses top-referenced coordinates (y=0 at top).

    Args:
        conn: SQLite database connection
        frame_height: Frame height in pixels

    Returns:
        List of BoxBounds in top-referenced coordinate system
    """
    cursor = conn.cursor()
    rows = cursor.execute(
        """
        SELECT
            bbox_left,
            bbox_top,
            bbox_right,
            bbox_bottom,
            frame_index,
            box_index,
            COALESCE(text, '') as text
        FROM boxes
        ORDER BY frame_index, box_index
        """
    ).fetchall()

    boxes = []
    for row in rows:
        bbox_left, bbox_top, bbox_right, bbox_bottom, frame_index, box_index, text = row

        # Convert from bottom-referenced to top-referenced
        box_left = int(bbox_left)
        box_top = frame_height - int(bbox_top)
        box_right = int(bbox_right)
        box_bottom = frame_height - int(bbox_bottom)

        # Sanity check
        box_width = box_right - box_left
        box_height = box_bottom - box_top

        if box_height < 10 or box_width < 10:
            continue

        boxes.append(
            BoxBounds(
                left=box_left,
                top=box_top,
                right=box_right,
                bottom=box_bottom,
                frame_index=frame_index,
                box_index=box_index,
                text=text,
            )
        )

    return boxes


def load_boxes_for_frame(conn: sqlite3.Connection, frame_index: int, frame_height: int) -> list[BoxBounds]:
    """Load OCR boxes for a specific frame.

    Args:
        conn: SQLite database connection
        frame_index: Frame index to load
        frame_height: Frame height in pixels

    Returns:
        List of BoxBounds for the frame
    """
    cursor = conn.cursor()
    rows = cursor.execute(
        """
        SELECT
            bbox_left,
            bbox_top,
            bbox_right,
            bbox_bottom,
            frame_index,
            box_index,
            COALESCE(text, '') as text
        FROM boxes
        WHERE frame_index = ?
        ORDER BY box_index
        """,
        (frame_index,),
    ).fetchall()

    boxes = []
    for row in rows:
        bbox_left, bbox_top, bbox_right, bbox_bottom, fi, box_index, text = row

        box_left = int(bbox_left)
        box_top = frame_height - int(bbox_top)
        box_right = int(bbox_right)
        box_bottom = frame_height - int(bbox_bottom)

        box_width = box_right - box_left
        box_height = box_bottom - box_top

        if box_height < 10 or box_width < 10:
            continue

        boxes.append(
            BoxBounds(
                left=box_left,
                top=box_top,
                right=box_right,
                bottom=box_bottom,
                frame_index=fi,
                box_index=box_index,
                text=text,
            )
        )

    return boxes


def get_box_text_and_timestamp(conn: sqlite3.Connection, frame_index: int, box_index: int) -> tuple[str, float]:
    """Get box text and timestamp from database.

    Args:
        conn: SQLite database connection
        frame_index: Frame index
        box_index: Box index

    Returns:
        Tuple of (text, timestamp_seconds)
    """
    cursor = conn.cursor()
    result = cursor.execute(
        """
        SELECT text, timestamp_seconds
        FROM full_frame_ocr
        WHERE frame_index = ? AND box_index = ?
        """,
        (frame_index, box_index),
    ).fetchone()

    if result:
        return (result[0] or "", result[1] or 0.0)
    return ("", 0.0)
