import { describe, expect, it } from 'vitest';
import {
  computeBrierScore,
  partitionIntoBins,
  computeCalibrationMetrics,
  type PredictionPoint
} from '../src/calibration.js';

describe('Probability Calibration & Reliability Scoring', () => {
  it('computes 0 Brier score and 0 ECE for perfectly calibrated deterministic predictions', () => {
    const perfect: PredictionPoint[] = [
      { probability: 1.0, actual: true },
      { probability: 1.0, actual: true },
      { probability: 0.0, actual: false },
      { probability: 0.0, actual: false }
    ];

    const metrics = computeCalibrationMetrics(perfect, 10);
    expect(metrics.sampleSize).toBe(4);
    expect(metrics.brierScore).toBe(0);
    expect(metrics.expectedCalibrationError).toBe(0);
    expect(metrics.maximumCalibrationError).toBe(0);
    expect(metrics.baseRate).toBe(0.5);
  });

  it('computes exact Brier score for coin-flip 50/50 predictions', () => {
    const coinFlip: PredictionPoint[] = [
      { probability: 0.5, actual: true },
      { probability: 0.5, actual: false },
      { probability: 0.5, actual: true },
      { probability: 0.5, actual: false }
    ];

    const brier = computeBrierScore(coinFlip);
    // (0.5 - 1)^2 = 0.25, (0.5 - 0)^2 = 0.25 -> mean = 0.25
    expect(brier).toBe(0.25);

    const metrics = computeCalibrationMetrics(coinFlip, 10);
    expect(metrics.expectedCalibrationError).toBe(0); // bin [0.5, 0.6) has mean 0.5 and empirical accuracy 0.5
  });

  it('measures Expected Calibration Error (ECE) for an overconfident model', () => {
    // Model predicts 90% confidence, but actual win rate is only 50%
    const overconfident: PredictionPoint[] = [
      { probability: 0.9, actual: true },
      { probability: 0.9, actual: false },
      { probability: 0.9, actual: true },
      { probability: 0.9, actual: false }
    ];

    const metrics = computeCalibrationMetrics(overconfident, 10);
    // Error in 0.9-1.0 bin is |0.9 - 0.5| = 0.4
    expect(metrics.expectedCalibrationError).toBeCloseTo(0.4, 4);
    expect(metrics.maximumCalibrationError).toBeCloseTo(0.4, 4);
    expect(metrics.brierScore).toBeCloseTo(0.41, 4); // (0.9 - 1)^2 * 0.5 + (0.9 - 0)^2 * 0.5 = 0.01*0.5 + 0.81*0.5 = 0.41
  });

  it('verifies Murphy Brier decomposition components', () => {
    const predictions: PredictionPoint[] = [
      { probability: 0.8, actual: true },
      { probability: 0.8, actual: true },
      { probability: 0.2, actual: false },
      { probability: 0.2, actual: true }
    ];

    const metrics = computeCalibrationMetrics(predictions, 5);
    const { reliability, resolution, uncertainty } = metrics.brierDecomposition;

    // Brier ≈ Reliability - Resolution + Uncertainty
    const reconstructedBrier = reliability - resolution + uncertainty;
    expect(reconstructedBrier).toBeCloseTo(metrics.brierScore, 3);
  });

  it('handles empty input gracefully', () => {
    const emptyMetrics = computeCalibrationMetrics([]);
    expect(emptyMetrics.sampleSize).toBe(0);
    expect(emptyMetrics.brierScore).toBe(0);
    expect(emptyMetrics.expectedCalibrationError).toBe(0);
    expect(emptyMetrics.bins).toHaveLength(0);
  });

  it('partitions probabilities into specified number of bins', () => {
    const points: PredictionPoint[] = [
      { probability: 0.05, actual: false },
      { probability: 0.35, actual: false },
      { probability: 0.85, actual: true }
    ];

    const bins = partitionIntoBins(points, 5);
    expect(bins).toHaveLength(5);
    expect(bins[0]!.sampleCount).toBe(1); // 0.05 in [0.0, 0.2)
    expect(bins[1]!.sampleCount).toBe(1); // 0.35 in [0.2, 0.4)
    expect(bins[4]!.sampleCount).toBe(1); // 0.85 in [0.8, 1.0)
  });
});
