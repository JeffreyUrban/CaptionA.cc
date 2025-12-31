/**
 * Feature importance and covariance matrix computation.
 *
 * Provides utilities for:
 * - Fisher score calculation (feature importance)
 * - Pooled covariance matrix computation
 * - Mahalanobis distance calculation
 */

import {
  FEATURE_IMPORTANCE_CONFIG,
  FEATURE_NAMES,
  NUM_FEATURES,
  type FeatureImportanceMetrics,
} from './streaming-prediction-config'

/**
 * Gaussian parameters for a single feature.
 */
export interface GaussianParams {
  mean: number
  std: number
}

/**
 * Calculate Fisher score for feature importance.
 *
 * Fisher score measures how well a feature discriminates between classes.
 * Formula: Fisher_i = (μ_in,i - μ_out,i)² / (σ²_in,i + σ²_out,i)
 *
 * High score = feature strongly separates "in" vs "out" boxes.
 * Low score = feature has similar distribution in both classes.
 *
 * @param inFeatures - Gaussian parameters for "in" class (26 features)
 * @param outFeatures - Gaussian parameters for "out" class (26 features)
 * @returns Array of feature importance metrics, one per feature
 */
export function calculateFeatureImportance(
  inFeatures: GaussianParams[],
  outFeatures: GaussianParams[]
): FeatureImportanceMetrics[] {
  if (inFeatures.length !== NUM_FEATURES || outFeatures.length !== NUM_FEATURES) {
    throw new Error(
      `Expected ${NUM_FEATURES} features, got in=${inFeatures.length}, out=${outFeatures.length}`
    )
  }

  const importance = inFeatures.map((inParam, idx) => {
    const outParam = outFeatures[idx]!

    // Fisher score: mean difference squared / variance sum
    const meanDiff = Math.abs(inParam.mean - outParam.mean)
    const varianceSum = inParam.std ** 2 + outParam.std ** 2
    const fisherScore = varianceSum > 0 ? (meanDiff ** 2) / varianceSum : 0

    return {
      featureIndex: idx,
      featureName: FEATURE_NAMES[idx]!,
      fisherScore,
      meanDifference: meanDiff,
      importanceWeight: 0, // Will normalize below
    }
  })

  // Normalize to [0-1] weights
  const maxFisher = Math.max(...importance.map(f => f.fisherScore), 1e-10)
  if (maxFisher > 0) {
    importance.forEach(f => {
      f.importanceWeight = f.fisherScore / maxFisher
    })
  }

  return importance
}

/**
 * Sample features for a class.
 * Used to compute covariance matrix.
 */
export interface ClassSamples {
  /** Number of samples */
  n: number
  /** Feature matrix: n × 26 (each row is one sample's 26 features) */
  features: number[][]
}

/**
 * Compute pooled covariance matrix from both classes.
 *
 * Pooled covariance combines both "in" and "out" samples:
 * Σ_pooled = (n_in × Σ_in + n_out × Σ_out) / (n_in + n_out)
 *
 * This is the standard approach for Linear Discriminant Analysis (LDA)
 * and provides better sample efficiency than per-class covariance.
 *
 * @param inSamples - "in" class feature samples
 * @param outSamples - "out" class feature samples
 * @returns 26×26 pooled covariance matrix (flattened row-major: [row0, row1, ...])
 */
export function computePooledCovariance(
  inSamples: ClassSamples,
  outSamples: ClassSamples
): number[] {
  const totalSamples = inSamples.n + outSamples.n

  if (totalSamples < 2) {
    // Not enough samples for covariance - return identity matrix
    return createIdentityMatrix(NUM_FEATURES)
  }

  // Compute per-class covariance matrices
  const covIn = computeClassCovariance(inSamples)
  const covOut = computeClassCovariance(outSamples)

  // Weighted combination: pooled = (n_in × Σ_in + n_out × Σ_out) / (n_in + n_out)
  const pooled = new Array(NUM_FEATURES * NUM_FEATURES).fill(0)

  for (let i = 0; i < NUM_FEATURES * NUM_FEATURES; i++) {
    pooled[i] = (inSamples.n * covIn[i]! + outSamples.n * covOut[i]!) / totalSamples
  }

  return pooled
}

