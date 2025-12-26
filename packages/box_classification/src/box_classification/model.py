"""Gaussian Naive Bayes model for box classification."""

import math
from typing import TypedDict

import numpy as np


class GaussianParams(TypedDict):
    """Gaussian distribution parameters."""
    mean: float
    std: float


class ModelParams(TypedDict):
    """Complete model parameters."""
    model_version: str
    n_training_samples: int
    prior_in: float
    prior_out: float
    in_features: list[GaussianParams]  # 7 features
    out_features: list[GaussianParams]  # 7 features


def gaussian_pdf(x: float, mean: float, std: float) -> float:
    """
    Calculate Gaussian probability density function.

    P(x | μ, σ) = (1 / (σ√2π)) * exp(-0.5 * ((x - μ) / σ)²)

    Args:
        x: Value to evaluate
        mean: Distribution mean
        std: Distribution standard deviation

    Returns:
        Probability density at x
    """
    if std <= 0:
        # Degenerate case - all values are the same
        return 1.0 if abs(x - mean) < 1e-9 else 1e-10

    variance = std ** 2
    coefficient = 1.0 / math.sqrt(2 * math.pi * variance)
    exponent = -0.5 * ((x - mean) ** 2) / variance

    return coefficient * math.exp(exponent)


def train_gaussian_naive_bayes(
    features: np.ndarray,
    labels: np.ndarray
) -> ModelParams:
    """
    Train Gaussian Naive Bayes classifier.

    Args:
        features: Feature matrix (n_samples, 7)
        labels: Label array (n_samples,) with values 0 (out) or 1 (in)

    Returns:
        Model parameters including priors and Gaussian params for each feature
    """
    n_samples = len(labels)

    # Calculate class priors
    n_in = np.sum(labels == 1)
    n_out = np.sum(labels == 0)

    prior_in = n_in / n_samples
    prior_out = n_out / n_samples

    # Calculate Gaussian parameters for each feature per class
    in_features = []
    out_features = []

    # Get features for each class
    features_in = features[labels == 1]
    features_out = features[labels == 0]

    # For each of the 7 features
    for i in range(7):
        # "in" class
        if len(features_in) > 0:
            mean_in = float(np.mean(features_in[:, i]))
            std_in = float(np.std(features_in[:, i]))
            # Add small epsilon to prevent zero std
            std_in = max(std_in, 1e-6)
        else:
            mean_in = 0.0
            std_in = 1.0

        in_features.append({'mean': mean_in, 'std': std_in})

        # "out" class
        if len(features_out) > 0:
            mean_out = float(np.mean(features_out[:, i]))
            std_out = float(np.std(features_out[:, i]))
            # Add small epsilon to prevent zero std
            std_out = max(std_out, 1e-6)
        else:
            mean_out = 0.0
            std_out = 1.0

        out_features.append({'mean': mean_out, 'std': std_out})

    return {
        'model_version': 'naive_bayes_v1',
        'n_training_samples': n_samples,
        'prior_in': prior_in,
        'prior_out': prior_out,
        'in_features': in_features,
        'out_features': out_features,
    }


def predict(features: list[float], model: ModelParams) -> tuple[str, float]:
    """
    Predict label and confidence for a box using Bayesian inference.

    P(class|features) ∝ P(features|class) * P(class)
    P(features|class) = ∏ P(feature_i|class)  (Naive Bayes assumption)

    Args:
        features: List of 7 feature values
        model: Trained model parameters

    Returns:
        Tuple of (label, confidence) where label is 'in' or 'out'
        and confidence is the posterior probability [0-1]
    """
    # Calculate likelihoods: P(features|class) = ∏ Gaussian_PDF(feature_i)
    likelihood_in = 1.0
    likelihood_out = 1.0

    for i in range(7):
        feature_value = features[i]

        # P(feature_i | "in")
        likelihood_in *= gaussian_pdf(
            feature_value,
            model['in_features'][i]['mean'],
            model['in_features'][i]['std']
        )

        # P(feature_i | "out")
        likelihood_out *= gaussian_pdf(
            feature_value,
            model['out_features'][i]['mean'],
            model['out_features'][i]['std']
        )

    # Apply Bayes' theorem: P(class|features) ∝ P(features|class) * P(class)
    posterior_in = likelihood_in * model['prior_in']
    posterior_out = likelihood_out * model['prior_out']

    # Normalize to get probabilities
    total = posterior_in + posterior_out

    if total == 0:
        # Degenerate case - return uniform probability
        return ('in', 0.5)

    prob_in = posterior_in / total
    prob_out = posterior_out / total

    # Return label with higher probability
    if prob_in > prob_out:
        return ('in', prob_in)
    else:
        return ('out', prob_out)
