import { describe, expect, it } from 'vitest';
import {
  buildFvgEvidenceSignal,
  computeMayConsiderSetup,
  type AgentRunStatus,
} from '../src/evidence-signal.js';
import type { ResearchResult } from '../src/types.js';

function mockFvgResult(overrides: Partial<ResearchResult> = {}): ResearchResult {
  const base: ResearchResult = {
    population: { symbol: 'BTCUSDT', timeframe: '15m', candleCount: 500 },
    sample: { eventType: 'fvg', sampleSize: 120, effectiveSampleSize: 90, clusterCount: 12 },
    controls: { sampleSize: 120, matchedHitRateR2: 0.32, matchRatio: 0.85 },
    descriptive: {
      reachRates: { r1: 0.7, r2: 0.61, r3: 0.4 },
      hitRates: { r1: 0.7, r2: 0.61, r3: 0.4 },
      medianMfeAtr: 1.1,
      medianMaeAtr: 0.8,
      retestProbability: 0.5,
      fill25Rate: 0.4,
      fill50Rate: 0.3,
      fullFillRate: 0.2,
    },
    effect: { uplift: 0.29, relativeUplift: 0.9, oddsRatio: 3.2 },
    uncertainty: { confidenceIntervalR2: { lower: 0.53, upper: 0.68 } },
    dependence: {
      clusterCount: 12,
      effectiveSampleSize: 90,
      pValueEstimate: 0.001,
      isStatisticallySignificant: true,
      adjustedPValue: 0.004,
      isFdrSignificant: true,
    },
    provenance: {
      datasetId: 'BTCUSDT-15m',
      datasetHash: 'abc',
      detectorId: 'fvg',
      detectorVersion: '1.0.0',
      detectorConfigHash: 'x',
      outcomeConfigHash: 'y',
      outcomeVersion: '1.0.0',
    },
    evidenceStatus: 'robust',
  };
  return { ...base, ...overrides };
}

describe('buildFvgEvidenceSignal', () => {
  it('marks mayConsiderSetup when evidence is allowed and walk-forward is stable', () => {
    const signal = buildFvgEvidenceSignal(mockFvgResult(), {
      klineMarket: 'usdm_futures',
      walkForwardStable: true,
      agentRunStatus: 'ACHIEVED' as AgentRunStatus,
      agentReport: 'FVG edge persists OOS.',
    });
    expect(signal.readOnly).toBe(true);
    expect(signal.mayConsiderSetup).toBe(true);
    expect(signal.walkForwardStable).toBe(true);
    expect(signal.agentRunStatus).toBe('ACHIEVED');
    expect(signal.reachRate2R).toBeCloseTo(0.61);
  });

  it('blocks when evidence status is insufficient_sample', () => {
    const blocked = mockFvgResult({ evidenceStatus: 'insufficient_sample' });
    expect(computeMayConsiderSetup(blocked)).toBe(false);
  });
});
