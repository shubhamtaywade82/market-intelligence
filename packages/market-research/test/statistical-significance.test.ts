import { describe, expect, it } from 'vitest';
import { calculateWilsonInterval, compareAgainstBaseline } from '../src/statistical-significance.js';

describe('Statistical Significance & Wilson Intervals', () => {
  it('calculates Wilson score confidence interval around binomial proportions', () => {
    // 60 successes out of 100 trials (p = 0.60)
    const ci = calculateWilsonInterval(60, 100);
    expect(ci.lower).toBeGreaterThan(0.49);
    expect(ci.lower).toBeLessThan(0.60);
    expect(ci.upper).toBeGreaterThan(0.60);
    expect(ci.upper).toBeLessThan(0.70);
  });

  it('detects significant edge uplift against unconditional baseline control', () => {
    // Event: 75 hits out of 100 trials (75%)
    // Baseline control: 50 hits out of 100 trials (50%)
    const comparison = compareAgainstBaseline(75, 100, 50, 100);

    expect(comparison.uplift).toBe(0.25);
    expect(comparison.isStatisticallySignificant).toBe(true);
    expect(comparison.pValueEstimate).toBeLessThan(0.01);
  });

  it('correctly marks insignificant uplift when sample size is small', () => {
    // 3 hits out of 4 (75%) vs 2 hits out of 4 (50%)
    const comparison = compareAgainstBaseline(3, 4, 2, 4);
    expect(comparison.isStatisticallySignificant).toBe(false);
    expect(comparison.pValueEstimate).toBeGreaterThan(0.05);
  });
});
