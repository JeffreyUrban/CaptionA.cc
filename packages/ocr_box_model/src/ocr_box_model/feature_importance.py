"""Feature importance and covariance matrix computation.

Provides utilities for:
- Fisher score calculation (feature importance)
- Pooled covariance matrix computation
- Mahalanobis distance calculation
"""

import logging
import math

from ocr_box_model.config import (
    FEATURE_NAMES,
    MIN_SAMPLES_FOR_IMPORTANCE,
    NUM_FEATURES,
)
from ocr_box_model.types import ClassSamples, FeatureImportanceMetrics, GaussianParams

logger = logging.getLogger(__name__)


def calculate_feature_importance(
    in_features: list[GaussianParams],
    out_features: list[GaussianParams],
) -> list[FeatureImportanceMetrics]:
    """Calculate Fisher score for feature importance.

    Fisher score measures how well a feature discriminates between classes.
    Formula: Fisher_i = (μ_in,i - μ_out,i)² / (σ²_in,i + σ²_out,i)

    High score = feature strongly separates "in" vs "out" boxes.
    Low score = feature has similar distribution in both classes.

    Args:
        in_features: Gaussian parameters for "in" class (26 features)
        out_features: Gaussian parameters for "out" class (26 features)

    Returns:
        List of feature importance metrics, one per feature
    """
    if len(in_features) != NUM_FEATURES or len(out_features) != NUM_FEATURES:
        raise ValueError(f"Expected {NUM_FEATURES} features, got in={len(in_features)}, out={len(out_features)}")

    importance: list[FeatureImportanceMetrics] = []

    for idx in range(NUM_FEATURES):
        in_param = in_features[idx]
        out_param = out_features[idx]

        # Fisher score: mean difference squared / variance sum
        mean_diff = abs(in_param.mean - out_param.mean)
        variance_sum = in_param.std**2 + out_param.std**2
        fisher_score = (mean_diff**2 / variance_sum) if variance_sum > 0 else 0.0

        importance.append(
            FeatureImportanceMetrics(
                feature_index=idx,
                feature_name=FEATURE_NAMES[idx],
                fisher_score=fisher_score,
                mean_difference=mean_diff,
                importance_weight=0.0,  # Will normalize below
            )
        )

    # Normalize to [0-1] weights
    max_fisher = max((f.fisher_score for f in importance), default=1e-10)
    if max_fisher > 0:
        for f in importance:
            f.importance_weight = f.fisher_score / max_fisher

    return importance


def should_calculate_feature_importance(n_samples: int) -> bool:
    """Check if feature importance calculation should run.

    Args:
        n_samples: Number of training samples

    Returns:
        Whether to calculate feature importance
    """
    return n_samples >= MIN_SAMPLES_FOR_IMPORTANCE


def create_identity_matrix(size: int) -> list[float]:
    """Create identity matrix of given size.

    Args:
        size: Matrix dimension

    Returns:
        Flattened identity matrix (1s on diagonal, 0s elsewhere)
    """
    matrix = [0.0] * (size * size)
    for i in range(size):
        matrix[i * size + i] = 1.0
    return matrix


def compute_feature_means(samples: ClassSamples) -> list[float]:
    """Compute feature means from sample features.

    Args:
        samples: Class samples

    Returns:
        Mean value for each feature
    """
    means = [0.0] * NUM_FEATURES
    for sample in samples.features:
        for i in range(NUM_FEATURES):
            means[i] += sample[i] if i < len(sample) else 0.0
    for i in range(NUM_FEATURES):
        means[i] /= samples.n
    return means


def compute_class_covariance(samples: ClassSamples) -> list[float]:
    """Compute covariance matrix for a single class.

    Covariance measures how features vary together:
    Cov(X_i, X_j) = E[(X_i - μ_i)(X_j - μ_j)]

    Args:
        samples: Feature samples for one class

    Returns:
        Flattened covariance matrix (row-major)
    """
    if samples.n < 2:
        return create_identity_matrix(NUM_FEATURES)

    means = compute_feature_means(samples)
    cov = [0.0] * (NUM_FEATURES * NUM_FEATURES)

    for sample in samples.features:
        for i in range(NUM_FEATURES):
            for j in range(NUM_FEATURES):
                dev_i = (sample[i] if i < len(sample) else 0.0) - means[i]
                dev_j = (sample[j] if j < len(sample) else 0.0) - means[j]
                cov[i * NUM_FEATURES + j] += dev_i * dev_j

    # Normalize by n-1 (unbiased estimator)
    for i in range(len(cov)):
        cov[i] /= samples.n - 1

    return cov


def compute_pooled_covariance(
    in_samples: ClassSamples,
    out_samples: ClassSamples,
) -> list[float]:
    """Compute pooled covariance matrix from both classes.

    Pooled covariance combines both "in" and "out" samples:
    Σ_pooled = (n_in × Σ_in + n_out × Σ_out) / (n_in + n_out)

    Args:
        in_samples: "in" class feature samples
        out_samples: "out" class feature samples

    Returns:
        Flattened pooled covariance matrix (row-major)
    """
    total_samples = in_samples.n + out_samples.n

    if total_samples < 2:
        return create_identity_matrix(NUM_FEATURES)

    cov_in = compute_class_covariance(in_samples)
    cov_out = compute_class_covariance(out_samples)

    # Weighted combination
    pooled = [0.0] * (NUM_FEATURES * NUM_FEATURES)
    for i in range(len(pooled)):
        pooled[i] = (in_samples.n * cov_in[i] + out_samples.n * cov_out[i]) / total_samples

    return pooled


