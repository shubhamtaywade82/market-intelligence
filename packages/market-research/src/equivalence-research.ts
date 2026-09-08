import type { BaseEvent, MarketEvent } from '@nemesis-oss/market-events';
import { normalCdf } from './statistical-significance.js';
import type { ResearchObservation } from './types.js';

export type CanonicalBehaviorType =
  | 'FAILED_DOWNSIDE_AUCTION'
  | 'FAILED_UPSIDE_AUCTION'
  | 'AGGRESSIVE_DIRECTIONAL_EXPANSION'
  | 'LIQUIDITY_IMBALANCE';

export interface CanonicalMapping {
  readonly canonicalType: CanonicalBehaviorType;
  readonly matchedEvents: readonly BaseEvent[];
  readonly representations: readonly string[];
  readonly timestamp: number;
}

export function mapToCanonicalEquivalence(events: readonly (BaseEvent | MarketEvent)[]): CanonicalMapping[] {
  const byTimestamp = new Map<number, (BaseEvent | MarketEvent)[]>();

  for (const e of events) {
    const list = byTimestamp.get(e.detectedAt) ?? [];
    list.push(e);
    byTimestamp.set(e.detectedAt, list);
  }

  const mappings: CanonicalMapping[] = [];

  for (const [timestamp, group] of byTimestamp.entries()) {
    const types = group.map(e => {
      const me = e as MarketEvent;
      if (me.type === 'liquidity_sweep') return 'SMC_SWEEP';
      if (me.type === 'wyckoff' && me.wyckoffType === 'spring') return 'WYCKOFF_SPRING';
      if (me.type === 'wyckoff' && me.wyckoffType === 'upthrust') return 'WYCKOFF_UPTHRUST';
      if (me.type === 'vsa' && me.vsaType === 'stopping_volume') return 'VSA_STOPPING_VOLUME';
      if (me.type === 'chart_pattern' && me.patternType === 'double_bottom') return 'CLASSICAL_DOUBLE_BOTTOM';
      return e.type.toUpperCase();
    });

    const isFailedDownside = group.some(e => {
      const me = e as MarketEvent;
      return (
        (me.type === 'liquidity_sweep' && me.targetType === 'ssl') ||
        (me.type === 'wyckoff' && me.wyckoffType === 'spring') ||
        (me.type === 'vsa' && me.vsaType === 'stopping_volume')
      );
    });

    if (isFailedDownside) {
      mappings.push({
        canonicalType: 'FAILED_DOWNSIDE_AUCTION',
        matchedEvents: group,
        representations: Array.from(new Set(types)),
        timestamp
      });
    }
  }

  return mappings;
}

export interface BehavioralEquivalenceResult {
  readonly sampleSizeA: number;
  readonly sampleSizeB: number;
  readonly hitRateA: number;
  readonly hitRateB: number;
  readonly absoluteDifference: number;
  readonly zScore: number;
  readonly pValue: number;
  readonly isBehaviorallyEquivalent: boolean;
  readonly equivalenceMargin: number;
}

/**
 * Tests whether two event families produce statistically indistinguishable post-event outcomes.
 */
export function testOutcomeEquivalence(
  observationsA: readonly ResearchObservation[],
  observationsB: readonly ResearchObservation[],
  targetMetric: 'hit1R' | 'hit2R' | 'hit3R' = 'hit2R',
  equivalenceMargin: number = 0.08
): BehavioralEquivalenceResult {
  const nA = observationsA.length;
  const nB = observationsB.length;
  if (nA === 0 || nB === 0) {
    return {
      sampleSizeA: nA, sampleSizeB: nB, hitRateA: 0, hitRateB: 0,
      absoluteDifference: 0, zScore: 0, pValue: 1.0,
      isBehaviorallyEquivalent: false, equivalenceMargin
    };
  }

  const countA = observationsA.filter(o => o.outcome[targetMetric]).length;
  const countB = observationsB.filter(o => o.outcome[targetMetric]).length;
  const pA = countA / nA;
  const pB = countB / nB;
  const diff = Math.abs(pA - pB);

  const pooledP = (countA + countB) / (nA + nB);
  const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / nA + 1 / nB));
  const zScore = se > 0 ? (pA - pB) / se : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  const isBehaviorallyEquivalent = diff <= equivalenceMargin && pValue >= 0.05;

  return {
    sampleSizeA: nA,
    sampleSizeB: nB,
    hitRateA: pA,
    hitRateB: pB,
    absoluteDifference: diff,
    zScore,
    pValue,
    isBehaviorallyEquivalent,
    equivalenceMargin
  };
}

