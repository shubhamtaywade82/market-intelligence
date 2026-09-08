import type { BootstrapConfidenceInterval } from './types.js';

export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly confidenceLevel: number;
}

/**
 * Calculates Wilson score interval for binomial proportions (e.g. hit rates).
 */
export function calculateWilsonInterval(
  successes: number,
  trials: number,
  z: number = 1.96
): ConfidenceInterval {
  if (trials === 0) {
    return { lower: 0, upper: 0, confidenceLevel: 0.95 };
  }

  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = p + z2 / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));

  const lower = Math.max(0, (center - spread) / denominator);
  const upper = Math.min(1, (center + spread) / denominator);

  return { lower, upper, confidenceLevel: 0.95 };
}

export interface StatisticalEdgeComparison {
  readonly baselineProbability: number;
  readonly eventProbability: number;
  readonly uplift: number;
  readonly relativeUplift: number;
  readonly oddsRatio: number;
  readonly sampleSize: number;
  readonly baselineSampleSize: number;
  readonly effectiveSampleSize: number;
  readonly isStatisticallySignificant: boolean;
  readonly pValueEstimate: number;
}

/**
 * Calculates effective sample size accounting for cluster correlation across episodes.
 */
export function calculateClusterEffectiveSampleSize(
  clusterSizes: readonly number[],
  icc: number = 0.25
): { effectiveN: number; designEffect: number } {
  const totalN = clusterSizes.reduce((sum, s) => sum + s, 0);
  if (totalN === 0 || clusterSizes.length === 0) {
    return { effectiveN: 0, designEffect: 1 };
  }

  const meanM = totalN / clusterSizes.length;
  const designEffect = Math.max(1, 1 + (meanM - 1) * icc);
  const effectiveN = Math.max(1, Math.round(totalN / designEffect));

  return { effectiveN, designEffect };
}

/**
 * Calculates non-parametric bootstrap confidence interval for medians (MFE/MAE ATR).
 */
export function calculateBootstrapMedianCi(
  values: readonly number[],
  iterations: number = 500
): BootstrapConfidenceInterval {
  if (values.length === 0) {
    return { lower: 0, upper: 0, pointEstimate: 0, standardError: 0 };
  }

  const sortedOrig = [...values].sort((a, b) => a - b);
  const pointEstimate = sortedOrig[Math.floor(sortedOrig.length / 2)]!;
  if (values.length === 1) {
    return { lower: pointEstimate, upper: pointEstimate, pointEstimate, standardError: 0 };
  }

  const medians: number[] = [];
  const n = values.length;
  // Deterministic pseudo-random seed for reproducible bootstrap
  let seed = 42;
  const pseudoRand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  for (let b = 0; b < iterations; b++) {
    const sample: number[] = [];
    for (let i = 0; i < n; i++) {
      sample.push(values[Math.floor(pseudoRand() * n)]!);
    }
    sample.sort((a, b) => a - b);
    medians.push(sample[Math.floor(n / 2)]!);
  }

  medians.sort((a, b) => a - b);
  const lowIdx = Math.floor(iterations * 0.025);
  const highIdx = Math.min(iterations - 1, Math.ceil(iterations * 0.975));

  const meanBoot = medians.reduce((s, v) => s + v, 0) / iterations;
  const variance = medians.reduce((s, v) => s + Math.pow(v - meanBoot, 2), 0) / iterations;

  return {
    lower: medians[lowIdx]!,
    upper: medians[highIdx]!,
    pointEstimate,
    standardError: Math.sqrt(variance)
  };
}

/**
 * Compares event hit rate against an unconditional or matched baseline control population.
 */
export function compareAgainstBaseline(
  eventHits: number,
  eventTrials: number,
  baselineHits: number,
  baselineTrials: number,
  clusterSizes?: readonly number[]
): StatisticalEdgeComparison {
  if (eventTrials === 0 || baselineTrials === 0) {
    return {
      baselineProbability: 0,
      eventProbability: 0,
      uplift: 0,
      relativeUplift: 0,
      oddsRatio: 1,
      sampleSize: eventTrials,
      baselineSampleSize: baselineTrials,
      effectiveSampleSize: eventTrials,
      isStatisticallySignificant: false,
      pValueEstimate: 1.0
    };
  }

  const p1 = eventHits / eventTrials;
  const p2 = baselineHits / baselineTrials;
  const uplift = p1 - p2;
  const relativeUplift = p2 > 0 ? uplift / p2 : 0;

  const odds1 = (p1 >= 1) ? 999 : p1 / Math.max(0.0001, 1 - p1);
  const odds2 = (p2 >= 1) ? 999 : p2 / Math.max(0.0001, 1 - p2);
  const oddsRatio = odds2 > 0 ? odds1 / odds2 : 1;

  const effN = clusterSizes ? calculateClusterEffectiveSampleSize(clusterSizes).effectiveN : eventTrials;

  const pPool = (eventHits + baselineHits) / (eventTrials + baselineTrials);
  const sePool = Math.sqrt(pPool * (1 - pPool) * (1 / effN + 1 / baselineTrials));

  if (sePool === 0) {
    return {
      baselineProbability: p2,
      eventProbability: p1,
      uplift,
      relativeUplift,
      oddsRatio,
      sampleSize: eventTrials,
      baselineSampleSize: baselineTrials,
      effectiveSampleSize: effN,
      isStatisticallySignificant: false,
      pValueEstimate: 1.0
    };
  }

  const zScore = uplift / sePool;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));

  return {
    baselineProbability: p2,
    eventProbability: p1,
    uplift,
    relativeUplift,
    oddsRatio,
    sampleSize: eventTrials,
    baselineSampleSize: baselineTrials,
    effectiveSampleSize: effN,
    isStatisticallySignificant: pValue < 0.05 && uplift > 0,
    pValueEstimate: Math.max(0, Math.min(1, pValue))
  };
}

function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absX);
  const erf = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * erf);
}