def cholesky_decomposition(A: list[float], n: int) -> list[float]:
    """Cholesky decomposition of symmetric positive definite matrix.

    Decomposes A into A = L × L^T where L is lower triangular.

    Args:
        A: Input matrix (flattened row-major)
        n: Matrix dimension

    Returns:
        Lower triangular matrix L

    Raises:
        ValueError: If matrix is not positive definite
    """
    L = [0.0] * (n * n)

    for i in range(n):
        for j in range(i + 1):
            total = 0.0

            if j == i:
                # Diagonal element
                for k in range(j):
                    total += L[j * n + k] ** 2
                diag = A[j * n + j] - total
                if diag <= 0:
                    raise ValueError(f"Matrix not positive definite at diagonal {j}")
                L[j * n + j] = math.sqrt(diag)
            else:
                # Off-diagonal element
                for k in range(j):
                    total += L[i * n + k] * L[j * n + k]
                L_jj = L[j * n + j] if L[j * n + j] != 0 else 1.0
                L[i * n + j] = (A[i * n + j] - total) / L_jj

    return L


def invert_lower_triangular(L: list[float], n: int) -> list[float]:
    """Invert lower triangular matrix.

    Args:
        L: Lower triangular matrix
        n: Matrix dimension

    Returns:
        Inverted lower triangular matrix
    """
    L_inv = [0.0] * (n * n)

    for i in range(n):
        # Diagonal element
        L_ii = L[i * n + i] if L[i * n + i] != 0 else 1.0
        L_inv[i * n + i] = 1.0 / L_ii

        # Off-diagonal elements
        for j in range(i + 1, n):
            total = 0.0
            for k in range(i, j):
                total += L[j * n + k] * L_inv[k * n + i]
            L_jj = L[j * n + j] if L[j * n + j] != 0 else 1.0
            L_inv[j * n + i] = -total / L_jj

    return L_inv


def invert_diagonal_matrix(matrix: list[float], n: int) -> list[float]:
    """Invert diagonal matrix (fallback when Cholesky fails).

    Args:
        matrix: Covariance matrix
        n: Matrix dimension

    Returns:
        Diagonal inverse matrix
    """
    inv = [0.0] * (n * n)
    for i in range(n):
        diag = matrix[i * n + i]
        inv[i * n + i] = 1.0 / diag if diag > 0 else 1.0
    return inv


def invert_covariance_matrix(matrix: list[float]) -> list[float]:
    """Invert a symmetric positive definite matrix using Cholesky decomposition.

    Falls back to diagonal approximation if matrix is not positive definite.

    Args:
        matrix: Flattened covariance matrix (row-major)

    Returns:
        Inverted matrix
    """
    n = NUM_FEATURES

    try:
        # Attempt Cholesky decomposition: A = L × L^T
        L = cholesky_decomposition(matrix, n)

        # Invert L (lower triangular)
        L_inv = invert_lower_triangular(L, n)

        # A^(-1) = (L × L^T)^(-1) = L^(-T) × L^(-1)
        result = [0.0] * (n * n)
        for i in range(n):
            for j in range(n):
                total = 0.0
                for k in range(n):
                    # L_inv^T[i,k] × L_inv[k,j]
                    L_inv_ki = L_inv[k * n + i]
                    L_inv_kj = L_inv[k * n + j]
                    total += L_inv_ki * L_inv_kj
                result[i * n + j] = total

        return result

    except ValueError:
        logger.warning("Cholesky failed, using diagonal approximation")
        return invert_diagonal_matrix(matrix, n)


def compute_mahalanobis_distance(
    x: list[float],
    y: list[float],
    covariance_inverse: list[float],
) -> float:
    """Compute Mahalanobis distance between two feature vectors.

    D_M(x, y) = sqrt((x - y)^T × Σ^(-1) × (x - y))

    Mahalanobis distance is scale-invariant and accounts for feature correlations.

    Args:
        x: First feature vector (26 features)
        y: Second feature vector (26 features)
        covariance_inverse: Inverse covariance matrix (676 values)

    Returns:
        Mahalanobis distance (>= 0)
    """
    if len(x) != NUM_FEATURES or len(y) != NUM_FEATURES:
        raise ValueError(f"Expected {NUM_FEATURES} features, got x={len(x)}, y={len(y)}")

    if len(covariance_inverse) != NUM_FEATURES * NUM_FEATURES:
        raise ValueError(f"Expected {NUM_FEATURES * NUM_FEATURES} covariance values, got {len(covariance_inverse)}")

    # Compute difference vector
    diff = [x[i] - y[i] for i in range(NUM_FEATURES)]

    # Compute diff^T × Σ^(-1) × diff
    total = 0.0
    for i in range(NUM_FEATURES):
        for j in range(NUM_FEATURES):
            total += diff[i] * covariance_inverse[i * NUM_FEATURES + j] * diff[j]

    # Return sqrt, ensuring non-negative
    return math.sqrt(max(0.0, total))