/**
 * Compute covariance matrix for a single class.
 *
 * Covariance measures how features vary together:
 * Cov(X_i, X_j) = E[(X_i - μ_i)(X_j - μ_j)]
 *
 * @param samples - Feature samples for one class
 * @returns 26×26 covariance matrix (flattened row-major)
 */
function computeClassCovariance(samples: ClassSamples): number[] {
  if (samples.n < 2) {
    // Need at least 2 samples for covariance - return identity
    return createIdentityMatrix(NUM_FEATURES)
  }

  // Compute mean for each feature
  const means = new Array(NUM_FEATURES).fill(0)
  for (const sample of samples.features) {
    for (let i = 0; i < NUM_FEATURES; i++) {
      means[i] += sample[i]!
    }
  }
  for (let i = 0; i < NUM_FEATURES; i++) {
    means[i] /= samples.n
  }

  // Compute covariance matrix: Σ[i,j] = Σ_k (x_k[i] - μ[i])(x_k[j] - μ[j]) / (n-1)
  const cov = new Array(NUM_FEATURES * NUM_FEATURES).fill(0)

  for (const sample of samples.features) {
    for (let i = 0; i < NUM_FEATURES; i++) {
      for (let j = 0; j < NUM_FEATURES; j++) {
        const dev_i = sample[i]! - means[i]!
        const dev_j = sample[j]! - means[j]!
        cov[i * NUM_FEATURES + j] += dev_i * dev_j
      }
    }
  }

  // Divide by (n-1) for unbiased estimate
  const divisor = samples.n - 1
  for (let i = 0; i < NUM_FEATURES * NUM_FEATURES; i++) {
    cov[i] /= divisor
  }

  return cov
}

/**
 * Create identity matrix of given size.
 *
 * @param size - Matrix dimension
 * @returns Flattened identity matrix (1s on diagonal, 0s elsewhere)
 */
function createIdentityMatrix(size: number): number[] {
  const matrix = new Array(size * size).fill(0)
  for (let i = 0; i < size; i++) {
    matrix[i * size + i] = 1.0
  }
  return matrix
}

/**
 * Invert a symmetric positive definite matrix using Cholesky decomposition.
 *
 * For covariance matrices, Cholesky is more stable than general inversion.
 * Falls back to diagonal approximation if matrix is not positive definite.
 *
 * @param matrix - 26×26 covariance matrix (flattened row-major)
 * @returns Inverted matrix, or diagonal approximation if inversion fails
 */
export function invertCovarianceMatrix(matrix: number[]): number[] {
  const n = NUM_FEATURES

  try {
    // Attempt Cholesky decomposition: A = L × L^T
    const L = choleskyDecomposition(matrix, n)

    // Invert L (lower triangular)
    const L_inv = invertLowerTriangular(L, n)

    // A^(-1) = (L × L^T)^(-1) = (L^T)^(-1) × L^(-1) = L^(-T) × L^(-1)
    const result = new Array(n * n).fill(0)

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0
        for (let k = 0; k < n; k++) {
          // L_inv^T[i,k] × L_inv[k,j]
          sum += L_inv[k * n + i]! * L_inv[k * n + j]!
        }
        result[i * n + j] = sum
      }
    }

    return result
  } catch {
    // Fallback: diagonal approximation (Naive Bayes assumption)
    console.warn('[invertCovarianceMatrix] Cholesky failed, using diagonal approximation')
    return invertDiagonalMatrix(matrix, n)
  }
}

/**
 * Cholesky decomposition of symmetric positive definite matrix.
 *
 * Decomposes A into A = L × L^T where L is lower triangular.
 *
 * @param A - Input matrix (flattened row-major)
 * @param n - Matrix dimension
 * @returns Lower triangular matrix L
 * @throws Error if matrix is not positive definite
 */
