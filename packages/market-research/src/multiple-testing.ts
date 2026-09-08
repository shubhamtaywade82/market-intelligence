export interface HypothesisTest {
  readonly id: string;
  readonly description: string;
  readonly pValue: number;
  readonly effectSize?: number | undefined;
}

export interface AdjustedTestResult extends HypothesisTest {
  readonly adjustedPValue: number;
  readonly isSignificant: boolean;
  readonly rank: number;
}

/**
 * Applies the Benjamini-Hochberg (BH) procedure to control the False Discovery Rate (FDR).
 */
export function adjustBenjaminiHochberg(
  tests: readonly HypothesisTest[],
  alpha: number = 0.05
): readonly AdjustedTestResult[] {
  const m = tests.length;
  if (m === 0) return [];

  // Sort by raw p-value ascending
  const sorted = [...tests]
    .map((t, originalIndex) => ({ test: t, originalIndex }))
    .sort((a, b) => a.test.pValue - b.test.pValue);

  // Compute BH adjusted p-values: q_(k) = min_{j >= k} (m / j * p_(j))
  const rawQ = sorted.map((item, idx) => {
    const k = idx + 1;
    return Math.min(1, (m / k) * item.test.pValue);
  });

  // Enforce monotonicity backward from m to 1
  const adjustedPValues = new Array<number>(m);
  let runningMin = 1.0;
  for (let i = m - 1; i >= 0; i--) {
    runningMin = Math.min(runningMin, rawQ[i]!);
    adjustedPValues[i] = runningMin;
  }

  // Restore original order or return ranked
  return sorted.map((item, idx) => ({
    ...item.test,
    rank: idx + 1,
    adjustedPValue: adjustedPValues[idx]!,
    isSignificant: adjustedPValues[idx]! <= alpha
  }));
}

/**
 * Applies the Holm-Bonferroni step-down procedure to strongly control Family-Wise Error Rate (FWER).
 */
export function adjustHolmBonferroni(
  tests: readonly HypothesisTest[],
  alpha: number = 0.05
): readonly AdjustedTestResult[] {
  const m = tests.length;
  if (m === 0) return [];

  const sorted = [...tests]
    .map((t, originalIndex) => ({ test: t, originalIndex }))
    .sort((a, b) => a.test.pValue - b.test.pValue);

  // Step-down: p_adj_(k) = (m - k + 1) * p_(k)
  // Monotonicity enforced forward: p_adj_(k) = max_{j <= k} min(1, (m - j + 1) * p_(j))
  let runningMax = 0;
  return sorted.map((item, idx) => {
    const k = idx + 1;
    const stepValue = Math.min(1, (m - k + 1) * item.test.pValue);
    runningMax = Math.max(runningMax, stepValue);
    return {
      ...item.test,
      rank: k,
      adjustedPValue: runningMax,
      isSignificant: runningMax <= alpha
    };
  });
}

/**
 * Thread-safe registry for collecting hypotheses across multi-feature scans.
 */
export class HypothesisRegistry {
  private readonly tests: HypothesisTest[] = [];

  register(test: HypothesisTest): void {
    this.tests.push(test);
  }

  getAll(): readonly HypothesisTest[] {
    return this.tests;
  }

  applyBenjaminiHochberg(alpha: number = 0.05): readonly AdjustedTestResult[] {
    return adjustBenjaminiHochberg(this.tests, alpha);
  }

  applyHolmBonferroni(alpha: number = 0.05): readonly AdjustedTestResult[] {
    return adjustHolmBonferroni(this.tests, alpha);
  }
}
