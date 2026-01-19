"""Mathematical utilities for OCR box model.

Provides numerical functions for Gaussian PDF, log-space arithmetic,
and other mathematical operations needed by the Naive Bayes classifier.
"""

import math

from ocr_box_model.config import EPSILON, MIN_STD, PDF_FLOOR


def gaussian_pdf(x: float, mean: float, std: float) -> float:
    """Calculate Gaussian probability density function.

    Args:
        x: Value to evaluate
        mean: Mean of distribution
        std: Standard deviation

    Returns:
        Probability density value
    """
    if std <= 0:
        # Degenerate case
        return 1.0 if abs(x - mean) < EPSILON else 1e-10

    variance = std**2
    coefficient = 1.0 / math.sqrt(2 * math.pi * variance)
    exponent = -0.5 * (x - mean) ** 2 / variance

    return coefficient * math.exp(exponent)


def log_gaussian_pdf(x: float, mean: float, std: float) -> float:
    """Calculate log of Gaussian PDF for numerical stability.

    Uses log-space to prevent underflow when multiplying many probabilities.

    Args:
        x: Value to evaluate
        mean: Mean of distribution
        std: Standard deviation

    Returns:
        Log of probability density value
    """
    # Floor the PDF before taking log to avoid log(0)
    pdf = gaussian_pdf(x, mean, std)
    return math.log(max(pdf, PDF_FLOOR))


def log_sum_exp(log_values: list[float]) -> float:
    """Compute log(sum(exp(values))) in a numerically stable way.

    Uses the log-sum-exp trick to prevent overflow/underflow.

    The trick: log(sum(exp(x_i))) = max(x) + log(sum(exp(x_i - max(x))))

    Args:
        log_values: List of log values

    Returns:
        log(sum(exp(values)))
    """
    if not log_values:
        return float("-inf")

    max_val = max(log_values)
    if max_val == float("-inf"):
        return float("-inf")

    # Compute sum of exp(x - max) which is numerically stable
    total = sum(math.exp(val - max_val) for val in log_values)

    return max_val + math.log(total)


def log_probs_to_probs(log_probs: list[float]) -> list[float]:
    """Convert log-probabilities to normalized probabilities.

    Uses log-sum-exp for numerical stability.

    Args:
        log_probs: List of log-probability values

    Returns:
        Normalized probability distribution summing to 1.0
    """
    if not log_probs:
        return []

    # Use log-sum-exp trick for normalization
    log_total = log_sum_exp(log_probs)

    if log_total == float("-inf") or not math.isfinite(log_total):
        # Degenerate case - return uniform distribution
        n = len(log_probs)
        return [1.0 / n] * n

    # Convert to probabilities
    return [math.exp(lp - log_total) for lp in log_probs]


def calculate_mean(values: list[float]) -> float:
    """Calculate arithmetic mean of values.

    Args:
        values: List of numeric values

    Returns:
        Arithmetic mean
    """
    if not values:
        return 0.0
    return sum(values) / len(values)


def calculate_std(values: list[float], mean: float | None = None) -> float:
    """Calculate standard deviation of values.

    Args:
        values: List of numeric values
        mean: Optional pre-computed mean

    Returns:
        Standard deviation (minimum MIN_STD to avoid numerical issues)
    """
    if not values:
        return MIN_STD

    if mean is None:
        mean = calculate_mean(values)

    variance = sum((val - mean) ** 2 for val in values) / len(values)
    std = math.sqrt(variance)

    # Use minimum std to avoid numerical precision issues
    return max(std, MIN_STD)


def calculate_mode(values: list[float], bin_size: float = 5.0) -> float:
    """Calculate mode (most common value) from array of numbers.

    Groups values into bins and finds the bin with highest frequency.

    Args:
        values: List of numeric values
        bin_size: Size of bins for grouping

    Returns:
        Mode value (center of most frequent bin)
    """
    if not values:
        return 0.0

    bins: dict[float, int] = {}
    for value in values:
        bin_key = round(value / bin_size) * bin_size
        bins[bin_key] = bins.get(bin_key, 0) + 1

    max_count = 0
    mode_value = 0.0
    for bin_key, count in bins.items():
        if count > max_count:
            max_count = count
            mode_value = bin_key

    return mode_value


def filter_outliers(values: list[float], k: float = 3.0) -> list[float]:
    """Filter outliers using IQR method.

    Uses k=3.0 (less aggressive than standard 1.5) to keep more valid boxes.

    Args:
        values: List of numeric values
        k: IQR multiplier (default 3.0)

    Returns:
        Filtered list with outliers removed
    """
    if len(values) < 10:
        return values

    sorted_values = sorted(values)
    q1_index = int(len(sorted_values) * 0.25)
    q3_index = int(len(sorted_values) * 0.75)
    q1 = sorted_values[q1_index]
    q3 = sorted_values[q3_index]
    iqr = q3 - q1

    lower_bound = q1 - k * iqr
    upper_bound = q3 + k * iqr

    filtered = [v for v in values if lower_bound <= v <= upper_bound]

    # Safety: if we filter out more than 10% of values, keep original
    if len(filtered) < len(values) * 0.9:
        return values

    return filtered
