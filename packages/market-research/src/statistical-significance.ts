export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly confidenceLevel: number;
}

/**
 * Calculates Wilson score interval for binomial proportions (e.g. hit rates).
 * Superior to normal approximation especially for small sample sizes or extreme probabilities.
 */
export function calculateWilsonInterval(
  successes: number,
  trials: number,
  z: number = 1.96 // 95% confidence
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

  return {
    lower,
    upper,
    confidenceLevel: 0.95
  };
}

export interface StatisticalEdgeComparison {
  readonly baselineProbability: number;
  readonly eventProbability: number;
  readonly uplift: number;
  readonly sampleSize: number;
  readonly baselineSampleSize: number;
  readonly isStatisticallySignificant: boolean;
  readonly pValueEstimate: number;
}

/**
 * Compares event hit rate against an unconditional baseline control population using a two-proportion z-test.
 */
export function compareAgainstBaseline(
  eventHits: number,
  eventTrials: number,
  baselineHits: number,
  baselineTrials: number
): StatisticalEdgeComparison {
  if (eventTrials === 0 || baselineTrials === 0) {
    return {
      baselineProbability: 0,
      eventProbability: 0,
      uplift: 0,
      sampleSize: eventTrials,
      baselineSampleSize: baselineTrials,
      isStatisticallySignificant: false,
      pValueEstimate: 1.0
    };
  }

  const p1 = eventHits / eventTrials;
  const p2 = baselineHits / baselineTrials;
  const uplift = p1 - p2;

  // Pooled proportion
  const pPool = (eventHits + baselineHits) / (eventTrials + baselineTrials);
  const sePool = Math.sqrt(pPool * (1 - pPool) * (1 / eventTrials + 1 / baselineTrials));

  if (sePool === 0) {
    return {
      baselineProbability: p2,
      eventProbability: p1,
      uplift,
      sampleSize: eventTrials,
      baselineSampleSize: baselineTrials,
      isStatisticallySignificant: false,
      pValueEstimate: 1.0
    };
  }

  const zScore = uplift / sePool;
  // Two-tailed p-value approximation via standard normal error function
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));

  return {
    baselineProbability: p2,
    eventProbability: p1,
    uplift,
    sampleSize: eventTrials,
    baselineSampleSize: baselineTrials,
    isStatisticallySignificant: pValue < 0.05 && uplift > 0,
    pValueEstimate: Math.max(0, Math.min(1, pValue))
  };
}

function normalCdf(x: number): number {
  // Abramowitz and Stegun formula 7.1.26
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