function choleskyDecomposition(A: number[], n: number): number[] {
  const L = new Array(n * n).fill(0)

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0

      if (j === i) {
        // Diagonal element
        for (let k = 0; k < j; k++) {
          sum += L[j * n + k]! ** 2
        }
        const diag = A[j * n + j]! - sum
        if (diag <= 0) {
          throw new Error(`Matrix not positive definite at diagonal ${j}`)
        }
        L[j * n + j] = Math.sqrt(diag)
      } else {
        // Off-diagonal element
        for (let k = 0; k < j; k++) {
          sum += L[i * n + k]! * L[j * n + k]!
        }
        L[i * n + j] = (A[i * n + j]! - sum) / L[j * n + j]!
      }
    }
  }

  return L
}

/**
 * Invert lower triangular matrix.
 *
 * @param L - Lower triangular matrix
 * @param n - Matrix dimension
 * @returns Inverted lower triangular matrix
 */
function invertLowerTriangular(L: number[], n: number): number[] {
  const L_inv = new Array(n * n).fill(0)

  for (let i = 0; i < n; i++) {
    // Diagonal element
    L_inv[i * n + i] = 1.0 / L[i * n + i]!

    // Off-diagonal elements
    for (let j = i + 1; j < n; j++) {
      let sum = 0
      for (let k = i; k < j; k++) {
        sum += L[j * n + k]! * L_inv[k * n + i]!
      }
      L_inv[j * n + i] = -sum / L[j * n + j]!
    }
  }

  return L_inv
}

/**
 * Invert diagonal matrix (fallback when Cholesky fails).
 *
 * For diagonal matrix, inverse is just reciprocals of diagonal elements.
 * This corresponds to the Naive Bayes independence assumption.
 *
 * @param matrix - Covariance matrix
 * @param n - Matrix dimension
 * @returns Diagonal inverse matrix
 */
function invertDiagonalMatrix(matrix: number[], n: number): number[] {
  const inv = new Array(n * n).fill(0)

  for (let i = 0; i < n; i++) {
    const diag = matrix[i * n + i]!
    inv[i * n + i] = diag > 0 ? 1.0 / diag : 1.0
  }

  return inv
}

/**
 * Compute Mahalanobis distance between two feature vectors.
 *
 * D_M(x, y) = sqrt((x - y)^T × Σ^(-1) × (x - y))
 *
 * where Σ^(-1) is the inverse covariance matrix.
 *
 * Mahalanobis distance is scale-invariant and accounts for feature correlations.
 * Features with high variance contribute less to the distance.
 *
 * @param x - First feature vector (26 features)
 * @param y - Second feature vector (26 features)
 * @param covarianceInverse - Inverse covariance matrix (676 values, row-major)
 * @returns Mahalanobis distance (>= 0)
 */
export function computeMahalanobisDistance(
  x: number[],
  y: number[],
  covarianceInverse: number[]
): number {
  if (x.length !== NUM_FEATURES || y.length !== NUM_FEATURES) {
    throw new Error(`Expected ${NUM_FEATURES} features, got x=${x.length}, y=${y.length}`)
  }

  if (covarianceInverse.length !== NUM_FEATURES * NUM_FEATURES) {
    throw new Error(
      `Expected ${NUM_FEATURES * NUM_FEATURES} covariance values, got ${covarianceInverse.length}`
    )
  }

  // Compute difference vector: diff = x - y
  const diff = x.map((xi, i) => xi - y[i]!)

  // Compute diff^T × Σ^(-1) × diff
  let sum = 0
  for (let i = 0; i < NUM_FEATURES; i++) {
    for (let j = 0; j < NUM_FEATURES; j++) {
      sum += diff[i]! * covarianceInverse[i * NUM_FEATURES + j]! * diff[j]!
    }
  }

  // Return sqrt, ensuring non-negative for numerical stability
  return Math.sqrt(Math.max(0, sum))
}

/**
 * Check if feature importance calculation should run.
 *
 * @param nSamples - Number of training samples
 * @returns Whether to calculate feature importance
 */
export function shouldCalculateFeatureImportance(nSamples: number): boolean {
  return nSamples >= FEATURE_IMPORTANCE_CONFIG.MIN_SAMPLES_FOR_IMPORTANCE
}
